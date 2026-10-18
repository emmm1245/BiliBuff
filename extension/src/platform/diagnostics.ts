// 保存有界的本机操作诊断，关联任务步骤并隔离清除后的迟到写入。
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type OperationStatus = 'pending' | 'success' | 'error' | 'cancelled';
export interface LogStep { at: number; level: LogLevel; message: string; details?: Record<string, string | number | boolean> }
export interface OperationLog {
  id: string; parentId?: string; feature: string; message: string; at: number; updatedAt: number;
  status: OperationStatus; level: LogLevel; durationMs?: number; steps: LogStep[];
  rawLogId?: string; droppedSteps?: number;
}
export const DIAGNOSTIC_LIMIT = 500;
export const DIAGNOSTIC_AGE = 7 * 86400000;
export const DIAGNOSTIC_BYTES = 2 * 1024 * 1024;
const signals = new WeakMap<AbortSignal, string>();
let connection: Promise<IDBDatabase> | undefined;
let warned = false;

export function safeLogText(value: unknown, limit = 500): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return text.replace(/https?:\/\/[^\s<>"']+/gi, value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[地址已隐藏]'; }
  }).replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[\w-]+/g, '[密钥已隐藏]')
    .replace(/((?:api[_-]?key|authorization|cookie|token|secret)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[已隐藏]').slice(0, limit);
}
export function failureSummary(error: unknown) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const status = text.match(/HTTP\s*(\d{3})/i)?.[1];
  if (status) return `网络请求失败（HTTP ${status}）`;
  if (/quota|配额|存储|保存失败|未能保存|写入/i.test(text)) return '本机数据读取或保存失败';
  if (/权限|授权|密钥|余额|unauthorized|authentication/i.test(text)) return '服务权限、密钥或余额检查失败';
  if (/timeout|超时/i.test(text)) return '请求超时';
  if (/network|fetch|连接|断流/i.test(text)) return '网络连接异常或响应中断';
  if (/context|token|输出上限|输入长度|截断|上下文/i.test(text)) return '模型输入或输出超过容量限制';
  if (/json|syntax|schema|zod|NoObjectGenerated|NoOutputGenerated|格式|校验|起始行|引用|章节/i.test(text)) return '模型输出格式或业务内容校验失败';
  if (/改变|变化|失效|过期/i.test(text)) return '任务依赖的数据或设置已变化';
  return '操作执行失败，请查看相关请求与详细调试记录';
}
function failed(error: unknown) {
  if (!warned) { warned = true; console.warn('本机诊断日志未能保存', safeLogText(error)); }
}
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bilibuff-diagnostics', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('operations', mode), request = work(tx.objectStore('operations'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('诊断日志存储失败。'));
  });
}
export function retainedOperations(logs: OperationLog[], now = Date.now()) {
  let bytes = 0;
  return logs.filter(log => now - log.at < DIAGNOSTIC_AGE).sort((a, b) => b.at - a.at).filter((log, index) => {
    bytes += new TextEncoder().encode(JSON.stringify(log)).length;
    return index < DIAGNOSTIC_LIMIT && bytes <= DIAGNOSTIC_BYTES;
  });
}
function boundOperation(log: OperationLog) {
  while (log.steps.length && new TextEncoder().encode(JSON.stringify(log)).length > 4096) {
    log.steps.shift(); log.droppedSteps = (log.droppedSteps ?? 0) + 1;
  }
  return log;
}
export function operationFamily(logs: OperationLog[], id: string) {
  const ids = new Set([id]);
  for (let previous = 0; previous !== ids.size;) {
    previous = ids.size;
    for (const log of logs) if (log.parentId && ids.has(log.parentId)) ids.add(log.id);
  }
  return logs.filter(log => ids.has(log.id));
}
async function prune() {
  await transaction('readwrite', store => {
    const request = store.getAll();
    request.onsuccess = () => {
      const logs = request.result as OperationLog[], keep = new Set(retainedOperations(logs).map(log => log.id));
      for (const log of logs) if (!keep.has(log.id)) store.delete(log.id);
    };
    return request;
  });
}
export async function allOperations() {
  await prune();
  return retainedOperations(await transaction('readonly', store => store.getAll()) as OperationLog[]);
}
export async function clearOperations() { await transaction('readwrite', store => store.clear()); }
export async function hasOperation(id: string) {
  try { return !!await transaction('readonly', store => store.get(id)); }
  catch (error) { failed(error); return false; }
}
export function traceForSignal(signal?: AbortSignal) { return signal ? signals.get(signal) : undefined; }
export function bindTraceSignal(signal: AbortSignal, id?: string) { if (id) signals.set(signal, id); return signal; }
async function updateOperation(id: string, work: (log: OperationLog) => void) {
  try {
    await transaction('readwrite', store => {
      const request = store.get(id);
      request.onsuccess = () => {
        const saved = request.result as OperationLog | undefined;
        if (saved) { work(saved); saved.updatedAt = Date.now(); store.put(boundOperation(saved)); }
      };
      return request;
    });
  } catch (error) { failed(error); }
}
function appendStep(log: OperationLog, message: string, level: LogLevel, details?: LogStep['details']) {
  log.steps.push({ at: Date.now(), message: safeLogText(message), level,
    details: details && Object.fromEntries(Object.entries(details).slice(0, 12).map(([key, value]) => [key, typeof value === 'string' ? safeLogText(value, 160) : value])) });
  if (log.steps.length > 60) { log.steps.shift(); log.droppedSteps = (log.droppedSteps ?? 0) + 1; }
  if (level === 'warn' && log.level === 'info') log.level = 'warn';
}

export async function beginOperation(feature: string, message: string, parentId?: string) {
  const at = Date.now(), id = crypto.randomUUID();
  const log: OperationLog = { id, parentId, feature, message: safeLogText(message), at, updatedAt: at, status: 'pending', level: 'info', steps: [] };
  try {
    await transaction('readwrite', store => {
      if (!parentId) return store.put(log);
      const request = store.get(parentId);
      request.onsuccess = () => { if (request.result) store.put(log); };
      return request;
    });
    await prune();
  } catch (error) { failed(error); }
  return {
    id,
    rawLog(rawLogId: string) { return updateOperation(id, log => { log.rawLogId = rawLogId; }); },
    step(message: string, level: LogLevel = 'info', details?: LogStep['details']) {
      return updateOperation(id, log => appendStep(log, message, level, details));
    },
    finish(status: Exclude<OperationStatus, 'pending'>, message: string, rawLogId?: string) {
      return updateOperation(id, log => {
        log.status = status; log.message = safeLogText(message); log.durationMs = Date.now() - log.at;
        log.level = status === 'error' ? 'error' : log.level;
        if (rawLogId) log.rawLogId = rawLogId;
      });
    },
  };
}

export async function recordTraceStep(signal: AbortSignal | undefined, message: string, level: LogLevel, details?: LogStep['details']) {
  const id = traceForSignal(signal);
  if (!id) return;
  await updateOperation(id, log => appendStep(log, message, level, details));
}
