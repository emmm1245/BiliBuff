// 验证卡片离开视口后标签返回仍记录已展示的结果，预加载、失败和复用不误计。
import { afterEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';

vi.mock('wxt/browser', () => ({ browser: { runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } } }));
vi.mock('../src/client', () => ({ send: vi.fn() }));
import { startCards } from '../src/filter/cards';
import { send } from '../src/client';

class PageElement extends EventTarget {
  id = ''; title = ''; textContent = ''; hidden = false; inert = false; isConnected = true;
  innerHTML = ''; className = ''; children: PageElement[] = [];
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, enabled: boolean) => enabled ? this.classes.add(name) : this.classes.delete(name),
  };
  nodes = new Map<string, PageElement>();
  append() {} remove() {}
  closest() { return null; }
  matches() { return false; }
  querySelector(selector: string): PageElement {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new PageElement());
    return this.nodes.get(selector)!;
  }
  querySelectorAll() { return []; }
}

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(options: { specialName?: string; blockSpecialCards?: boolean; strict?: boolean; review?: boolean } = {}) {
  const link = { href: 'https://www.bilibili.com/video/BVfirst' };
  const heading = { getAttribute: () => '日常生活', closest: () => link };
  const card = new PageElement();
  vi.spyOn(card, 'matches').mockImplementation((...args: unknown[]) => args[0] === '.floor-card.single-card' && !!options.specialName);
  const badge = new PageElement(); badge.textContent = options.specialName || '';
  vi.spyOn(card, 'querySelector').mockImplementation(selector => selector === '.floor-title' ? badge : selector.includes('.bili-video-card__info--tit') ? heading as unknown as PageElement : new PageElement());
  const created: PageElement[] = [];
  vi.stubGlobal('document', Object.assign(new EventTarget(), {
    head: new PageElement(), body: new PageElement(), documentElement: new PageElement(),
    createElement: () => { const element = new PageElement(); created.push(element); return element; }, querySelectorAll: () => [card],
  }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { pathname: '/' });
  vi.stubGlobal('HTMLElement', PageElement);
  vi.stubGlobal('Element', PageElement);
  let changed!: (records: unknown[]) => void;
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: typeof changed) { changed = callback; }
    observe() {} disconnect() {}
  });
  const observers: Array<(entries: { target: PageElement; isIntersecting: boolean }[]) => void> = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof observers[number]) { observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  let resolveTags!: (tags: string[]) => void;
  let rejectTags!: (error: Error) => void;
  const requestTags = vi.fn(() => new Promise<string[]>((resolve, reject) => { resolveTags = resolve; rejectTags = reject; }));
  const recordEvent = vi.fn();
  const settings = migrateSettings();
  settings.strict = options.strict ?? true;
  settings.review.enabled = options.review ?? false;
  settings.positive = { text: [], tags: ['学习'], textTags: false };
  if (options.blockSpecialCards !== undefined) { settings.strict = false; settings.blockSpecialCards = options.blockSpecialCards; }
  stop = startCards(settings, new AbortController().signal, {
    requestTags, recordEvent, showError: vi.fn(), openSettings: vi.fn(), configure: vi.fn(),
  });
  const intersect = (observer: number, isIntersecting: boolean) => observers[observer]!([{ target: card, isIntersecting }]);
  return { recordEvent, requestTags, card, created, settings, badge, link, intersect,
    changed: () => changed([{ target: card, type: 'characterData' }]),
    resolveTags: (tags: string[]) => resolveTags(tags), rejectTags: () => rejectTags(new Error('标签失败')) };
}

for (const specialName of ['直播', '番剧', '国创', '综艺', '课堂', '电影', '电视剧']) {
  test(`${specialName}卡片遮罩显示名称，不依赖原因开关，不查询标签或累计视频统计`, () => {
    const page = setup({ specialName, blockSpecialCards: true });
    page.intersect(0, true); page.intersect(1, true);
    expect(page.card.classList.contains('bf-blocked')).toBe(true);
    const mask = page.created.find(element => element.className === 'bf-mask')!;
    expect(mask.querySelector('.bf-cover').textContent).toBe(specialName);
    expect(mask.querySelector('.bf-reason').hidden).toBe(true);
    expect(page.requestTags).not.toHaveBeenCalled();
    expect(page.recordEvent).not.toHaveBeenCalled();
    mask.querySelector('button').dispatchEvent(new Event('click'));
    expect(page.card.classList.contains('bf-blocked')).toBe(false);
  });
}

test('特殊业务开关关闭时恢复卡片，重新开启后按新业务名称遮罩', async () => {
  const page = setup({ specialName: '直播', blockSpecialCards: true });
  vi.mocked(send).mockResolvedValue({ ...page.settings, blockSpecialCards: false });
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve(); await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(false);
  page.badge.textContent = '番剧';
  vi.mocked(send).mockResolvedValue({ ...page.settings, showMaskReasons: true });
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve(); await Promise.resolve();
  const mask = page.created.filter(element => element.className === 'bf-mask').at(-1)!;
  expect(page.card.classList.contains('bf-blocked')).toBe(true);
  expect(mask.querySelector('.bf-cover').textContent).toBe('番剧');
  expect(mask.querySelector('.bf-reason').textContent).toContain('番剧');
});

