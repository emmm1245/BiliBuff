// 验证播放预采集、暂停续采与部分分析、自动触发和跨视频隔离。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { CommentCardState } from '../src/comment-card';
import type { CommentRecord } from '../src/comment-types';
import { quickReadKey } from '../src/comment-data';

const mocks = vi.hoisted(() => ({ send: vi.fn(), render: vi.fn(), card: vi.fn(), copy: vi.fn(), addListener: vi.fn() }));
vi.mock('../src/client', () => ({ send: mocks.send }));
vi.mock('../src/comment-card', () => ({ createCommentCard: mocks.card }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { onMessage: { addListener: mocks.addListener, removeListener: vi.fn() } } } }));
import { startCommentReading } from '../src/comment-reading';

let controller: AbortController;
const root: CommentRecord = { id: '1', root: '0', parent: '0', text: '有信息量的评论', author: '甲', likes: 1, time: 100, replies: 0 };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); controller = new AbortController();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document',{ body: {} });
  vi.stubGlobal('location',{ pathname: '/video/BVtest/', search: '' });
  vi.stubGlobal('navigator',{ clipboard: { writeText: mocks.copy.mockResolvedValue(undefined) } });
  vi.stubGlobal('MutationObserver',class { observe() {} disconnect() {} });
  mocks.card.mockReturnValue({ host: {}, render: mocks.render, mount: vi.fn(), theme: vi.fn(), remove: vi.fn() });
  mocks.send.mockImplementation(async message => {
    if (message.type === 'comments-source') return { bvid: message.bvid, oid: '123', title: '示例视频' };
    if (message.type === 'comments-page') return { comments: [root], expected: 1, end: true, offset: '', selected: false, pageSize: 20 };
    if (message.type === 'comments-cache') return null;
    if (message.type === 'comments-analyze') return { summary: '总览', topics: [], valuable: [], sources: [], bvid: message.source.bvid, total: message.total, complete: message.complete };
    return 'system';
  });
});
afterEach(() => { controller.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const requests = (type: string) => mocks.send.mock.calls.filter(([message]) => message.type === type);
const state = () => mocks.render.mock.calls.at(-1)![0] as CommentCardState;
function pauseAt(total: number) {
  let paused = false;
  mocks.render.mockImplementation((value: CommentCardState) => {
    if (!paused && value.collecting && value.total >= total) { paused = true; mocks.card.mock.calls[0]![0].pause(); }
  });
}

test('当前请求逐步预览总览，忽略其他请求与视频，完成后切换为正式结果', async () => {
  const original = mocks.send.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.send.mockImplementation(message => message.type === 'comments-analyze' ? new Promise(resolve => { finish = resolve; }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  mocks.card.mock.calls[0]![0].analyze(); await vi.advanceTimersByTimeAsync(0);
  const message = requests('comments-analyze')[0]![0], receive = mocks.addListener.mock.calls[0]![0];
  const progress = { type: 'comments-progress', requestId: message.requestId, bvid: 'BVtest', summary: '', thinking: true };
  receive(progress); expect(state().status).toContain('正在思考'); expect(state().preview).toBe('');
  receive({ ...progress, summary: '错误请求', requestId: 'other' });
  receive({ ...progress, summary: '其他视频', bvid: 'BVother' });
  expect(state().preview).toBe('');
  receive({ ...progress, summary: '中文总', thinking: false }); expect(state()).toMatchObject({ analyzing: true, preview: '中文总', result: null });
  receive({ ...progress, summary: '中文总览', thinking: false }); expect(state().preview).toBe('中文总览');
  const result = { summary: '中文总览', topics: [], valuable: [], sources: [], complete: true };
  finish(result); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ analyzing: false, preview: '', result });
  receive({ ...progress, summary: '迟到消息' }); expect(state().preview).toBe('');
});

test.each(['取消','失败','切换视频','修改设置'])('流式预览%s后清理，旧消息不能污染后续状态', async mode => {
  const settings = migrateSettings(), original = mocks.send.getMockImplementation()!;
  let fail!: (error: Error) => void;
  mocks.send.mockImplementation(message => message.type === 'comments-analyze' ? new Promise((_,reject) => { fail = reject; }) : original(message));
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0];
  actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  const message = requests('comments-analyze')[0]![0], receive = mocks.addListener.mock.calls[0]![0];
  const progress = { type: 'comments-progress', requestId: message.requestId, bvid: 'BVtest', summary: '半成品', thinking: false };
  receive(progress); expect(state().preview).toBe('半成品');
  if (mode === '取消') actions.cancel();
  if (mode === '切换视频') reader.watch('BVnext',0,false);
  if (mode === '修改设置') reader.configure({ ...settings, quickRead: { ...settings.quickRead, limit: 10 } });
  fail(new Error('连接中断')); await vi.advanceTimersByTimeAsync(0);
  receive(progress);
  expect(state()).toMatchObject({ analyzing: false, preview: '', result: null });
  if (mode === '失败') expect(state().error).toBe('连接中断');
});

test('重新分析失败保留先前正式结果，不用预览覆盖', async () => {
  const original = mocks.send.getMockImplementation()!;
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0]; actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  const previous = state().result;
  let fail!: (error: Error) => void;
  mocks.send.mockImplementation(message => message.type === 'comments-analyze' ? new Promise((_,reject) => { fail = reject; }) : original(message));
  actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  mocks.addListener.mock.calls[0]![0]({ type: 'comments-progress', requestId: requests('comments-analyze')[1]![0].requestId, bvid: 'BVtest', summary: '新预览', thinking: false });
  expect(state()).toMatchObject({ analyzing: true, preview: '新预览', result: previous });
  fail(new Error('模型连接中断')); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ analyzing: false, preview: '', result: previous });
});

