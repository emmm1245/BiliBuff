// 统一选片的B站请求并发、间隔、总预算、来源冷却及脱敏诊断。
import type { BrowseRequestLog } from './browse-types';
import { signedWbiQuery } from './wbi-sign';
import { biliClient, BiliRequestError } from './bili-client';
import { recordTraceStep, traceForSignal } from './platform/diagnostics';

export class BrowseRequestError extends Error {
  constructor(message: string, readonly kind: string) { super(message); }
}
export function browseFailureKind(error: unknown) {
  if (error instanceof BrowseRequestError || error instanceof BiliRequestError) return error.kind;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /412|429/.test(message) ? 'limited' : /timeout|超时/i.test(message) ? 'timeout' : /5\d\d/.test(message) ? 'http' : /network|fetch/i.test(message) ? 'network' : 'other';
}
export function browsePause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    signal.throwIfAborted();
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort',aborted); resolve(); },ms);
    signal.addEventListener('abort',aborted,{ once: true });
  });
}
const limits: Record<string,number> = { home: 3,search: 18,signing: 1,related: 3,detail: 54,tags: 54,player: 54,subtitle: 54 };
export function createBrowseNetwork(signal: AbortSignal, logs: BrowseRequestLog[], cooldowns: Map<string,number>) {
  let total = 0, active = 0, nextStart = 0, nextSearch = 0;
  const counts = new Map<string,number>(), failures = new Map<string,number>(), queue: (() => void)[] = [];
  let signing: Promise<{ img: string; sub: string }> | undefined;
  function check(kind: string) {
    if ((cooldowns.get(kind) ?? 0) > Date.now()) throw new BrowseRequestError('来源冷却中。','cooldown');
    if (total >= 180 || (counts.get(kind) ?? 0) >= limits[kind]!) throw new BrowseRequestError('本轮请求预算已用完。','budget');
  }
  const family = (path: string) => path.includes('/search/') ? 'search' : path.includes('/feed/') ? 'home' : path.includes('/related?') ? 'related' :
    path.includes('/view?') ? 'detail' : path.includes('/tags?') || path.includes('/detail/tag?') ? 'tags' : 'player';
  async function read<T>(url: string, kind: string, api: boolean): Promise<T> {
    signal.throwIfAborted();
    if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    const started = Date.now(), epoch = biliClient.epoch, record: BrowseRequestLog = { kind,path: new URL(url).pathname,durationMs: 0 };
    try {
      await biliClient.ready(); biliClient.check(kind);
      signal.throwIfAborted();
      check(kind);
      let wait: number;
      while ((wait = Math.max(nextStart,kind === 'search' ? nextSearch : 0)-Date.now()) > 0) await browsePause(wait,signal);
      signal.throwIfAborted();
      check(kind);
      biliClient.check(kind);
      nextStart = Date.now()+100; if (kind === 'search') nextSearch = Date.now()+2000;
      total++; counts.set(kind,(counts.get(kind) ?? 0)+1); record.sent = true;
      const response = await fetch(url,{ credentials: api ? 'include' : 'omit',redirect: 'error',signal: AbortSignal.any([signal,AbortSignal.timeout(15000)]) });
      record.http = response.status;
      if (!response.ok) throw new BrowseRequestError(`B站读取失败（${response.status}）。`,[412,429].includes(response.status) ? 'limited' : 'http');
      const result = await response.json();
      if (api) {
        record.code = result.code;
        // 导航接口未登录时仍提供公共签名信息，搜索本身仍严格校验业务码。
        if (result.code !== 0 && !(kind === 'signing' && result.code === -101)) throw new BrowseRequestError(`B站业务错误（${result.code}）。`,[-412,-509].includes(result.code) ? 'limited' : result.code === -352 ? 'verification' : 'business');
        const data = result.data;
        record.count = Array.isArray(data?.result) ? data.result.length : Array.isArray(data?.item) ? data.item.length : Array.isArray(data) ? data.length : undefined;
      }
      failures.set(kind,0);
      return (api ? result.data : result) as T;
    } catch (error) {
      const type = signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' : browseFailureKind(error);
      record.errorKind = type; record.error = error instanceof Error ? error.message.slice(0,240) : String(error).slice(0,240);
      if (['limited','verification','network','timeout'].includes(type) || (type === 'http' && (record.http ?? 0) >= 500)) {
        const failed = (failures.get(kind) ?? 0)+1; failures.set(kind,failed);
        if (['limited','verification'].includes(type) || failed >= 3) cooldowns.set(kind,Date.now()+10*60000);
      }
      if (signal.aborted) throw signal.reason;
      throw error instanceof BrowseRequestError ? error : new BrowseRequestError(record.error,type);
    } finally {
      record.durationMs = Date.now()-started; logs.push(record);
      await recordTraceStep(signal, `${kind}：${record.errorKind ?? 'success'}`, record.errorKind && record.errorKind !== 'cancelled' ? 'warn' : 'debug', {
        path: record.path, sent: !!record.sent, durationMs: record.durationMs, http: record.http ?? 0, code: record.code ?? 0,
      });
      await biliClient.record({ operationId: traceForSignal(signal),at: started,source: kind,path: record.path,sent: !!record.sent,durationMs: record.durationMs,http: record.http,code: record.code,errorKind: record.errorKind },epoch);
      const next = queue.shift(); if (next) next(); else active--;
    }
  }
  return {
    get remaining() { return 180-total; },
    available(kind: string) { return total < 180 && (counts.get(kind) ?? 0) < limits[kind]! && (cooldowns.get(kind) ?? 0) <= Date.now() && biliClient.cooldown(kind) <= Date.now(); },
    async search<T>(params: Record<string,string>) {
      signal.throwIfAborted(); check('search');
      signing ??= read<{ wbi_img?: { img_url?: string; sub_url?: string } }>('https://api.bilibili.com/x/web-interface/nav','signing',true).then(data => {
        const key = (url?: string) => url?.match(/\/([a-f\d]{32})\.[a-z]+(?:\?.*)?$/i)?.[1];
        const img = key(data?.wbi_img?.img_url), sub = key(data?.wbi_img?.sub_url);
        if (!img || !sub) throw new BrowseRequestError('搜索签名信息无效。','invalid');
        return { img,sub };
      });
      let keys: Awaited<typeof signing>;
      try { keys = await signing; }
      catch (error) { if (!signal.aborted) cooldowns.set('search',Date.now()+10*60000); throw error; }
      return read<T>(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signedWbiQuery(params,keys.img,keys.sub)}`,'search',true);
    },
    data<T>(path: string) { return read<T>(`https://api.bilibili.com${path}`,family(path),true); },
    resource<T>(url: string) { return read<T>(url,'subtitle',false); },
  };
}
export type BrowseNetwork = ReturnType<typeof createBrowseNetwork>;
