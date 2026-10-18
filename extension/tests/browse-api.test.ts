// 验证真实接口格式的时长、搜索标题、广告过滤和字幕分散抽样。
import { afterEach, expect, test, vi } from 'vitest';
const tags = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => ({ read: vi.fn(async () => null as { tags: string[] } | null),save: vi.fn(async () => {}) }));
vi.mock('../src/tags',() => ({ requestTags: tags }));
vi.mock('../src/database',() => ({ cachedTags: cache.read,saveTags: cache.save }));
import { browseDuration, browseEvidence, browseVideo, plainBrowseText, subtitleExcerpt } from '../src/browse-api';
import { createBrowseNetwork } from '../src/browse-network';
import type { BrowseRequestLog } from '../src/browse-types';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('搜索结果去除标题高亮并识别单数字秒，过滤广告和付费内容', () => {
  const video = browseVideo({ bvid: 'BVtest',title: '理解<em class="keyword">矩阵</em>&amp;向量',duration: '205:1',tag: '数学,矩阵',pic: '//i0.hdslb.com/test.jpg' },'search');
  expect(video).toMatchObject({ title: '理解矩阵&向量',duration: 12301,tags: ['数学','矩阵'],cover: 'https://i0.hdslb.com/test.jpg' });
  expect(browseDuration('1:02:03')).toBe(3723); expect(browseDuration('bad')).toBe(0);
  expect(plainBrowseText('&quot;课程&quot;')).toBe('"课程"');
  expect(browseVideo({ bvid: 'BVad',title: '广告',goto: 'ad' },'home')).toBeNull();
  expect(browseVideo({ bvid: 'BVpaid',title: '付费',is_pay: 1 },'search')).toBeNull();
});
test('字幕采样覆盖中后段且限定模型输入长度', () => {
  const rows = Array.from({ length: 1000 },(_,i) => ({ content: `${i}：${'字幕'.repeat(150)}` }));
  const excerpt = subtitleExcerpt(rows);
  expect(excerpt.length).toBeLessThanOrEqual(6000);
  expect(excerpt).toContain('0：'); expect(excerpt).toContain('999：');
});
test.each(['http://i2.hdslb.com/cover.jpg','https://i2.hdslb.com/cover.jpg','//i2.hdslb.com/cover.jpg'])('保留B站原封面并使用加密地址：%s', pic => {
  expect(browseVideo({ bvid: 'BVcover',title: '视频',pic },'home')?.cover).toBe('https://i2.hdslb.com/cover.jpg');
});
test('精选核验读取真实简介、标签与字幕，标注第一分P的证据范围', async () => {
  tags.mockResolvedValue(['矩阵','线性代数']);
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/view?')) return Response.json({ code: 0,data: { bvid: 'BVtest',title: '实际标题',desc: '实际简介',state: 0,aid: 1,pages: [{ cid: 2,part: '矩阵' },{ cid: 3,part: '向量' }] } });
    if (url.includes('/x/player/')) return Response.json({ code: 0,data: { subtitle: { subtitles: [{ lan: 'ai-zh',subtitle_url: 'https://aisub.hdslb.com/subtitle.json' }] } } });
    return Response.json({ body: [{ content: '真实字幕片段' }] });
  });
  vi.stubGlobal('fetch',fetch);
  const video = browseVideo({ bvid: 'BVtest',title: '旧标题',pic: 'https://i0.hdslb.com/original.jpg' },'search')!;
  const result = await browseEvidence(video,new AbortController().signal);
  expect(result).toMatchObject({ title: '实际标题',cover: 'https://i0.hdslb.com/original.jpg',description: '实际简介',tags: ['矩阵','线性代数'],parts: ['矩阵','向量'],excerpt: '真实字幕片段' });
  expect(result.coverage).toContain('第1分P'); expect(result.coverage).toContain('2个分P');
  expect(fetch.mock.calls[2]![0]).toBe('https://aisub.hdslb.com/subtitle.json');
});

