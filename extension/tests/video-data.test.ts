// 验证字幕时间轴、分P路由、完整分块、导出和模型章节引用的关键边界。
import { expect, test } from 'vitest';
import { activeSubtitle, indexedChunks, safeFilename, subtitleFingerprint, subtitleRows, subtitleText, validateChapters, videoRoute } from '../src/video-data';
import type { VideoCache } from '../src/video-types';

const rows = [{ start: 0, end: 1.9996, text: '第一句' },{ start: 2, end: 4, text: '第二句' }];
const cache = { source: { title: '测试视频', part: '第二课', page: 2, bvid: 'BVtest' }, rows } as VideoCache;
test('分P及列表路由不把同稿件不同P合并，拒绝畸形参数', () => {
  expect(videoRoute('/video/BVtest/','?p=2')).toEqual({ bvid: 'BVtest', page: 2 });
  expect(videoRoute('/list/watchlater','?bvid=BVtest&cid=456')).toEqual({ bvid: 'BVtest', page: 1, cid: 456 });
  expect(videoRoute('/video/BVtest/','?p=-2&cid=bad')).toEqual({ bvid: 'BVtest', page: 1 });
  expect(videoRoute('/','?bvid=BVtest').bvid).toBe('');
});
test('已有字幕保留原文，清除坏时间轴并按真实时间排序', () => {
  expect(subtitleRows([{ from: 2, to: 4, content: '关注机制也是课程内容' },{ from: 0, to: 2, content: '【保留关键限定】' },{ from: -1, to: 2, content: '坏数据' }]))
    .toEqual([{ start: 0, end: 2, text: '【保留关键限定】' },{ start: 2, end: 4, text: '关注机制也是课程内容' }]);
});
test('超长视频分块完整保留最后一句和全局行号', () => {
  const long = Array.from({ length: 1000 },(_,i) => ({ start: i*2, end: i*2+2, text: `第${i}句，完整字幕不能静默截断。`.repeat(8) }));
  const chunks = indexedChunks(long,1000), ids = [...chunks.map(c => c.text).join('').matchAll(/^(\d+) \[/gm)].map(m => Number(m[1]));
  expect(chunks.length).toBeGreaterThan(1); expect(ids).toEqual(long.map((_,i) => i));
  expect(chunks.at(-1)?.text).toContain('第999句'); expect(chunks.at(-1)?.last).toBe(999);
});
test('字幕导出正确处理毫秒进位，带来源与对应分P', () => {
  expect(subtitleText(cache,'srt')).toContain('00:00:00,000 --> 00:00:02,000');
  expect(subtitleText(cache,'timed')).toContain('?p=2'); expect(subtitleText(cache,'timed')).toContain('[00:02] 第二句');
  expect(subtitleText(cache,'text')).toContain('第一句\n第二句'); expect(safeFilename('a/b:*?<>"|')).toBe('a_b_______');
});
test('章节引用必须存在且不重叠，广告边界由字幕确定', () => {
  expect(validateChapters([{ first: 0, last: 1, title: ' 推广 ', summary: '商业广告', ad: true }],rows)[0]).toMatchObject({ title: '推广', ad: true });
  for (const first of [-1,0.5,2]) expect(() => validateChapters([{ first, last: 3, title: 'bad', summary: '', ad: false }],rows)).toThrow();
  expect(() => validateChapters([{ first: 0, last: 1, title: 'a', summary: '', ad: false },{ first: 1, last: 1, title: 'b', summary: '', ad: false }],rows)).toThrow('重叠');
});
test('播放高亮尊重字幕结束和空档，正文变化使缓存指纹失效', async () => {
  expect(activeSubtitle(rows,0)).toBe(0); expect(activeSubtitle(rows,1.9999)).toBe(-1); expect(activeSubtitle(rows,2)).toBe(1); expect(activeSubtitle(rows,4)).toBe(-1);
  expect(await subtitleFingerprint(rows)).not.toBe(await subtitleFingerprint([{ ...rows[0]!, text: '内容已修改' },rows[1]!]));
});
