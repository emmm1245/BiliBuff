// 用模拟 B 站 iframe 验证搜索历史消息来源、读写同步和退出清理。
import { afterEach, expect, test, vi } from 'vitest';
import { createSearchHistory } from '../src/search-history';

afterEach(() => { vi.unstubAllGlobals(); });
function setup(autoReply = true) {
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  const store = { raw: JSON.stringify([{ value: '原历史', timestamp: 1 }]) as unknown };
  const messages: Array<{ type: string; id: string; key: string; value?: string }> = [];
  const frame = Object.assign(new EventTarget(), { hidden: false, src: '', title: '', isConnected: false,
    contentWindow: { postMessage: vi.fn() }, remove() { this.isConnected = false; } });
  const reply = (message: typeof messages[number], value: unknown, origin = 'https://s1.hdslb.com', source: unknown = frame.contentWindow, key = message.key) => {
    window.dispatchEvent(Object.assign(new Event('message'), { origin, source, data: { type: 'COLS_RES', id: message.id, key, value } }));
  };
  frame.contentWindow.postMessage.mockImplementation(message => {
    messages.push(message);
    if (!autoReply) return;
    if (message.type === 'COLS_GET') queueMicrotask(() => reply(message, store.raw));
    if (message.type === 'COLS_SET') { store.raw = message.value; queueMicrotask(() => reply(message, undefined)); }
  });
  vi.stubGlobal('document', { createElement: () => frame });
  const parent = { append() { frame.isConnected = true; queueMicrotask(() => frame.dispatchEvent(new Event('load'))); } };
  const changed = vi.fn();
  const history = createSearchHistory(parent as unknown as HTMLElement, changed);
  return { history, frame, changed, store, messages, reply };
}

test('读写同一原站键，写入前重新读取，连续编辑按顺序进行', async () => {
  const { history, store, changed, messages } = setup();
  expect(await history.read()).toEqual([{ value: '原历史', timestamp: 1 }]);
  store.raw = JSON.stringify([{ value: '另一页面的新词', timestamp: 2 }, { value: '原历史', timestamp: 1 }]);
  await Promise.all([history.add('摄影'), history.remove('原历史')]);
  const saved = JSON.parse(String(store.raw));
  expect(saved.map((item: { value: string }) => item.value)).toEqual(['摄影', '另一页面的新词']);
  expect(changed).toHaveBeenLastCalledWith(saved);
  expect(messages.every(message => message.key === 'search_history:search_history')).toBe(true);
  history.destroy();
  expect(messages.at(-1)?.type).toBe('COLS_LIS_UN');
});

test('只接受指定 iframe 的指定来源、键和请求标识', async () => {
  const { history, messages, reply } = setup(false);
  const read = history.read();
  let settled = false; void read.then(() => { settled = true; });
  await vi.waitFor(() => expect(messages.some(message => message.type === 'COLS_GET')).toBe(true));
  const request = messages.find(message => message.type === 'COLS_GET')!;
  const raw = '[{"value":"摄影","timestamp":2}]';
  reply(request, raw, 'https://evil.invalid');
  reply(request, raw, 'https://s1.hdslb.com', {});
  reply(request, raw, 'https://s1.hdslb.com', undefined, 'other:key');
  reply({ ...request, id: 'wrong' }, raw);
  await Promise.resolve(); expect(settled).toBe(false);
  reply(request, raw);
  expect(await read).toEqual([{ value: '摄影', timestamp: 2 }]);
  history.destroy();
});

test('读取失败不能写空历史，关闭时取消等待中的请求并解除监听', async () => {
  const { history, store, messages } = setup();
  store.raw = undefined;
  await expect(history.add('摄影')).rejects.toThrow('读取');
  expect(messages.some(message => message.type === 'COLS_SET')).toBe(false);
  history.destroy();
  const second = setup(false);
  const reading = second.history.read();
  await vi.waitFor(() => expect(second.messages.some(message => message.type === 'COLS_GET')).toBe(true));
  second.history.destroy();
  await expect(reading).rejects.toThrow('已关闭');
  expect(second.frame.isConnected).toBe(false);
});
