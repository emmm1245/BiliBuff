// 验证原页评论定位只更新评论组件，保护草稿并在取消、超时或视频切换时清理。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jumpToComment } from '../src/comment-navigation';

let attributes: Map<string,string>, target: { scrollIntoView: ReturnType<typeof vi.fn> } | null, draft: string;
let host: { shadowRoot: object; isConnected: boolean; getAttribute: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers(); attributes = new Map([['data-params','1,123'],['lazy-load','true']]); draft = '';
  target = { scrollIntoView: vi.fn() };
  const root = {
    querySelectorAll: (selector: string) => selector === '*' ? [] : draft ? [{ textContent: draft }] : [],
    querySelector: () => attributes.get('seek-id') && attributes.get('data-params') === '1,123' ? target : null,
  };
  host = { shadowRoot: root, isConnected: true, getAttribute: vi.fn(name => attributes.get(name) ?? null),
    setAttribute: vi.fn((name,value) => attributes.set(name,value)), removeAttribute: vi.fn(name => attributes.delete(name)) };
  vi.stubGlobal('document',{ querySelector: vi.fn(() => host) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('定位只切换评论属性，完成后恢复配置并滚动至目标', async () => {
  const scroll = target!.scrollIntoView;
  const task = jumpToComment('456',new AbortController().signal);
  await vi.advanceTimersByTimeAsync(600); await task;
  expect(host.setAttribute.mock.calls).toEqual([['seek-id','456'],['data-params','0,0'],['data-params','1,123'],['lazy-load','true']]);
  expect(attributes.has('seek-id')).toBe(false); expect(attributes.get('data-params')).toBe('1,123');
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
});
test('输入框有未发送内容时保持组件和草稿不动', async () => {
  draft = '还没发出去的评论';
  await expect(jumpToComment('456',new AbortController().signal)).rejects.toThrow('未发送');
  expect(host.setAttribute).not.toHaveBeenCalled();
});
test('首次清空期间取消也恢复评论对象，后续定位仍可执行', async () => {
  const controller = new AbortController(), task = jumpToComment('456',controller.signal);
  const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejection;
  expect(attributes.get('data-params')).toBe('1,123'); expect(attributes.get('lazy-load')).toBe('true'); expect(attributes.has('seek-id')).toBe(false);
});
test('视频已切换时不把旧评论对象写回新视频', async () => {
  target = null;
  const task = jumpToComment('456',new AbortController().signal), rejection = expect(task).rejects.toThrow('视频已切换');
  await vi.advanceTimersByTimeAsync(10); attributes.set('data-params','1,999');
  await vi.advanceTimersByTimeAsync(150); await rejection;
  expect(attributes.get('data-params')).toBe('1,999');
});
test('目标不存在时明确失败并恢复属性，不进行页面导航', async () => {
  target = null;
  const task = jumpToComment('456',new AbortController().signal), rejection = expect(task).rejects.toThrow('未找到目标评论');
  await vi.advanceTimersByTimeAsync(15100); await rejection;
  expect(attributes.get('data-params')).toBe('1,123'); expect(attributes.has('seek-id')).toBe(false);
});
