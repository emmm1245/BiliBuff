// 通过 B 站原存储 iframe 同步搜索历史，只读写搜索历史键并清理消息监听。
import { addSearchHistory, parseSearchHistory, type SearchHistoryEntry } from './search';

const origin = 'https://s1.hdslb.com';
const key = 'search_history:search_history';
const frameUrl = `${origin}/bfs/seed/jinkela/short/cols/iframe.html`;

export function createSearchHistory(parent: HTMLElement, changed: (entries: SearchHistoryEntry[]) => void) {
  const frame = document.createElement('iframe');
  frame.hidden = true; frame.src = frameUrl; frame.title = 'B 站搜索历史存储';
  let ready: Promise<void> | undefined, destroyed = false;
  let failLoad: ((error: Error) => void) | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const listenId = crypto.randomUUID();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const post = (type: string, id: string, value?: string) => frame.contentWindow!.postMessage({ type, key, id, ...(value === undefined ? {} : { value }) }, origin);
  function receive(event: MessageEvent) {
    if (event.origin !== origin || event.source !== frame.contentWindow || event.data?.type !== 'COLS_RES' || event.data.key !== key) return;
    if (event.data.id === listenId) { try { changed(parseSearchHistory(event.data.value)); } catch { /* 保留已显示的历史。 */ } return; }
    const request = pending.get(event.data.id);
    if (request) { clearTimeout(request.timer); pending.delete(event.data.id); request.resolve(event.data.value); }
  }
  function connect() {
    return ready ??= new Promise<void>((resolve, reject) => {
      failLoad = reject;
      frame.addEventListener('load', () => {
        clearTimeout(loadTimer);
        if (destroyed) return;
        post('COLS_LIS', listenId);
        resolve();
      }, { once: true });
      loadTimer = setTimeout(() => reject(new Error('暂时无法读取 B 站搜索历史。')), 3000);
      window.addEventListener('message', receive);
      parent.append(frame);
    });
  }
  async function request(type: string, value?: string) {
    if (destroyed) throw new Error('搜索历史已关闭。');
    await connect();
    if (destroyed) throw new Error('搜索历史已关闭。');
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('搜索历史暂未响应。')); }, 1500);
      pending.set(id, { resolve, reject, timer }); post(type, id, value);
    });
  }
  async function read() { return parseSearchHistory(await request('COLS_GET')); }
  let writes: Promise<unknown> = Promise.resolve();
  function edit(change: (entries: SearchHistoryEntry[]) => SearchHistoryEntry[]) {
    const task = writes.then(async () => {
      const entries = change(await read());
      await request('COLS_SET', JSON.stringify(entries)); changed(entries);
    });
    writes = task.catch(() => {});
    return task;
  }
  function destroy() {
    destroyed = true; clearTimeout(loadTimer); failLoad?.(new Error('搜索历史已关闭。'));
    if (frame.isConnected) post('COLS_LIS_UN', listenId);
    window.removeEventListener('message', receive); frame.remove();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('搜索历史已关闭。')); }
    pending.clear();
  }
  return { read, add: (value: string) => edit(entries => addSearchHistory(entries, value)),
    remove: (value: string) => edit(entries => entries.filter(item => item.value !== value)), clear: () => edit(() => []), destroy };
}
