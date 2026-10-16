// 将 AI 请求的输入、原始输出和错误保存在本机，提供独立开关、下载读取与清除。
import { browser } from 'wxt/browser';

export const DEBUG_ENABLED_KEY = 'debug-logging-enabled';
export type AIDebugFeature = '计划分析' | 'AI 通用复核' | 'AI 决策复核' | '评论速读' | '视频总结' | '视频章节' | '视频问答';
export interface AIDebugLog {
  id: string;
  feature: AIDebugFeature;
  startedAt: string;
  durationMs?: number;
  service: string;
  url: string;
  input: Record<string, unknown>;
  output: string;
  status: 'pending' | 'success' | 'error' | 'cancelled';
  httpStatus?: number;
  error?: string;
}

let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bilibili-focus-debug', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('logs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
async function logsTransaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('logs', mode);
    const request = work(tx.objectStore('logs'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('调试日志存储失败。'));
  });
}
export async function debugEnabled() {
  return (await browser.storage.local.get(DEBUG_ENABLED_KEY))[DEBUG_ENABLED_KEY] === true;
}
export async function setDebugEnabled(enabled: boolean) {
  await browser.storage.local.set({ [DEBUG_ENABLED_KEY]: enabled });
}
export async function debugState() {
  const [enabled, count] = await Promise.all([debugEnabled(), logsTransaction('readonly', store => store.count())]);
  return { enabled, count };
}
export async function allDebugLogs(): Promise<AIDebugLog[]> {
  const logs = await logsTransaction('readonly', store => store.getAll()) as AIDebugLog[];
  return logs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export async function clearDebugLogs() {
  await logsTransaction('readwrite', store => store.clear());
}
async function finishLog(log: AIDebugLog) {
  await logsTransaction('readwrite', store => {
    const request = store.get(log.id);
    // 清除后的旧请求只更新仍然存在的日志，避免把已删除的内容写回来。
    request.onsuccess = () => { if (request.result) store.put(log); };
    return request;
  });
}
function loggingError(error: unknown) { console.warn('调试日志未能保存：', error); }

export async function traceAIRequest<T>(feature: AIDebugFeature, details: Pick<AIDebugLog, 'service' | 'url' | 'input'>,
  signal: AbortSignal, request: () => Promise<Response>, consume: (response: Response) => Promise<T>): Promise<T> {
  const started = Date.now();
  let log: AIDebugLog | undefined;
  try {
    if (await debugEnabled()) {
      log = { ...details, id: crypto.randomUUID(), feature, startedAt: new Date(started).toISOString(), output: '', status: 'pending' };
      await logsTransaction('readwrite', store => store.put(log));
    }
  } catch (error) { log = undefined; loggingError(error); }
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let lastSaved = started;
  try {
    let response = await request();
    if (log) {
      log.httpStatus = response.status;
      if (response.body) {
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            chunks.push(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk);
            if (log && Date.now() - lastSaved >= 1000) {
              lastSaved = Date.now();
              await finishLog({ ...log, output: chunks.join(''), durationMs: lastSaved - started }).catch(loggingError);
            }
          },
        }));
        response = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      if (!response.ok) {
        const output = await response.text();
        response = new Response(output, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    }
    const result = await consume(response);
    if (log) { log.status = response.ok ? 'success' : 'error'; if (!response.ok) log.error = `HTTP ${response.status}`; }
    return result;
  } catch (error) {
    if (log) {
      log.status = signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'cancelled' : 'error';
      log.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    throw error;
  } finally {
    if (log) {
      log.output = chunks.join('') + decoder.decode();
      log.durationMs = Date.now() - started;
      await finishLog(log).catch(loggingError);
    }
  }
}
