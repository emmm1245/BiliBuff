// 验证实际播放事件在普通及列表播放页正确计时，切换、暂停、拖动和短片结束不误计。
import { afterEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';

const { send, watch, configure } = vi.hoisted(() => ({ send: vi.fn(), watch: vi.fn(), configure: vi.fn() }));
vi.mock('../src/client', () => ({ send }));
vi.mock('../src/comment-reading', () => ({ startCommentReading: () => ({ watch, configure }) }));
vi.mock('../src/video-reading', () => ({ startVideoReading: () => ({ configure: vi.fn() }) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } } }));
import { startContent } from '../src/content';

// 页面扫描留空；这里只模拟媒体事件，不模拟卡片渲染。
class PageElement extends EventTarget {
  id = ''; textContent = ''; hidden = false;
  classList = { toggle() {}, remove() {} };
  append() {} remove() {}
}
class Media extends PageElement {
  currentTime = 0; duration = 60; playbackRate = 1; paused = false; seeking = false; main = true;
  closest(selector: string) { return this.main && selector.includes('.bpx-player-container') ? {} : null; }
}
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup(pathname: string, search = '') {
  let title = '第一课', clock = 1000;
  const document = Object.assign(new EventTarget(), {
    head: new PageElement(), body: new PageElement(), documentElement: new PageElement(),
    querySelector: () => ({ textContent: title }), querySelectorAll: () => [],
    createElement: () => new PageElement(),
  });
  const location = { pathname, search };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', location);
  for (const name of ['Element', 'HTMLElement']) vi.stubGlobal(name, PageElement);
  for (const name of ['HTMLVideoElement', 'HTMLMediaElement']) vi.stubGlobal(name, Media);
  for (const name of ['MutationObserver', 'IntersectionObserver']) {
    vi.stubGlobal(name, class { observe() {} unobserve() {} disconnect() {} });
  }
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  send.mockImplementation(message => Promise.resolve(message.type === 'tags' ? ['学习'] : undefined));
  const media = new Media();
  stop = startContent(migrateSettings());
  const fire = (type: string) => {
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: media });
    document.dispatchEvent(event);
  };
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) { clock += 1000; media.currentTime += media.playbackRate; fire('timeupdate'); }
  };
  const watched = () => send.mock.calls.map(([message]) => message).filter(message =>
    message.type === 'record' && message.event.kind === 'watched' && message.event.tags === null).map(message => message.event);
  return { media, fire, advance, watched, location,
    setTitle: (value: string) => { title = value; }, wait: (seconds: number) => { clock += seconds * 1000; } };
}

for (const path of ['/list/watchlater', '/list/ml123']) {
  test(`${path} 实际播放满 30 秒才记录`, () => {
    const { fire, advance, watched } = setup(path, '?bvid=BVfirst');
    fire('playing'); advance(29);
    expect(watched()).toEqual([]);
    advance(1);
    expect(watched()).toMatchObject([{ bvid: 'BVfirst', title: '第一课' }]);
    advance(5);
    expect(watched()).toHaveLength(1);
  });
}

test('列表切换视频重新计时，不把前一个视频的播放时间和标题归给新视频', () => {
  const { fire, advance, watched, media, location, setTitle } = setup('/list/watchlater', '?bvid=BVfirst');
  fire('playing'); advance(20);
  location.search = '?bvid=BVsecond'; setTitle('第二课'); media.currentTime = 0;
  fire('playing'); advance(29);
  expect(watched()).toEqual([]);
  advance(1);
  expect(watched()).toMatchObject([{ bvid: 'BVsecond', title: '第二课' }]);
});

test('倍速按实际时间计入，暂停期间不累计', () => {
  const { fire, advance, watched, media, wait } = setup('/list/ml123', '?bvid=BVfirst');
  media.playbackRate = 2;
  fire('playing'); advance(20);
  expect(watched()).toEqual([]);
  media.paused = true; media.dispatchEvent(new Event('pause')); wait(60); fire('timeupdate');
  media.paused = false; fire('playing'); advance(9);
  expect(watched()).toEqual([]);
  advance(1);
  expect(watched()).toHaveLength(1);
});

test('短片拖到结尾不记录，实际播放达到九成并结束才记录', () => {
  const { fire, advance, watched, media } = setup('/list/watchlater', '?bvid=BVshort');
  media.duration = 20;
  fire('playing'); media.dispatchEvent(new Event('seeking')); media.currentTime = 19;
  advance(1); fire('ended');
  expect(watched()).toEqual([]);
  media.currentTime = 0; media.dispatchEvent(new Event('seeking')); fire('playing');
  advance(18); media.currentTime = 20; fire('ended');
  expect(watched()).toMatchObject([{ bvid: 'BVshort' }]);
});

test('视频切换后旧播放器的结束事件不能登记旧视频', () => {
  const { fire, advance, watched, media, location } = setup('/list/watchlater', '?bvid=BVshort');
  media.duration = 10; fire('playing'); advance(9);
  location.search = '?bvid=BVnext'; fire('ended');
  expect(watched()).toEqual([]);
});

test('普通视频仍能计时，封面预览不计入', () => {
  const { fire, advance, watched, media } = setup('/video/BVoriginal/');
  media.main = false; fire('playing'); advance(30);
  expect(watched()).toEqual([]);
  media.main = true; fire('playing'); advance(30);
  expect(watched()).toMatchObject([{ bvid: 'BVoriginal' }]);
});

test('搜索路由即使带有视频编号，也不产生观看记录', () => {
  const { fire, advance, watched } = setup('/all', '?bvid=BVfirst');
  fire('playing'); advance(35);
  expect(watched()).toEqual([]);
});

test('评论采集在开始播放时收到通知，速读计时沿用排除暂停与拖动的实际耗时', () => {
  const { fire, advance, media, wait } = setup('/video/BVoriginal/');
  fire('playing');
  expect(watch).toHaveBeenLastCalledWith('BVoriginal',0,true);
  media.playbackRate = 2; advance(300);
  expect(watch).toHaveBeenLastCalledWith('BVoriginal',300,true);
  media.paused = true; media.dispatchEvent(new Event('pause')); wait(60); fire('timeupdate');
  expect(watch).toHaveBeenLastCalledWith('BVoriginal',300,false);
  media.paused = false; fire('playing'); advance(1);
  expect(watch).toHaveBeenLastCalledWith('BVoriginal',301,true);
});
