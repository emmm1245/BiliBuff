// 验证页面过滤等待网站加载完成，且扩展失效时不会继续启动。
import { afterEach, expect, test, vi } from 'vitest';

const { send, startContent } = vi.hoisted(() => ({ send: vi.fn(), startContent: vi.fn() }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (config: unknown) => config }));
vi.mock('../src/client', () => ({ send }));
vi.mock('../src/content', () => ({ startContent }));
// 骨架的挂载与清理由 home-skeleton-entry.test.ts 验证，本文件只关注启动时序。
vi.mock('../src/filter/home-skeleton', () => ({ holdHomeSkeleton: () => () => {} }));
import entry from '../entrypoints/bilibili.content';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup(readyState: DocumentReadyState, video: boolean | string = false) {
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  const page = { serverRendered: true, headerMounted: false };
  const querySelector = (selector: string) => selector === '#app' ?
    { hasAttribute: () => page.serverRendered } : page.headerMounted ? {} : null;
  vi.stubGlobal('document', { readyState, querySelector, body: {} });
  vi.stubGlobal('location', { pathname: typeof video === 'string' ? video : video ? '/video/BVtest' : '/' });
  let changed = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { changed = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const invalidated: Array<() => void> = [];
  const ctx = { isInvalid: false, onInvalidated: (callback: () => void) => invalidated.push(callback) };
  const stop = vi.fn();
  send.mockResolvedValue({ strict: true });
  startContent.mockReturnValue(stop);
  // 测试只需要入口实际使用的上下文字段。
  const run = () => entry.main!(ctx as unknown as NonNullable<Parameters<NonNullable<typeof entry.main>>[0]>);
  return { window, ctx, invalidated, stop, run, page, changed: () => changed(), disconnect };
}

test('加载阶段不读取规则、不插入遮罩；加载完成后启动并注册清理', async () => {
  const { window, invalidated, stop, run } = setup('interactive');
  const task = run();
  expect(send).not.toHaveBeenCalled();
  expect(startContent).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('load'));
  await task;
  expect(send).toHaveBeenCalledOnce();
  expect(startContent).toHaveBeenCalledWith({ strict: true });
  invalidated.forEach(callback => callback());
  expect(stop).toHaveBeenCalledOnce();
});

test('页面已经加载完成时直接启动', async () => {
  const { run } = setup('complete');
  await run();
  expect(startContent).toHaveBeenCalledOnce();
});

test('等待期间扩展失效，解除等待且后续加载不启动', async () => {
  const { ctx, invalidated, window, run } = setup('interactive');
  const task = run();
  ctx.isInvalid = true;
  invalidated.forEach(callback => callback());
  await task;
  window.dispatchEvent(new Event('load'));
  expect(send).not.toHaveBeenCalled();
  expect(startContent).not.toHaveBeenCalled();
});

test('视频页即使 load 已结束，也必须等服务端节点接管和导航挂载完成', async () => {
  const { run, page, changed, disconnect } = setup('complete', true);
  const task = run();
  expect(startContent).not.toHaveBeenCalled();
  page.headerMounted = true;
  changed();
  expect(send).not.toHaveBeenCalled();
  page.serverRendered = false;
  changed();
  await task;
  expect(startContent).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});

test('视频页初始化等待期间失效，断开观察且不启动', async () => {
  const { run, ctx, invalidated, disconnect } = setup('complete', true);
  const task = run();
  ctx.isInvalid = true;
  invalidated.forEach(callback => callback());
  await task;
  expect(disconnect).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

for (const path of ['/list/watchlater', '/list/ml123']) {
  test(`列表播放页 ${path} 也等待节点接管和导航挂载`, async () => {
    const { run, page, changed } = setup('complete', path);
    const task = run();
    expect(startContent).not.toHaveBeenCalled();
    page.serverRendered = false;
    changed();
    expect(send).not.toHaveBeenCalled();
    page.headerMounted = true;
    changed();
    await task;
    expect(startContent).toHaveBeenCalledOnce();
  });
}