test('刷新后无需播放即可恢复部分速读，不把缓存当作当前已采集数据', async () => {
  const settings = migrateSettings(), original = mocks.send.getMockImplementation()!;
  const result = { bvid: 'BVtest', key: quickReadKey(settings.quickRead), complete: false, total: 20, selected: 20, summary: '上次的部分速读', topics: [], valuable: [], sources: [], at: 1 };
  mocks.send.mockImplementation(message => message.type === 'comments-cache' ? Promise.resolve(result) : original(message));
  startCommentReading(settings,controller.signal); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ result, total: 0, complete: false });
  expect(state().status).toContain('已恢复部分评论速读缓存');
  expect(requests('comments-page')).toHaveLength(0); expect(requests('comments-analyze')).toHaveLength(0);
});

test('缓存读取失败向用户显示原因，不静默当成没有缓存', async () => {
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-cache' ? Promise.reject(new Error('本机存储不可读')) : original(message));
  startCommentReading(migrateSettings(),controller.signal); await vi.advanceTimersByTimeAsync(0);
  expect(state().error).toContain('本地速读缓存读取失败：本机存储不可读');
});

test('慢速缓存查找期间不采集，命中后播放也不重采，只有手动检查更新才采集', async () => {
  const settings = migrateSettings(); settings.quickRead.auto = true;
  const original = mocks.send.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.send.mockImplementation(message => message.type === 'comments-cache' ? new Promise(resolve => { finish = resolve; }) : original(message));
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',350,true); await vi.advanceTimersByTimeAsync(5000);
  expect(state().loadingCache).toBe(true); expect(requests('comments-source')).toHaveLength(0);
  finish({ bvid: 'BVtest', key: quickReadKey(settings.quickRead), complete: true, at: 1, total: 11000, selected: 1000, summary: '缓存总览', topics: [], valuable: [], sources: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ loadingCache: false, collecting: false, total: 0, result: { total: 11000 } });
  reader.watch('BVtest',400,true); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page')).toHaveLength(0); expect(requests('comments-analyze')).toHaveLength(0);
  mocks.card.mock.calls[0]![0].collect(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page')).toHaveLength(1); expect(requests('comments-analyze')).toHaveLength(0);
});

test('缓存未命中后才按播放状态采集，等待期间暂停视频不会误启动', async () => {
  const original = mocks.send.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.send.mockImplementation(message => message.type === 'comments-cache' ? new Promise(resolve => { finish = resolve; }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); reader.watch('BVtest',0,false);
  finish(null); await vi.advanceTimersByTimeAsync(0);
  expect(state().loadingCache).toBe(false); expect(requests('comments-page')).toHaveLength(0);
  reader.watch('BVtest',1,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: true, total: 1 });
});

test('无模型配置也在首次实际播放时采集，只采集一次并可复制AI友好文本', async () => {
  const reader = startCommentReading(migrateSettings(),controller.signal);
  expect(requests('comments-page')).toHaveLength(0);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: true, total: 1, analyzing: false });
  reader.watch('BVtest',600,true); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page')).toHaveLength(1); expect(requests('comments-analyze')).toHaveLength(0);
  const actions = mocks.card.mock.calls[0]![0]; actions.copy(true);
  expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('本文件1条'));
  expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('[#1]\n有信息量的评论'));
});
test('开启自动后严格超过300秒才调用模型，每个视频只自动一次', async () => {
  const settings = migrateSettings(); settings.quickRead.auto = true;
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  reader.watch('BVtest',300,true); expect(requests('comments-analyze')).toHaveLength(0);
  reader.watch('BVtest',301,true); await vi.advanceTimersByTimeAsync(0);
  reader.watch('BVtest',350,true); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')).toHaveLength(1);
});
test('计时已经达标时等待采集完成再自动分析，重复游标有新增仍继续翻页', async () => {
  const settings = migrateSettings(); settings.quickRead.auto = true;
  let page = 0;
  mocks.send.mockImplementation(async message => {
    if (message.type === 'comments-source') return { bvid: 'BVtest', oid: '123', title: '示例视频' };
    if (message.type === 'comments-cache') return null;
    if (message.type === 'comments-page') { await new Promise(resolve => setTimeout(resolve,250)); page++; return { comments: page < 3 ? [{ ...root, id: String(page) }] : [], expected: 2, offset: 'same', end: page === 3 }; }
    return { bvid: 'BVtest' };
  });
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',301,true); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(2100);
  expect(requests('comments-page')).toHaveLength(3); expect(requests('comments-analyze')).toHaveLength(1);
});
test('切换视频期间旧来源响应不能污染新视频，取消后不自动续采', async () => {
  let resolveOld!: (value: unknown) => void;
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-source' && message.bvid === 'BVtest' ? new Promise(resolve => { resolveOld = resolve; }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true);
  await vi.advanceTimersByTimeAsync(0);
  reader.watch('BVnext',0,true); await vi.advanceTimersByTimeAsync(0);
  resolveOld({ bvid: 'BVtest', oid: '999', title: '旧视频' }); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page').map(([message]) => message.oid)).toEqual(['123']);
  mocks.card.mock.calls[0]![0].copy(true);
  expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining('/video/BVnext/'));
});

