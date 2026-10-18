// 持久管理独立AI日志数据库、开关和清除后的迟到写入，不改变历史存储名称。
import { browser } from 'wxt/browser';
export const DEBUG_ENABLED_KEY = 'debug-logging-enabled';
export type AIDebugFeature = '计划分析' | '自动选量' | 'AI 通用复核' | 'AI 决策复核' | '评论速读' | '视频总结' | '视频章节' | '视频问答' | 'AI帮你刷';
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
export async function finishLog(log: AIDebugLog) {
  await logsTransaction('readwrite', store => {
    const request = store.get(log.id);
    // 清除后的旧请求只更新仍然存在的日志，避免把已删除的内容写回来。
    request.onsuccess = () => { if (request.result) store.put(log); };
    return request;
  });
}

export async function beginLog(log: AIDebugLog) { await logsTransaction('readwrite', store => store.put(log)); }
