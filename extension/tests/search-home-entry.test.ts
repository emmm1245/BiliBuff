// 验证留白首页尽早挂载、导航恢复、设置同步和扩展失效后的清理。
import { afterEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Theme } from '../src/theme';

const mocks = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn(), remove: vi.fn(), setTheme: vi.fn(), create: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (config: unknown) => config }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { onMessage: { addListener: mocks.addListener, removeListener: mocks.removeListener } } } }));
vi.mock('../src/client', () => ({ send: mocks.send }));
vi.mock('../src/search-home', () => ({ createSearchHome: mocks.create }));
import entry from '../entrypoints/search-home.content';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(theme: Theme = 'system') {
  mocks.create.mockReturnValue({ update: mocks.update, remove: mocks.remove, setTheme: mocks.setTheme });
  const settings = { ...migrateSettings(), homeSearch: true };
  mocks.send.mockImplementation(async (message: { type: string }) => message.type === 'theme' ? theme : settings);
  const events = new Map<string, () => void>();
  const cleanup: Array<() => void> = [];
  const ctx = { isInvalid: false, addEventListener: (_: unknown, name: string, callback: () => void) => events.set(name, callback),
    onInvalidated: (callback: () => void) => cleanup.push(callback) };
  // 入口只使用窗口引用，测试不需要浏览器 DOM。
  vi.stubGlobal('window', {});
  entry.main!(ctx as unknown as NonNullable<Parameters<NonNullable<typeof entry.main>>[0]>);
  const changed = () => mocks.addListener.mock.calls[0]![0]({ type: 'rules-changed' });
  return { settings, events, cleanup, ctx, changed };
}

test('在 document_start 读取规则，首页挂载独立于原站点加载', async () => {
  expect(entry.runAt).toBe('document_start');
  const { settings } = setup();
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledWith(settings));
  expect(mocks.send).toHaveBeenCalledWith({ type: 'rules' });
});

test('首次读取设置主题后才挂载首页，主题更新不重新处理规则', async () => {
  setup('dark');
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.setTheme).toHaveBeenCalledWith('dark');
  expect(mocks.setTheme.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]!);
  mocks.addListener.mock.calls[0]![0]({ type: 'theme-changed', theme: 'light' });
  expect(mocks.setTheme).toHaveBeenLastCalledWith('light');
  expect(mocks.update).toHaveBeenCalledOnce();
});

test('主题事件先于旧读取结果时，旧主题不能覆盖新主题', async () => {
  setup('light');
  mocks.addListener.mock.calls[0]![0]({ type: 'theme-changed', theme: 'dark' });
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.setTheme).toHaveBeenCalledOnce();
  expect(mocks.setTheme).toHaveBeenLastCalledWith('dark');
});

test('站内导航重新判断路径，关闭模式和更新壁纸都同步至已有首页', async () => {
  const { settings, events, changed } = setup();
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  events.get('wxt:locationchange')!();
  expect(mocks.update).toHaveBeenCalledTimes(2);
  const updated = { ...settings, homeSearch: false, homeWallpaper: 'data:image/png;base64,YQ==' };
  mocks.send.mockResolvedValue(updated);
  changed();
  await vi.waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith(updated));
});

test('失效时恢复原首页，等待中的旧请求不再挂载', async () => {
  const { ctx, cleanup } = setup();
  ctx.isInvalid = true;
  cleanup.forEach(callback => callback());
  await Promise.resolve();
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(mocks.removeListener).toHaveBeenCalledWith(mocks.addListener.mock.calls[0]![0]);
  expect(mocks.update).not.toHaveBeenCalled();
});

test('并行读取按最新请求生效，旧壁纸结果不能覆盖新结果', async () => {
  const { settings, changed } = setup();
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  let finish: (value: unknown) => void = () => {};
  mocks.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  changed();
  const latest = { ...settings, homeWallpaper: 'data:image/png;base64,YQ==' };
  mocks.send.mockResolvedValueOnce(latest);
  changed();
  await vi.waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith(latest));
  finish(settings);
  await Promise.resolve();
  expect(mocks.update).toHaveBeenLastCalledWith(latest);
});
