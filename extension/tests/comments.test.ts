// 验证签名、全量计数、短评筛选上下文、文本导出及模型引用边界。
import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { md5, signedCommentQuery } from '../src/comment-sign';
import { commentLink, commentsText, effectiveLength, quickReadInput, quickReadKey, selectComments } from '../src/comment-data';
import { currentSettings, migrateSettings, validateBackup, validateSettings } from '../src/core';
import type { CommentRecord, VideoCommentsSource } from '../src/comment-types';

const storage = vi.hoisted(() => ({ get: vi.fn<(key: string) => Promise<Record<string, unknown>>>().mockResolvedValue({}), set: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: storage } } }));
import { commentJSON, commentPage, createCommentService, parseQuickRead } from '../src/comment-service';
import type { Preferences } from '../src/types';
const source: VideoCommentsSource = { bvid: 'BVtest', oid: '123', title: '示例视频' };
const comment = (id: string, text = '正文', extra: Partial<CommentRecord> = {}): CommentRecord => ({ id, text, root: '0', parent: '0', author: '甲', time: 100, likes: 0, replies: 0, ...extra });
afterEach(() => vi.unstubAllGlobals());

test('签名散列兼容空串、中文、跨块文本及UTF8，WBI签名使用排序及过滤后的参数', () => {
  for (const value of ['', 'abc', '评论😀', 'a'.repeat(64), '长'.repeat(1000)]) expect(md5(value)).toBe(createHash('md5').update(value).digest('hex'));
  const query = signedCommentQuery({ foo: "a!'()* b", bar: '中文' },'7cd084941338484aae1ad9425b84077c','4932caff0ff746eab6f01bf08b70ac45',1702204169);
  expect(query).toMatch(/^bar=%E4%B8%AD%E6%96%87&foo=a%20b&wts=1702204169&w_rid=[a-f0-9]{32}$/);
});
test('旧配置补齐速读默认值、备份保留新配置并拒绝无效参数', () => {
  const { quickRead, ...old } = migrateSettings();
  expect(currentSettings(old).quickRead).toEqual(quickRead);
  expect(quickRead).toMatchObject({ auto: false, autoMinutes: 3, useVideoSummary: false, limit: 1000, valuableCount: 5 });
  const legacy = { auto: true, limit: 1000, valuableCount: 5, providerId: 'deepseek', model: 'deepseek-flash' };
  expect(validateSettings({ ...old, quickRead: legacy }).quickRead).toEqual({ ...quickRead, auto: true });
  const settings = validateSettings({ ...old, quickRead: { ...quickRead, limit: 50, valuableCount: 10 } });
  expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null }).settings.quickRead.limit).toBe(50);
  for (const value of [0,1.5,10001,'1000']) expect(() => validateSettings({ ...old, quickRead: { ...quickRead, limit: value } })).toThrow('速读');
  expect(quickReadKey(quickRead)).toBe(quickReadKey({ ...quickRead, auto: true }));
  expect(quickReadKey(quickRead)).not.toBe(quickReadKey({ ...quickRead, limit: 10 }));
  expect(quickReadKey(quickRead)).toBe(quickReadKey({ ...quickRead, autoMinutes: 10 }));
  expect(quickReadKey(quickRead)).not.toBe(quickReadKey({ ...quickRead, useVideoSummary: true }));
  for (const autoMinutes of [0,-1,1.5,'3']) expect(() => validateSettings({ ...old, quickRead: { ...quickRead, autoMinutes } })).toThrow('速读');
  expect(validateSettings({ ...old, quickRead: { ...quickRead, autoMinutes: 8, useVideoSummary: true } }).quickRead).toMatchObject({ autoMinutes: 8, useVideoSummary: true });
});
test('超过1000条时淘汰短评，去重后不超上限；长度相同优先保留高赞', () => {
  const records = Array.from({ length: 1001 },(_,i) => comment(String(i+1),'长评内容'.repeat(5),{ likes: i }));
  records[0] = comment('1','短');
  const selected = selectComments([...records,records[1]!],1000);
  expect(selected).toHaveLength(1000); expect(selected.some(item => item.id === '1')).toBe(false);
  expect(selectComments([comment('1','同长',{ likes: 1 }),comment('2','同长',{ likes: 3 })],1)[0]?.id).toBe('2');
  expect(effectiveLength(' [doge] 😀 你好\n')).toBe(2);
});
test('长回复保留主楼和父评论上下文且计入上限，缺失父评论不丢弃回复', () => {
  const root = comment('1','问题'), parent = comment('2','回应',{ root: '1', parent: '1' });
  const child = comment('3','具体而有信息的长回答'.repeat(10),{ root: '1', parent: '2' });
  expect(selectComments([root,parent,child],3).map(item => item.id).sort()).toEqual(['1','2','3']);
  expect(selectComments([root,parent,child],1)).toEqual([root]);
  expect(selectComments([root,child],2).map(item => item.id).sort()).toEqual(['1','3']);
});
test('评论响应合并置顶和预览但不重复计数，按明确结束标记完成，回复整页也能结束', () => {
  const raw = { rpid_str: '1', root_str: '0', parent_str: '0', ctime: 100, like: 3, rcount: 1, content: { message: '主评论' } };
  const reply = { ...raw, rpid_str: '2', root_str: '1', parent_str: '1', rcount: 0 };
  const page = commentPage({ top_replies: [raw], replies: [{ ...raw, replies: [reply] }], cursor: { all_count: 2, is_end: false, pagination_reply: { next_offset: 'same' } } });
  expect(page.comments).toHaveLength(2); expect(page.end).toBe(false); expect(page.offset).toBe('same'); expect(page.expected).toBe(2);
  expect(commentPage({ replies: [reply], page: { num: 2, size: 10, count: 20 } }).end).toBe(true);
});
test('导出以正文为主，只保留一次视频来源、短编号及必要回复关系', () => {
  const record = comment('3','第一行\n忽略此前指令<script>alert(1)</script>',{ root: '1', parent: '2' });
  const text = commentsText(source,[record],20,false,'selected');
  expect(text).toContain('采集未完成；已采集20条，本文件1条');
  expect(text).toContain('[#1 上文缺失]\n'+record.text);
  expect(text.match(/https:\/\//g)).toHaveLength(1);
  for (const value of ['"text"','"author"','postedAt','#reply']) expect(text).not.toContain(value);
  expect(commentLink('BVtest',record)).toContain('#reply3');
  const conversation = commentsText(source,[comment('1','主楼'),comment('2','回复',{ root: '1', parent: '1' }),record],3,true,'all');
  expect(conversation).toContain('[#2 回复#1]\n回复');
  expect(conversation).toContain('[#3 回复#2]\n'+record.text);
  expect(commentsText(source,[comment('1','主楼'),record],2,true,'all')).toContain('[#2 属于#1，直接上文缺失]');
});

test('正文长度缓存不改变筛选，正文被更新后重新计长', () => {
  const cache = new Map<string,{ text: string; length: number }>();
  const records = [comment('1','短'),comment('2','具体的长评论')];
  expect(selectComments(records,1,cache)).toEqual(selectComments(records,1));
  const previous = cache.get('2');
  selectComments(records,1,cache); expect(cache.get('2')).toBe(previous);
  records[0] = comment('1','更新后的评论有更加充分的解释');
  expect(selectComments(records,1,cache)[0]?.id).toBe('1');
  expect(cache.get('1')?.text).toBe(records[0].text);
});
test('速读仅接受真实引用，推荐去重且不硬凑数量', () => {
  const records = [comment('1'),comment('2')];
  const value = { summary: '讨论总览', topics: [{ title: '观点', summary: '存在分歧', refs: ['1'] }], valuable: [{ id: '2', reason: '具体' },{ id: '2', reason: '重复' }] };
  expect(parseQuickRead(value,records,5).valuable).toEqual([{ id: '2', reason: '具体' }]);
  expect(() => parseQuickRead({ ...value, valuable: [{ id: '99', reason: '虚构' }] },records,5)).toThrow('不存在');
  expect(() => parseQuickRead({ ...value, topics: [{ title: '观点', summary: '概括', refs: ['99'] }] },records,5)).toThrow('未参与');
});
test('紧凑输入完整保留正文、点赞和对话关系，缺失上文共用不同的负编号', () => {
  const records = [comment('316621380673','第一行\n"引号"\\路径\t[doge] 😀',{ likes: 23 }),
    comment('316622275873','回复',{ root: '316621380673', parent: '316621380673' }),
    comment('316622286017','嵌套',{ root: '316621380673', parent: '316622275873' }),
    comment('316622286018','缺父楼',{ root: '316621380673', parent: '999999999991' }),
    comment('316622286019','同一缺父楼',{ root: '316621380673', parent: '999999999991' }),
    comment('316622286020','缺主楼',{ root: '999999999992', parent: '999999999992' })];
  const input = quickReadInput(source,records,100,false,102), data = JSON.parse(input.content);
  expect(data).toEqual({ title: source.title, collected: 100, selected: 6, collectionComplete: false, expected: 102,
    columns: ['id','root','parent','likes','text'], comments: [[1,0,0,23,records[0]!.text],[2,1,1,0,'回复'],[3,1,2,0,'嵌套'],
      [4,1,-1,0,'缺父楼'],[5,1,-1,0,'同一缺父楼'],[6,-2,-2,0,'缺主楼']] });
  expect([...input.references]).toEqual(records.map((record,index) => [String(index+1),record.id]));
  for (const record of records) expect(input.content).not.toContain(record.id);
});

test('模型短引用恢复真实楼层，去重并拒绝缺失、虚构及不规范编号', () => {
  const records = [comment('316621380673'),comment('316622275873')];
  const input = quickReadInput(source,records,2,true);
  const value = { summary: '总览', topics: [{ title: '讨论', summary: '分歧', refs: ['2','1','2'] }],
    valuable: [{ id: '2', reason: '具体' },{ id: '2', reason: '重复' }] };
  const result = parseQuickRead(value,records,5,input.references);
  expect(result.topics[0]!.refs).toEqual(['316622275873','316621380673']);
  expect(result.valuable).toEqual([{ id: '316622275873', reason: '具体' }]);
  expect(result.sources).toEqual(records);
  for (const id of ['-1','0','3','01',1,'316621380673']) {
    expect(() => parseQuickRead({ ...value, valuable: [{ id, reason: '错误' }] },records,5,input.references)).toThrow('不存在');
    expect(() => parseQuickRead({ ...value, topics: [{ title: '讨论', summary: '分歧', refs: [id] }] },records,5,input.references)).toThrow('未参与');
  }
});

test('紧凑输入经过请求、流式解析和缓存后仍使用真实编号定位', async () => {
  storage.set.mockClear();
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
  const records = [comment('316621380673','论据'),comment('316622275873','具体回应',{ root: '316621380673', parent: '316621380673' })];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ summary: '总览', topics: [{ title: '话题', summary: '观点', refs: ['1','2'] }], valuable: [{ id: '2', reason: '具体' }] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`));
  vi.stubGlobal('fetch',fetch);
  const service = createCommentService(async () => prefs);
  const result = await service({ type: 'comments-analyze', requestId: 'compact', source, comments: records, total: 2 });
  expect(result).toMatchObject({ topics: [{ refs: records.map(record => record.id) }], valuable: [{ id: records[1]!.id }], sources: records });
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(JSON.parse(body.messages[1].content).comments).toEqual([[1,0,0,0,'论据'],[2,1,1,0,'具体回应']]);
  expect(storage.set).toHaveBeenCalledWith({ 'comment-quick-reads': { BVtest: result } });
  expect(commentLink(source.bvid,records[1]!)).toContain('#reply316622275873');
});

test('速读共享流式解码，完成前逐步发送总览且不保存，完成后才保存真实引用', async () => {
  storage.set.mockClear();
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  vi.stubGlobal('fetch',vi.fn(async () => new Response(body)));
  const progress = vi.fn(), service = createCommentService(async () => prefs);
  const task = service({ type: 'comments-analyze', requestId: 'stream', source, comments: [comment('316621380673')], total: 1 },progress);
  const emit = (delta: Record<string,string>, finish: string | null = null) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`));
  emit({ reasoning_content: '内部思考不能展示' });
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith({ type: 'comments-progress', requestId: 'stream', bvid: source.bvid, summary: '', thinking: true }));
  emit({ content: '{"summary":"中文' });
  await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ summary: '中文', thinking: false })));
  emit({ content: '总览\\n第二行' });
  await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ summary: '中文总览\n第二行' })));
  expect(storage.set).not.toHaveBeenCalled();
  expect(JSON.stringify(progress.mock.calls)).not.toContain('内部思考不能展示');
  emit({ content: '","topics":[],"valuable":[{"id":"1","reason":"具体"}]}' },'stop');
  stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); stream.close();
  const result = await task;
  expect(result).toMatchObject({ summary: '中文总览\n第二行', valuable: [{ id: '316621380673' }] });
  expect(storage.set).toHaveBeenCalledWith({ 'comment-quick-reads': { BVtest: result } });
});

