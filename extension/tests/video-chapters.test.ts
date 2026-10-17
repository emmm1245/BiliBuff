// 验证程序推导章节结束行、连续覆盖与广告区间，覆盖尾部遗漏的回归样例。
import { expect, test } from 'vitest';
import { chapterBoundaryInstruction, chaptersFromStarts, validateChapterMerge } from '../src/video-chapters';
import type { VideoChapter } from '../src/video-types';
const rows = Array.from({ length: 527 },(_,index) => ({ start: index, end: index+1, text: index >= 516 ? 'DeepSeek兼容性补充与结束语' : '字幕' }));
const item = (first: number, ad = false) => ({ first, title: '章节'+first, summary: '本章要点', ad });

test('只提交语义起点时，末章覆盖到526，旧last=515字段不再导致漏尾', () => {
  const chapters = chaptersFromStarts({ chapters: [0,50,110,180,250,310,380,450].map(first => ({ ...item(first), last: first === 450 ? 515 : first+49 })) },rows,0,526);
  expect(chapters.at(-1)).toMatchObject({ first: 450, last: 526 });
  expect(chapters.every((chapter,index) => index === 0 || chapter.first === chapters[index-1]!.last+1)).toBe(true);
  const prompt = chapterBoundaryInstruction(0,526);
  expect(prompt).toContain('末行号为526'); expect(prompt).toContain('补充说明和结束语');
});

test.each([[1,10],[0,0],[0,527],[0,20,10]])('非法起点%s不会通过校验', (...starts: number[]) => {
  expect(() => chaptersFromStarts({ chapters: starts.map(first => item(first)) },rows,0,526)).toThrow('起始行无效');
});

test('分块使用全局行号，只推导当前片段的结束边界', () => {
  expect(chaptersFromStarts({ chapters: [item(50),item(60)] },rows,50,69).map(({first,last}) => [first,last])).toEqual([[50,59],[60,69]]);
});

test('全片归并只使用候选起点，不能把广告并入正文或新增广告', () => {
  const candidates = chaptersFromStarts({ chapters: [item(0),item(100,true),item(110),item(200)] },rows,0,526);
  const valid = chaptersFromStarts({ chapters: [item(0),item(100,true),item(110)] },rows,0,526);
  expect(() => validateChapterMerge(valid,candidates)).not.toThrow();
  for (const bad of [chaptersFromStarts({ chapters: [item(0),item(110)] },rows,0,526),
    chaptersFromStarts({ chapters: [item(0),item(100,true),item(111)] },rows,0,526)]) expect(() => validateChapterMerge(bad,candidates)).toThrow('广告区间');
  const invented: VideoChapter[] = valid.map((chapter,index) => index === 2 ? { ...chapter, ad: true } : chapter);
  expect(() => validateChapterMerge(invented,candidates)).toThrow('广告区间');
});
