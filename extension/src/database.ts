// 通过事务保存累计记录与有上限的标签和 AI 复核缓存，支持数据库升级及去重导入。
import type { Counts, EventKind, ReviewVerdict, VideoEvent } from './types';

export const TAG_TTL = 7 * 24 * 60 * 60 * 1000;
interface TagEntry { bvid: string; tags: string[]; time: number }
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bilibili-focus', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: ['kind', 'bvid'] });
        events.createIndex('kind', 'kind');
        events.createIndex('kindTime', ['kind', 'at']);
        db.createObjectStore('tags', { keyPath: 'bvid' });
      }
      db.createObjectStore('reviews', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
interface ReviewEntry { key: string; verdict: ReviewVerdict; time: number }
export async function cachedReview(key: string) {
  const db = await database();
  const entry: ReviewEntry | undefined = await result(db.transaction('reviews').objectStore('reviews').get(key));
  return entry && Date.now() - entry.time < TAG_TTL ? entry.verdict : null;
}
export async function saveReview(key: string, verdict: ReviewVerdict) {
  const db = await database();
  const tx = db.transaction('reviews', 'readwrite');
  const done = completed(tx);
  const store = tx.objectStore('reviews');
  store.put({ key, verdict, time: Date.now() } satisfies ReviewEntry);
  const request = store.getAll();
  request.onsuccess = () => {
    const entries = (request.result as ReviewEntry[]).sort((a, b) => b.time - a.time);
    entries.forEach((entry, index) => { if (index >= 600 || Date.now() - entry.time >= TAG_TTL) store.delete(entry.key); });
  };
  await done;
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本地数据库写入失败。'));
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function mergeEvents(records: VideoEvent[]) {
  const unique = new Map<string, VideoEvent>();
  for (const record of records) {
    const key = `${record.kind}:${record.bvid}`;
    const previous = unique.get(key);
    if (!previous || record.at >= previous.at) unique.set(key, record);
  }
  const db = await database();
  const tx = db.transaction('events', 'readwrite');
  const done = completed(tx);
  const store = tx.objectStore('events');
  for (const record of unique.values()) {
    const request = store.get([record.kind, record.bvid]);
    request.onsuccess = () => {
      const previous = request.result as VideoEvent | undefined;
      if (!previous || record.at >= previous.at) store.put({ ...record, tags: record.tags ?? previous?.tags ?? null });
    };
  }
  await done;
}
export async function counts(): Promise<Counts> {
  const db = await database();
  const index = db.transaction('events').objectStore('events').index('kind');
  const [highlight, blocked, watched] = await Promise.all([
    result(index.count('highlight')), result(index.count('blocked')), result(index.count('watched')),
  ]);
  return { highlight, blocked, watched };
}
export async function allEvents(): Promise<VideoEvent[]> {
  const db = await database();
  return result(db.transaction('events').objectStore('events').getAll());
}
export async function samples(kind: EventKind, limit = 100): Promise<VideoEvent[]> {
  const db = await database();
  const index = db.transaction('events').objectStore('events').index('kindTime');
  const request = index.openCursor(IDBKeyRange.bound([kind, 0], [kind, Number.MAX_VALUE]), 'prev');
  return new Promise((resolve, reject) => {
    const records: VideoEvent[] = [];
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit) { resolve(records); return; }
      records.push(cursor.value);
      cursor.continue();
    };
  });
}
export async function cachedTags(bvid: string) {
  const db = await database();
  const entry: TagEntry | undefined = await result(db.transaction('tags').objectStore('tags').get(bvid));
  return entry && Date.now() - entry.time < TAG_TTL ? entry : null;
}
export async function saveTags(bvid: string, tags: string[]) {
  const db = await database();
  const tx = db.transaction('tags', 'readwrite');
  const done = completed(tx);
  const store = tx.objectStore('tags');
  store.put({ bvid, tags, time: Date.now() } satisfies TagEntry);
  const request = store.getAll();
  request.onsuccess = () => {
    const entries = (request.result as TagEntry[]).sort((a, b) => b.time - a.time);
    entries.forEach((entry, index) => { if (index >= 600 || Date.now() - entry.time >= TAG_TTL) store.delete(entry.bvid); });
  };
  await done;
}