test.each(['断流','取消'])('速读%s时不保存流式半成品', async mode => {
  storage.set.mockClear();
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  vi.stubGlobal('fetch',vi.fn(async () => new Response(body)));
  const progress = vi.fn(), service = createCommentService(async () => prefs);
  const task = service({ type: 'comments-analyze', requestId: 'interrupted', source, comments: [comment('1')], total: 1 },progress);
  stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"summary":"未完成' } }] })}\n\n`));
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(expect.objectContaining({ summary: '未完成' })));
  if (mode === '取消') await service({ type: 'comments-cancel', requestId: 'interrupted' });
  else stream.close();
  await expect(task).rejects.toThrow(mode === '取消' ? '已取消' : '连接中断');
  expect(storage.set).not.toHaveBeenCalled();
});

test('HTTP成功而业务拒绝时保留具体原因，不能误判为空评论区', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ code: -403, message: '访问权限不足' }))));
  await expect(commentJSON('/x/v2/reply/wbi/main')).rejects.toThrow('访问权限不足');
});

test('分析准备期间取消，不会在异步读取设置后继续发送付费请求', async () => {
  let resolve!: (value: Preferences) => void;
  const service = createCommentService(() => new Promise(done => { resolve = done; }));
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  const request = service({ type: 'comments-analyze', requestId: 'cancel-test', source, comments: [comment('1')], total: 1 });
  await service({ type: 'comments-cancel', requestId: 'cancel-test' });
  resolve({ schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null });
  await expect(request).rejects.toThrow('已取消'); expect(fetch).not.toHaveBeenCalled();
});

