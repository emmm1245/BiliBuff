// 验证首页绘制前启用骨架、规则读取失败清理，并保留原有页面加载时序。
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), start: vi.fn(), hold: vi.fn(), release: vi.fn(), stop: vi.fn() }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (config: unknown) => config }));
vi.mock('../src/client', () => ({ send: mocks.send }));
vi.mock('../src/content', () => ({ startContent: mocks.start }));
vi.mock('../src/filter/home-skeleton', () => ({ holdHomeSkeleton: mocks.hold }));
import entry from '../entrypoints/bilibili.content';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function setup(pathname = '/') {
  const events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('location', { pathname });
  vi.stubGlobal('document', { readyState: 'loading' });
  mocks.hold.mockReturnValue(mocks.release);
  mocks.start.mockReturnValue(mocks.stop);
  mocks.send.mockResolvedValue({});
  const cleanup: Array<() => void> = [];
  const ctx = { isInvalid: false, onInvalidated: (callback: () => void) => cleanup.push(callback) };
  const ready = entry.main!(ctx as unknown as NonNullable<Parameters<NonNullable<typeof entry.main>>[0]>);
  return { events, ready, cleanup, ctx };
}

test('首页在页面开始时保留骨架，整页加载后交给过滤接管', async () => {
  const page = setup();
  expect(entry.runAt).toBe('document_start');
  expect(mocks.hold).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
  page.events.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  expect(mocks.start).not.toHaveBeenCalled();
  page.events.dispatchEvent(new Event('load'));
  await page.ready;
  expect(mocks.start).toHaveBeenCalledOnce();
  page.cleanup.forEach(cleanup => cleanup());
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

test('读取规则失败时解除启动骨架', async () => {
  const page = setup();
  mocks.send.mockRejectedValue(new Error('扩展已断开'));
  const rejected = expect(page.ready).rejects.toThrow('扩展已断开');
  page.events.dispatchEvent(new Event('load'));
  await rejected;
  expect(mocks.release).toHaveBeenCalledOnce();
});

test('播放相关页面继续等待整页加载', async () => {
  const page = setup('/other');
  page.events.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  expect(mocks.start).not.toHaveBeenCalled();
  page.events.dispatchEvent(new Event('load'));
  await page.ready;
  expect(mocks.start).toHaveBeenCalledOnce();
});
