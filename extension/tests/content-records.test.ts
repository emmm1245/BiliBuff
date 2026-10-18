// 验证三类累计记录只传输视频数据，不携带卡片节点或循环引用。
import { afterEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { startCards } from '../src/filter/cards';
import type { trackWatching } from '../src/watching/tracker';

const { sendMessage, cards, watching } = vi.hoisted(() => ({
  sendMessage: vi.fn(), cards: vi.fn(), watching: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));
vi.mock('../src/filter/cards', () => ({ startCards: cards }));
vi.mock('../src/watching/tracker', () => ({ trackWatching: watching }));
vi.mock('../src/comment-reading', () => ({ startCommentReading: () => ({ watch: vi.fn(), configure: vi.fn() }) }));
vi.mock('../src/video-reading', () => ({ startVideoReading: () => ({ configure: vi.fn() }) }));
import { startContent } from '../src/content';

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

test('屏蔽、高亮和观看消息均可序列化，卡片内部字段不能混入累计记录', async () => {
  const received: unknown[] = [];
  const launcher = { title: '' };
  vi.stubGlobal('document', { querySelector: () => launcher });
  sendMessage.mockImplementation(async message => {
    // 模拟浏览器消息传输；网页节点上可能存在框架挂载的循环引用。
    received.push(JSON.parse(JSON.stringify(message)));
    return { ok: true };
  });
  cards.mockReturnValue(vi.fn());
  const stop = startContent(migrateSettings());
  try {
    const services = cards.mock.calls[0]![2] as Parameters<typeof startCards>[2];
    const recordWatched = watching.mock.calls[0]![2] as Parameters<typeof trackWatching>[2];
    const element: { parent?: unknown } = {};
    element.parent = element;
    const card = { bvid: 'BVrecord', title: '测试视频', element, visible: true };
    services.recordEvent('blocked', card, ['娱乐'], '严格模式：未命中偏好内容');
    services.recordEvent('highlight', card, ['学习'], '偏好内容');
    recordWatched('watched', { bvid: card.bvid, title: card.title });
    await Promise.resolve();
    await Promise.resolve();
    expect(launcher.title).toBe('');
    expect(received).toEqual([
      { type: 'record', event: { kind: 'blocked', bvid: card.bvid, title: card.title, tags: ['娱乐'], reason: '严格模式：未命中偏好内容', at: expect.any(Number) } },
      { type: 'record', event: { kind: 'highlight', bvid: card.bvid, title: card.title, tags: ['学习'], reason: '偏好内容', at: expect.any(Number) } },
      { type: 'record', event: { kind: 'watched', bvid: card.bvid, title: card.title, tags: null, reason: '', at: expect.any(Number) } },
    ]);
  } finally { stop(); }
});