test('自动调用失败后调整参数不会重复付费，允许用户手动重试', async () => {
  const settings = migrateSettings(); settings.quickRead.auto = true;
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-analyze' ? Promise.reject(new Error('输入过长')) : original(message));
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',301,true); await vi.advanceTimersByTimeAsync(0);
  expect(state().error).toContain('输入过长');
  reader.configure({ ...settings, quickRead: { ...settings.quickRead, limit: 10 } });
  reader.watch('BVtest',400,true); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')).toHaveLength(1);
  mocks.card.mock.calls[0]![0].analyze(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')).toHaveLength(2);
});

test('翻页间暂停不会继续发请求，能分析部分评论，继续沿原游标完成', async () => {
  pauseAt(1);
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-page'
    ? Promise.resolve({ comments: [{ ...root, id: message.offset ? '2' : '1' }], expected: 2, end: !!message.offset, offset: 'next' }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0]; actions.pause();
  await vi.advanceTimersByTimeAsync(5000);
  expect(state()).toMatchObject({ paused: true, collecting: false, total: 1 });
  expect(requests('comments-page')).toHaveLength(1);
  actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')[0]![0]).toMatchObject({ complete: false, total: 1, expected: 2 });
  expect(state().result).toMatchObject({ complete: false, total: 1 });
  actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-source')).toHaveLength(1);
  expect(requests('comments-page').map(([message]) => message.offset)).toEqual(['','next']);
  expect(state()).toMatchObject({ complete: true, total: 2, paused: false });
});

test('暂停时在途分页会被保留，分析固定使用点击时的快照，继续不重读该页', async () => {
  const original = mocks.send.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  mocks.send.mockImplementation(message => {
    if (message.type !== 'comments-page') return original(message);
    if (message.offset === 'second') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ comments: [{ ...root, id: message.offset ? '3' : '1' }], expected: 3, end: message.offset === 'third', offset: 'second' });
  });
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(250);
  const actions = mocks.card.mock.calls[0]![0]; actions.pause(); actions.analyze();
  await vi.advanceTimersByTimeAsync(0);
  finish({ comments: [{ ...root, id: '2' }], expected: 3, end: false, offset: 'third' });
  await vi.advanceTimersByTimeAsync(2000);
  expect(requests('comments-page')).toHaveLength(2);
  expect(state()).toMatchObject({ total: 2, paused: true, result: { total: 1, complete: false } });
  actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page').map(([message]) => message.offset)).toEqual(['','second','third']);
  expect(state()).toMatchObject({ total: 3, complete: true });
});

