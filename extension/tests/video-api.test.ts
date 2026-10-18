// 验证视频和字幕资源的请求边界、媒体格式标注及不向网页泄漏下载地址。
import { afterEach, expect, test, vi } from 'vitest';
import { mediaResource, readVideoRows, readVideoSource, subtitleResource, videoMedia } from '../src/video-api';
import type { VideoSource } from '../src/video-types';
vi.mock('wxt/browser',() => ({ browser: { storage: { local: { get: async () => ({}),set: async () => {} } } } }));
const signingData = { wbi_img: { img_url: 'https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png',sub_url: 'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png' } };

afterEach(() => vi.unstubAllGlobals());
test('字幕和媒体仅允许B站受控资源域名，保留签名查询', () => {
  expect(subtitleResource('//aisubtitle.hdslb.com/a?auth_key=abc')).toBe('https://aisubtitle.hdslb.com/a?auth_key=abc');
  expect(mediaResource('http://cdn.bilivideo.com/a?sig=123')).toBe('https://cdn.bilivideo.com/a?sig=123');
  for (const value of ['https://evil.invalid/a','https://hdslb.com.evil.invalid/a','https://user:secret@aisubtitle.hdslb.com/a','http://aisubtitle.hdslb.com/a']) expect(() => subtitleResource(value)).toThrow();
  expect(() => mediaResource('https://127.0.0.1/a')).toThrow();
});
test('源信息正确选择P2，字幕接口异常仍允许展示媒体入口', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/view?') ? { code: 0, data: { aid: 123, title: '课程', pages: [{ page: 1, cid: 10, part: '第一课', duration: 30 },{ page: 2, cid: 20, part: '第二课', duration: 60 }] } } : { code: -101, message: '请登录' }))));
  expect(await readVideoSource('BVsource',2)).toMatchObject({ cid: 20, page: 2, part: '第二课', tracks: [], subtitleError: expect.stringContaining('登录') });
  await expect(readVideoSource('BVsource',3)).rejects.toThrow('分P');
});
test('字幕正文请求不携带账号信息，错误资源不发出请求', async () => {
  const mock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/x/player/') ? { code: 0, data: { subtitle: { subtitles: [{ lan: 'zh', subtitle_url: '//aisubtitle.hdslb.com/test' }] } } } : { body: [{ from: 0, to: 2, content: '正文' }] })));
  vi.stubGlobal('fetch',mock);
  expect(await readVideoRows({ aid: 1, cid: 2 } as VideoSource,'zh')).toEqual([{ start: 0, end: 2, text: '正文' }]);
  expect(mock.mock.calls[1]).toEqual(['https://aisubtitle.hdslb.com/test',expect.objectContaining({ credentials: 'omit', redirect: 'error' })]);
});

test('元数据同时读取官方章节，没有字幕仍可显示章节', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => new Response(JSON.stringify({ code: 0, data: url.includes('/view?')
    ? { aid: 1, title: '教程', pages: [{ page: 1, cid: 100, part: '教程', duration: 60 }] }
    : { subtitle: { subtitles: [] }, view_points: [{ type: 2, from: 0, to: 20, content: '开头' },{ type: 2, from: 20, to: 60, content: '正文' }] } }))));
  const source = await readVideoSource('BVnative',1);
  expect(source.tracks).toEqual([]); expect(source.nativeChapters?.map(chapter => chapter.title)).toEqual(['开头','正文']);
});
test('完整MP4、纯视频和音频格式明确区分，下载地址不由页面提供', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => new Response(JSON.stringify({ code: 0, data: url.includes('/view?') ? { aid: 1, title: '视频', pages: [{ page: 1, cid: 7, duration: 20, part: '一' }] }
    : url.endsWith('/nav') ? signingData : url.includes('fnval=1&') ? { quality: 64, format: 'mp4720', accept_quality: [64], accept_description: ['720P'], durl: [{ url: 'https://cdn.bilivideo.com/full.mp4', size: 100 }] }
    : { quality: 80, format: 'dash', accept_quality: [80], accept_description: ['1080P'], dash: { video: [{ id: 80, codecs: 'avc1', bandwidth: 1000000, baseUrl: 'https://cdn.bilivideo.com/video.m4s' }], audio: [{ id: 30280, codecs: 'mp4a', bandwidth: 128000, baseUrl: 'https://cdn.bilivideo.com/audio.m4s' }] } } }))));
  const media = await videoMedia('BVmedia',7);
  expect(media.map(m => [m.kind,m.combined,m.extension])).toEqual([['video',true,'mp4'],['video',false,'mp4'],['audio',false,'m4a']]);
  expect(media[1]!.label).toContain('仅画面'); expect(media[0]!.label).toContain('含声音');
});

test('不支持的主节点使用常规CDN备用地址，单个无效格式不影响其他格式', async () => {
  vi.stubGlobal('fetch',vi.fn(async (url: string) => new Response(JSON.stringify({ code: 0, data: url.includes('/view?')
    ? { aid: 1, title: '视频', pages: [{ page: 1, cid: 8, duration: 20, part: '一' }] }
    : url.endsWith('/nav') ? signingData : url.includes('fnval=1&') ? { quality: 64, format: 'mp4720', durl: [{ url: 'https://75un29t.edge.mountaintoys.cn/full.mp4', backup_url: ['https://upos-sz-mirrorcoso1.bilivideo.com/full.mp4?sig=ok'], size: 100 }] }
    : { quality: 80, format: 'dash', dash: { video: [{ id: 80, codecs: 'avc1', bandwidth: 1000000, baseUrl: 'https://edge.mountaintoys.cn/video.m4s', backupUrl: ['https://cdn.bilivideo.com/video.m4s'] },{ id: 64, codecs: 'avc1', baseUrl: 'https://unsupported.invalid/only.m4s' }], audio: [{ id: 30280, codecs: 'mp4a', bandwidth: 128000, base_url: 'https://edge.mountaintoys.cn/audio.m4s', backup_url: ['https://cdn.bilivideo.com/audio.m4s'] }] } } }))));
  const media = await videoMedia('BVfallback',8);
  expect(media).toHaveLength(3); expect(media[0]!.url).toBe('https://upos-sz-mirrorcoso1.bilivideo.com/full.mp4?sig=ok');
  expect(media.every(item => new URL(item.url).hostname.endsWith('.bilivideo.com'))).toBe(true);
});

test.each([false,true])('媒体接口受限立即停止其他格式请求；已获取格式仍可用：%s',async partial => {
  vi.resetModules(); const { videoMedia: readMedia } = await import('../src/video-api');
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/view?')) return Response.json({ code: 0,data: { pages: [{ cid: 9 }] } });
    if (url.endsWith('/nav')) return Response.json({ code: -101,data: signingData });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/x/player/wbi/playurl'); expect(parsed.searchParams.get('w_rid')).toMatch(/^[a-f\d]{32}$/);
    return partial && parsed.searchParams.get('fnval') === '1' ? Response.json({ code: 0,data: { format: 'mp4720',quality: 64,durl: [{ url: 'https://cdn.bilivideo.com/full.mp4' }] } }) : new Response('',{ status: 412 });
  }); vi.stubGlobal('fetch',fetch);
  if (partial) expect(await readMedia('BVlimited',9)).toMatchObject([{ id: 'mp4',combined: true }]);
  else await expect(readMedia('BVlimited',9)).rejects.toMatchObject({ kind: 'limited' });
  await expect(readMedia('BVlimited',9)).rejects.toMatchObject({ kind: 'cooldown' });
  expect(fetch).toHaveBeenCalledTimes(partial ? 4 : 3);
});