test('保留超过30P的完整标题和各P时长，仍只请求第一P字幕', async () => {
  tags.mockResolvedValue([]);
  const pages = Array.from({ length: 80 },(_,i) => ({ cid: 100+i,part: `第${i+1}章`,duration: (i+1)*60 }));
  const fetch = vi.fn(async (url: string) => url.includes('/view?') ?
    Response.json({ code: 0,data: { bvid: 'BVcourse',title: '课程',state: 0,aid: 9,pages } }) :
    Response.json({ code: 0,data: { subtitle: { subtitles: [] } } }));
  vi.stubGlobal('fetch',fetch);
  const result = await browseEvidence(browseVideo({ bvid: 'BVcourse',title: '课程' },'search')!,new AbortController().signal);
  expect(result.parts).toHaveLength(80); expect(result.parts.at(-1)).toBe('第80章');
  expect(result.chapters?.at(-1)).toMatchObject({ page: 80,duration: 4800 });
  expect(result.partCount).toBe(80);
  expect(fetch.mock.calls.filter(([url]) => url.includes('/x/player/'))).toHaveLength(1);
  expect(fetch.mock.calls[1]![0]).toContain('cid=100');
});

test('停止选片可立即结束标签队列等待，不被来源冷却拖住', async () => {
  tags.mockClear();
  tags.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ code: 0,data: { bvid: 'BVcourse',title: '课程',state: 0,aid: 9,pages: [] } })));
  const controller = new AbortController();
  const pending = browseEvidence(browseVideo({ bvid: 'BVcourse',title: '课程' },'search')!,controller.signal);
  const check = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(tags).toHaveBeenCalled()); controller.abort(); await check;
});

test('实际取证链路的详情、标签、第一P播放器和字幕全部经过统一预算', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    if (url.includes('/view?')) return Response.json({ code: 0,data: { bvid: 'BVall',title: '教程',state: 0,aid: 1,pages: [{ cid: 2,part: '第一P',duration: 900 },{ cid: 3,part: '第二P',duration: 600 }] } });
    if (url.includes('/tags?')) return Response.json({ code: 0,data: [{ tag_name: '教程' }] });
    if (url.includes('/x/player/')) return Response.json({ code: 0,data: { subtitle: { subtitles: [{ lan: 'zh',subtitle_url: 'https://aisub.hdslb.com/one.json' }] } } });
    return Response.json({ body: [{ content: '第一P字幕' }] });
  }));
  const logs: BrowseRequestLog[] = [], controller = new AbortController(), network = createBrowseNetwork(controller.signal,logs,new Map());
  const pending = browseEvidence(browseVideo({ bvid: 'BVall',title: '教程' },'search')!,controller.signal,network);
  await vi.runAllTimersAsync(); const result = await pending;
  expect(logs.map(log => log.kind)).toEqual(['detail','tags','player','subtitle']);
  expect(network.remaining).toBe(176); expect(result.checkedPage).toBe(1);
  expect(result.chapters).toHaveLength(2); expect(result.tags).toEqual(['教程']);
  expect(cache.save).toHaveBeenCalledWith('BVall',['教程']);
});

test('统一预算保留已有标签缓存，命中缓存不额外请求标签接口', async () => {
  vi.useFakeTimers(); cache.read.mockResolvedValueOnce({ tags: ['缓存标签'] });
  const fetch = vi.fn(async (url: string) => url.includes('/view?') ?
    Response.json({ code: 0,data: { bvid: 'BVcached',title: '教程',state: 0,aid: 1,pages: [{ cid: 2,part: '第一P' }] } }) :
    Response.json({ code: 0,data: { subtitle: { subtitles: [] } } }));
  vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], controller = new AbortController(), network = createBrowseNetwork(controller.signal,logs,new Map());
  const pending = browseEvidence(browseVideo({ bvid: 'BVcached',title: '教程' },'search')!,controller.signal,network);
  await vi.runAllTimersAsync(); const result = await pending;
  expect(result.tags).toEqual(['缓存标签']); expect(logs.map(log => log.kind)).toEqual(['detail','player']);
  expect(fetch).toHaveBeenCalledTimes(2);
});
