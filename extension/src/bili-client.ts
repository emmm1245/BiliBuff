// 为视频和标签读取保存脱敏诊断、按来源冷却，并提供共用的签名请求。
import { browser } from 'wxt/browser';
import { signedWbiQuery } from './wbi-sign';
import { traceForSignal } from './platform/diagnostics';

const KEY = 'bilibuff-bili-network';
export interface BiliRequestLog { operationId?: string; at: number; source: string; path: string; sent: boolean; durationMs: number; http?: number; code?: number; errorKind?: string; cooldownUntil?: number }
export class BiliRequestError extends Error {
  constructor(message: string, readonly kind: string, readonly until = 0) { super(message); }
}
export function biliFailureKind(error: unknown) {
  if (error instanceof BiliRequestError) return error.kind;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /412|429/.test(text) ? 'limited' : /timeout|超时/i.test(text) ? 'timeout' : /abort/i.test(text) ? 'cancelled' : /network|fetch/i.test(text) ? 'network' : 'other';
}
export function biliSource(path: string) {
  return path.includes('/detail/tag') || path.includes('/tags?') ? 'tags' : path.includes('/playurl') ? 'media' :
    path.includes('/player/') ? 'player' : path.includes('/nav') ? 'signing' : path.includes('/view?') ? 'detail' : 'other';
}
export function createBiliClient() {
  let state: { logs: BiliRequestLog[]; cooldowns: Record<string,number> } = { logs: [],cooldowns: {} };
  let restored: Promise<void> | undefined, writes: Promise<unknown> = Promise.resolve(), epoch = 0;
  let signing: Promise<{ img: string; sub: string }> | undefined, signedAt = 0;
  const failures = new Map<string,number>();
  const ready = () => restored ??= browser.storage.local.get(KEY).then(value => {
    const saved = value[KEY] as typeof state | undefined;
    if (saved) state = { logs: saved.logs.slice(-200),cooldowns: saved.cooldowns };
  }).catch(error => { console.warn('B站请求记录读取失败',error); });
  const persist = () => {
    writes = writes.then(() => browser.storage.local.set({ [KEY]: state })).catch(error => { console.warn('B站请求记录保存失败',error); });
    return writes;
  };
  const cooldown = (source: string) => state.cooldowns[source] ?? 0;
  function check(source: string) { if (cooldown(source) > Date.now()) throw new BiliRequestError('该内容来源暂时受限，请稍后再试。','cooldown',cooldown(source)); }
  async function record(log: BiliRequestLog, generation = epoch) {
    await ready();
    if (log.cooldownUntil || ['limited','verification'].includes(log.errorKind ?? '')) state.cooldowns[log.source] = Math.max(cooldown(log.source),log.cooldownUntil ?? Date.now()+600000);
    else if (['network','timeout'].includes(log.errorKind ?? '') || (log.errorKind === 'http' && (log.http ?? 0) >= 500)) {
      const count = (failures.get(log.source) ?? 0)+1; failures.set(log.source,count);
      if (count >= 3) state.cooldowns[log.source] = Date.now()+60000;
    } else if (log.sent && !log.errorKind) failures.set(log.source,0);
    if (cooldown(log.source) > Date.now()) log.cooldownUntil = cooldown(log.source);
    if (generation === epoch) state.logs = [...state.logs,log].slice(-200);
    await persist();
  }
  async function json<T>(path: string, options: { credentials?: RequestCredentials; signal?: AbortSignal; timeout?: number; source?: string } = {}): Promise<T> {
    await ready();
    const source = options.source ?? biliSource(path), generation = epoch;
    const log: BiliRequestLog = { operationId: traceForSignal(options.signal),at: Date.now(),source,path: path.split('?')[0]!,sent: false,durationMs: 0 };
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []),AbortSignal.timeout(options.timeout ?? 15000)]);
    try {
      signal.throwIfAborted(); check(source); log.sent = true;
      const response = await fetch(`https://api.bilibili.com${path}`,{ credentials: options.credentials ?? 'include',redirect: 'error',signal });
      log.http = response.status;
      if (!response.ok) {
        const limited = [403,412,429].includes(response.status), retry = response.headers.get('Retry-After');
        const until = retry && /^\d+$/.test(retry) ? Date.now()+Number(retry)*1000 : retry ? Date.parse(retry) : 0;
        if (limited) log.cooldownUntil = Math.max(Date.now()+600000,until || 0);
        throw new BiliRequestError(`B站读取失败（HTTP ${response.status}），请稍后重试。`,limited ? 'limited' : 'http',log.cooldownUntil);
      }
      let result: { code: number; data: T };
      try { result = await response.json(); } catch { throw new BiliRequestError('B站响应格式无效。','invalid'); }
      if (!result || typeof result.code !== 'number') throw new BiliRequestError('B站响应缺少业务状态。','invalid');
      log.code = result.code;
      if (result.code !== 0 && !(source === 'signing' && result.code === -101)) throw new BiliRequestError(
        result.code === -101 ? '需要登录后读取此内容。' : `B站接口返回业务错误（${result.code}）。`,
        [-412,-509].includes(result.code) ? 'limited' : result.code === -352 ? 'verification' : 'business');
      return result.data;
    } catch (error) {
      log.errorKind = signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' : biliFailureKind(error);
      throw error;
    } finally { log.durationMs = Date.now()-log.at; await record(log,generation); }
  }
  return {
    ready,cooldown,check,record,json,
    get epoch() { return epoch; },
    async signed<T>(path: string, params: Record<string,string>) {
      await ready(); check(biliSource(path)); check('signing');
      if (!signing || Date.now()-signedAt > 3600000) {
        signedAt = Date.now();
        signing = json<{ wbi_img?: { img_url?: string; sub_url?: string } }>('/x/web-interface/nav').then(data => {
          const key = (url?: string) => url?.match(/\/([a-f\d]{32})\.[a-z]+(?:\?.*)?$/i)?.[1];
          const img = key(data?.wbi_img?.img_url), sub = key(data?.wbi_img?.sub_url);
          if (!img || !sub) throw new BiliRequestError('签名信息暂不可用。','invalid');
          return { img,sub };
        });
      }
      let keys: Awaited<typeof signing>;
      try { keys = await signing; } catch (error) {
        signing = undefined;
        if (biliFailureKind(error) === 'invalid') await record({ at: Date.now(),source: 'signing',path: '/x/web-interface/nav',sent: false,durationMs: 0,errorKind: 'invalid',cooldownUntil: Date.now()+60000 });
        throw error;
      }
      return json<T>(`${path}?${signedWbiQuery(params,keys.img,keys.sub)}`);
    },
    async note(path: string, errorKind: 'cache' | 'invalid') { await record({ at: Date.now(),source: biliSource(path),path: path.split('?')[0]!,sent: false,durationMs: 0,errorKind }); },
    async diagnostics() { await ready(); await writes; return { logs: state.logs,cooldowns: Object.fromEntries(Object.entries(state.cooldowns).filter(([,until]) => until > Date.now())) }; },
    async clearLogs() { await ready(); epoch++; state.logs = []; await persist(); },
  };
}
export const biliClient = createBiliClient();