test('楼中楼暂停后保留楼层页码和去重集合，继续请求下一页', async () => {
  pauseAt(2);
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type !== 'comments-page' ? original(message) : Promise.resolve(message.root
    ? { comments: [{ ...root, id: String(message.pn+1), root: '1', parent: '1' }], expected: 2, end: message.pn === 2, offset: '' }
    : { comments: [{ ...root, replies: 2 }], expected: 3, end: true, offset: '' }));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(250);
  const actions = mocks.card.mock.calls[0]![0]; actions.pause(); await vi.advanceTimersByTimeAsync(2000);
  expect(state().total).toBe(2);
  actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-page').map(([message]) => [message.root,message.pn])).toEqual([[undefined,undefined],['1',1],['1',2]]);
  expect(state()).toMatchObject({ complete: true, total: 3 });
});

test('暂停阻止自动分析与播放触发续采，手动分析后完整采集也不重复付费', async () => {
  pauseAt(1);
  const settings = migrateSettings(); settings.quickRead.auto = true;
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-page'
    ? Promise.resolve({ comments: [{ ...root, id: message.offset ? '2' : '1' }], expected: 2, end: !!message.offset, offset: 'next' }) : original(message));
  const reader = startCommentReading(settings,controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0]; actions.pause();
  reader.watch('BVtest',400,true); await vi.advanceTimersByTimeAsync(2000);
  expect(requests('comments-page')).toHaveLength(1); expect(requests('comments-analyze')).toHaveLength(0);
  actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')).toHaveLength(1);
  actions.analyze(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')[1]![0]).toMatchObject({ complete: true, total: 2 });
});

test('快速继续再暂停不会穿过暂停点，切换视频不会复活旧采集', async () => {
  pauseAt(1);
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-page' && message.oid === '123'
    ? Promise.resolve({ comments: [root], expected: 2, end: false, offset: 'next' })
    : message.type === 'comments-source' && message.bvid === 'BVnext' ? Promise.resolve({ bvid: 'BVnext', oid: '456', title: '新视频' }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0]; actions.pause(); await vi.advanceTimersByTimeAsync(500);
  actions.collect(); actions.pause(); await vi.advanceTimersByTimeAsync(500);
  expect(requests('comments-page')).toHaveLength(1);
  reader.watch('BVnext',0,true); await vi.advanceTimersByTimeAsync(1000);
  expect(requests('comments-page').map(([message]) => message.oid)).toEqual(['123','456']);
  expect(state()).toMatchObject({ complete: true, total: 1, paused: false });
});

test('接口异常保留原因和已有评论，仍允许手动分析部分内容', async () => {
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-page' ? message.offset
    ? Promise.reject(new Error('访问限制 -412')) : Promise.resolve({ comments: [root], expected: 2, end: false, offset: 'next' }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(250);
  expect(state()).toMatchObject({ complete: false, collecting: false, total: 1, error: '访问限制 -412' });
  mocks.card.mock.calls[0]![0].analyze(); await vi.advanceTimersByTimeAsync(0);
  expect(requests('comments-analyze')[0]![0]).toMatchObject({ complete: false, total: 1 });
});

test('完整回复预览直接复用，无需再请求该楼层', async () => {
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'comments-page'
    ? Promise.resolve({ comments: [{ ...root, replies: 2 },{ ...root, id: '2', root: '1', parent: '1' },{ ...root, id: '3', root: '1', parent: '2' }], expected: 3, end: true }) : original(message));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: true, total: 3 });
  expect(requests('comments-page')).toHaveLength(1);
});

test('不完整预览仍读取回复分页，最终以本轮完整分页取代失效预览', async () => {
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type !== 'comments-page' ? original(message) : Promise.resolve(message.root
    ? { comments: ['3','4'].map(id => ({ ...root, id, root: '1', parent: '1' })), expected: 2, end: true }
    : { comments: [{ ...root, replies: 2 },{ ...root, id: '2', root: '1', parent: '1', text: '失效预览' }], expected: 3, end: true }));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: true, total: 3 });
  expect(requests('comments-page')).toHaveLength(2);
  mocks.card.mock.calls[0]![0].copy(true);
  expect(mocks.copy.mock.calls.at(-1)![0]).not.toContain('失效预览');
});

