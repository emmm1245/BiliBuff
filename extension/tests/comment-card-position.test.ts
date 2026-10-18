// 验证速读卡片默认位于标题下方，滚动和拖动后仍保持悬浮可见。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCommentCard, type CommentCardActions, type CommentCardState } from '../src/comment-card';

const mock = vi.hoisted(() => ({ createView: vi.fn(), render: vi.fn() }));
vi.mock('../src/ui/mount', () => ({ createIsolatedView: mock.createView }));
const actions: CommentCardActions = { collect: vi.fn(), pause: vi.fn(), analyze: vi.fn(), cancel: vi.fn(), copy: vi.fn(), download: vi.fn(), settings: vi.fn(), jump: vi.fn(), context: vi.fn() };
let host: { style: Record<string,string>; hidden: boolean; parentElement: unknown; getBoundingClientRect: () => object };
let title: { getBoundingClientRect: () => object };
beforeEach(() => {
  vi.clearAllMocks();
  host = { style: {}, hidden: false, parentElement: null, getBoundingClientRect: () => ({ width: 360, height: 56, left: 800, right: 1160, top: 148, bottom: 204 }) };
  title = { getBoundingClientRect: () => ({ left: 200, right: 1160, bottom: 140 }) };
  mock.createView.mockReturnValue({ host, render: mock.render, remove: vi.fn() });
  const body = { append: () => { host.parentElement = body; } };
  vi.stubGlobal('document',{ body, querySelector: (selector: string) => selector.includes('h1') ? title : null,
    getElementById: () => ({ hidden: false, getBoundingClientRect: () => ({ left: 1200 }) }) });
  vi.stubGlobal('window',{ innerWidth: 1860, innerHeight: 920, scrollX: 0, scrollY: 100 });
});
afterEach(() => vi.unstubAllGlobals());

test('默认卡片位于标题下方并靠视频右侧，滚动后保持相同页面位置', () => {
  const card = createCommentCard(actions); card.mount();
  expect(host.style).toMatchObject({ position: 'fixed', left: '800px', top: '248px' });
  title.getBoundingClientRect = () => ({ right: 1100, bottom: 40 }); window.scrollY = 200; card.mount();
  expect(host.style).toMatchObject({ left: '740px', top: '248px' });
});

test('拖动后重挂载不会重置位置', () => {
  const card = createCommentCard(actions); card.render({} as CommentCardState);
  mock.render.mock.calls[0]![0].props.place(300,250); card.mount();
  expect(host.style).toMatchObject({ position: 'fixed', left: '300px', top: '250px' });
});