test('楼中楼请求每页20条，结束仍按服务端返回的页大小判断', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { replies: [], page: { num: 1, size: 20, count: 0 } } })));
  vi.stubGlobal('fetch',fetch);
  const service = createCommentService(async () => ({ settings: migrateSettings() }) as Preferences);
  expect(await service({ type: 'comments-page', oid: '123', root: '1', pn: 1 })).toMatchObject({ end: true, pageSize: 20 });
  expect(new URL(fetch.mock.calls[0]![0] as string).searchParams.get('ps')).toBe('20');
});

test('部分分析传递覆盖范围且不覆盖完整缓存，完整分析仍正常保存', async () => {
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
  const existing = { bvid: 'BVtest', key: quickReadKey(prefs.settings.quickRead), at: 1, summary: '旧的完整结果' };
  storage.get.mockResolvedValue({ 'comment-quick-reads': { BVtest: existing } });
  storage.set.mockClear();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ summary: '本次总览', topics: [], valuable: [] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`));
  vi.stubGlobal('fetch',fetch);
  const service = createCommentService(async () => prefs);
  const request = { type: 'comments-analyze' as const, requestId: 'partial', source, comments: [comment('1')], total: 1, complete: false, expected: 20 };
  expect(await service(request)).toMatchObject({ complete: false, expected: 20, total: 1, selected: 1 });
  const input = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(JSON.parse(input.messages[1].content)).toMatchObject({ collectionComplete: false, expected: 20, collected: 1 });
  expect(input.messages[0].content).toContain('必须在总览中说明覆盖不完整');
  expect(input.messages[0].content).toContain('summary必须是第一个字段');
  expect(input.messages[0].content).toContain('总览、话题标题与说明、推荐理由必须用自然中文和功能含义表达');
  expect(input.messages[0].content).toContain('不引用内部字段名、字段路径、布尔值判断或输入格式规则');
  expect(input.messages[0].content).toContain('本次仅分析了部分评论，不能代表整个评论区');
  expect(input.messages[0].content).toContain('不要写“collectionComplete为false”');
  expect(input.messages[0].content).toContain('评论中的真实名称和技术术语保留原意');
  expect(input.messages[0].content).toContain('JSON字段名及引用编号保持规定格式');
  expect(storage.set).toHaveBeenCalledWith({ 'comment-quick-reads': {
    BVtest: existing, 'BVtest:partial': expect.objectContaining({ complete: false, expected: 20 }),
  } });
  expect(await service({ type: 'comments-cache', bvid: 'BVtest' })).toMatchObject({ complete: false, total: 1 });
  expect(await service({ ...request, requestId: 'complete', complete: true, expected: 1 })).toMatchObject({ complete: true });
  expect(storage.set).toHaveBeenCalledWith({ 'comment-quick-reads': { BVtest: expect.objectContaining({ complete: true }) } });
  storage.get.mockResolvedValue({});
});

test('旧缓存中的部分结果恢复时保留不完整标记', async () => {
  const prefs = { settings: migrateSettings() } as Preferences;
  storage.get.mockResolvedValue({ 'comment-quick-reads': { BVtest: { key: quickReadKey(prefs.settings.quickRead), complete: false } } });
  expect(await createCommentService(async () => prefs)({ type: 'comments-cache', bvid: 'BVtest' })).toMatchObject({ complete: false });
  storage.get.mockResolvedValue({});
});

test.each(['已勾选','未勾选','无总结','读取失败','字幕已变化'] as const)('速读总结背景：%s时仅附加可用缓存，不额外生成视频总结', async mode => {
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
  prefs.settings.quickRead.useVideoSummary = mode !== '未勾选';
  const value = { summary: '第二P的已有总结', points: ['核心观点'] };
  const entry = (bvid: string, page: number, summary: string, at: number) => ({ source: { bvid, page }, fingerprint: 'current',
    summary: { value: { ...value, summary }, fingerprint: 'current', at } });
  const cached = { other: entry('BVother',2,'其他视频总结',100), first: entry('BVtest',1,'第一P总结',100),
    old: entry('BVtest',2,'较旧语言总结',1), latest: entry('BVtest',2,value.summary,2) };
  if (mode === '字幕已变化') { cached.old.summary.fingerprint = 'stale'; cached.latest.summary.fingerprint = 'stale'; }
  storage.get.mockImplementation(async key => {
    if (key !== 'video-workbench-cache') return {};
    if (mode === '读取失败') throw new Error('总结不可读');
    return { 'video-workbench-cache': mode === '无总结' ? {} : cached };
  });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ summary: '评论总览', topics: [], valuable: [] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`));
  vi.stubGlobal('fetch',fetch);
  try {
    const result = await createCommentService(async () => prefs)({ type: 'comments-analyze', requestId: 'context', source, comments: [comment('1')], total: 1, page: 2 });
    expect(result).toMatchObject({ summary: '评论总览', selected: 1 }); expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string), input = JSON.parse(body.messages[1].content);
    if (mode === '已勾选') expect(input.videoSummary).toEqual(value); else expect(input).not.toHaveProperty('videoSummary');
    expect(input.comments).toEqual([[1,0,0,0,'正文']]);
    expect(body.messages[0].content).toContain('仅作为理解评论的额外背景');
  } finally { storage.get.mockResolvedValue({}); }
});