test('检查更新保留已有计数，已知主评论页仍能推进，按编号合并新增与正文更新', async () => {
  const original = mocks.send.getMockImplementation()!;
  let refresh = false;
  mocks.send.mockImplementation(message => {
    if (message.type !== 'comments-page') return original(message);
    if (!refresh) return Promise.resolve({ comments: ['1','2','3'].map(id => ({ ...root, id })), expected: 3, end: true });
    return Promise.resolve(message.offset === 'old'
      ? { comments: ['2','3'].map(id => ({ ...root, id })), expected: 4, end: true }
      : message.offset === 'known' ? { comments: [{ ...root, text: '更新后的正文' }], expected: 4, end: false, offset: 'old' }
      : { comments: [{ ...root, id: '4' }], expected: 4, end: false, offset: 'known' });
  });
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const totals: number[] = []; mocks.render.mockImplementation(value => totals.push(value.total));
  refresh = true; const actions = mocks.card.mock.calls[0]![0]; actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(Math.min(...totals)).toBe(3);
  expect(state()).toMatchObject({ total: 4, complete: true }); expect(state().status).toContain('新增1条');
  expect(requests('comments-source')).toHaveLength(1);
  actions.copy(true); expect(mocks.copy.mock.calls.at(-1)![0]).toContain('更新后的正文');
});

test('数量变化后检查更新补齐缺失评论，失败期间也不清空已有内容', async () => {
  const original = mocks.send.getMockImplementation()!;
  let refresh = false;
  mocks.send.mockImplementation(message => message.type !== 'comments-page' ? original(message) : Promise.resolve(!refresh
    ? { comments: [root], expected: 2, end: true }
    : { comments: [{ ...root, id: message.offset ? '1' : '2' }], expected: 2, end: !!message.offset, offset: 'known' }));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ total: 1, complete: false });
  refresh = true; mocks.card.mock.calls[0]![0].collect();
  expect(state().total).toBe(1); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ total: 2, complete: true, error: '' });
});

test('中断更新保留旧记录，只有完整核对后移除已失效评论', async () => {
  const original = mocks.send.getMockImplementation()!;
  let phase = 0;
  mocks.send.mockImplementation(message => {
    if (message.type !== 'comments-page') return original(message);
    if (!phase) return Promise.resolve({ comments: [root,{ ...root, id: '2' }], expected: 2, end: true });
    if (message.offset) return Promise.reject(new Error('网络中断'));
    return Promise.resolve({ comments: [root], expected: 1, end: phase === 2, offset: 'next' });
  });
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  const actions = mocks.card.mock.calls[0]![0]; phase = 1; actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: false, total: 2, error: '网络中断' });
  phase = 2; actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ complete: true, total: 1 }); expect(state().status).toContain('移除1条失效记录');
});

test('检查旧楼层的新回复时保留原回复并合并新增', async () => {
  const original = mocks.send.getMockImplementation()!;
  let refresh = false;
  const reply = { ...root, id: '2', root: '1', parent: '1', text: '原回复' };
  mocks.send.mockImplementation(message => message.type !== 'comments-page' ? original(message) : Promise.resolve(message.root
    ? { comments: [reply,{ ...reply, id: '3', text: '新增回复' }], expected: 2, end: true }
    : { comments: [{ ...root, replies: refresh ? 2 : 1 },reply], expected: refresh ? 3 : 2, end: true }));
  const reader = startCommentReading(migrateSettings(),controller.signal);
  reader.watch('BVtest',0,true); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ total: 2, complete: true });
  refresh = true; const actions = mocks.card.mock.calls[0]![0]; actions.collect(); await vi.advanceTimersByTimeAsync(0);
  expect(state()).toMatchObject({ total: 3, complete: true }); expect(state().status).toContain('新增1条');
  expect(requests('comments-page').filter(([message]) => message.root)).toHaveLength(1);
  actions.copy(true); const text = mocks.copy.mock.calls.at(-1)![0];
  expect(text.match(/原回复/g)).toHaveLength(1); expect(text).toContain('新增回复');
});