test('特殊业务开关开启不遮住标签检查通过的普通视频', async () => {
  const page = setup({ blockSpecialCards: true });
  page.intersect(0, true); page.resolveTags([]);
  await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(false);
});

for (const [tags, kind] of [[[], 'blocked'], [['学习'], 'highlight']] as const) {
  test(`视频已展示，离开视口后返回标签仍累计 ${kind}`, async () => {
    const page = setup();
    page.intersect(0, true); page.intersect(1, true);
    page.intersect(1, false);
    page.resolveTags([...tags]);
    await Promise.resolve();
    expect(page.recordEvent).toHaveBeenCalledExactlyOnceWith(kind, expect.objectContaining({ bvid: 'BVfirst' }), tags, expect.any(String));
    page.intersect(1, true);
    expect(page.recordEvent).toHaveBeenCalledTimes(1);
  });
}

test('只进入预加载范围的视频不累计，进入视口后才累计', async () => {
  const page = setup();
  page.intersect(0, true); page.resolveTags([]);
  await Promise.resolve();
  expect(page.recordEvent).not.toHaveBeenCalled();
  page.intersect(1, true);
  expect(page.recordEvent).toHaveBeenCalledTimes(1);
});

test('严格模式标签失败仍是待确认，不计入已确认屏蔽', async () => {
  const page = setup();
  page.intersect(0, true); page.intersect(1, true); page.rejectTags();
  await Promise.resolve(); await Promise.resolve();
  expect(page.recordEvent).not.toHaveBeenCalled();
});

test('首页普通模式等待标签时保持骨架，命中屏蔽后直接切换为遮罩', async () => {
  const page = setup({ strict: false });
  page.settings.negative.tags = ['娱乐'];
  page.intersect(0, true); page.intersect(1, true);
  const mask = page.created.find(element => element.className === 'bf-mask')!;
  expect(page.card.classList.contains('bf-blocked')).toBe(true);
  expect(mask.classList.contains('bf-home-loading')).toBe(true);
  page.resolveTags(['娱乐']);
  await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(true);
  expect(mask.classList.contains('bf-home-loading')).toBe(false);
});

test('首页标签通过后继续保持骨架，直到 AI 复核完成', async () => {
  let resolveReview!: (verdict: string) => void;
  vi.mocked(send).mockImplementation(() => new Promise(resolve => { resolveReview = resolve; }));
  const page = setup({ review: true });
  page.intersect(0, true); page.intersect(1, true);
  page.resolveTags(['学习']);
  await Promise.resolve();
  const mask = page.created.find(element => element.className === 'bf-mask')!;
  expect(mask.classList.contains('bf-home-loading')).toBe(true);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'review' }));
  expect(page.recordEvent).not.toHaveBeenCalled();
  resolveReview('unrelated');
  await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(true);
  expect(mask.classList.contains('bf-home-loading')).toBe(false);
  expect(mask.querySelector('.bf-cover').textContent).toBe('AI屏蔽');
  expect(page.recordEvent).toHaveBeenCalledExactlyOnceWith('blocked', expect.objectContaining({ bvid: 'BVfirst' }), ['学习'], 'AI屏蔽');
});

test('高亮记录产生后因屏蔽词变化而屏蔽，仍分别累计两类记录', async () => {
  const page = setup();
  page.intersect(0, true); page.intersect(1, true);
  page.resolveTags(['学习']);
  await Promise.resolve();
  expect(page.recordEvent).toHaveBeenCalledExactlyOnceWith('highlight', expect.objectContaining({ bvid: 'BVfirst' }), ['学习'], expect.any(String));
  vi.mocked(send).mockResolvedValue({ ...page.settings, positiveWins: false, negative: { text: ['日常'], tags: [], textTags: false } });
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve(); await Promise.resolve();
  expect(page.recordEvent).toHaveBeenCalledTimes(2);
  expect(page.recordEvent).toHaveBeenLastCalledWith('blocked', expect.objectContaining({ bvid: 'BVfirst' }), ['学习'], expect.any(String));
});

test('首页普通模式标签失败后结束骨架，沿用标题判断', async () => {
  const page = setup({ strict: false });
  page.intersect(0, true); page.rejectTags();
  await Promise.resolve(); await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(false);
});

test('首页 AI 复核失败后结束骨架，沿用规则结果', async () => {
  vi.mocked(send).mockRejectedValue(new Error('AI 暂不可用'));
  const page = setup({ review: true });
  page.intersect(0, true); page.intersect(1, true);
  page.resolveTags(['学习']);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(false);
  expect(page.card.classList.contains('bf-highlight')).toBe(true);
});

test('首页复用已放行卡片时立即恢复骨架，不等待延迟扫描', async () => {
  const page = setup({ strict: false });
  page.intersect(0, true); page.resolveTags([]);
  await Promise.resolve();
  expect(page.card.classList.contains('bf-blocked')).toBe(false);
  page.link.href = 'https://www.bilibili.com/video/BVsecond';
  page.changed();
  expect(page.card.classList.contains('bf-blocked')).toBe(true);
  expect(page.created.filter(element => element.className === 'bf-mask').at(-1)!.classList.contains('bf-home-loading')).toBe(true);
});
