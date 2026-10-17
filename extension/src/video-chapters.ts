// 让模型提供语义起点，由程序推导连续章节范围并保留广告边界。
import { chaptersOutputSchema } from './analysis/schemas';
import { validateChapters } from './video-data';
import type { SubtitleRow, VideoChapter } from './video-types';

export function chaptersFromStarts(value: unknown, rows: SubtitleRow[], first: number, last: number): VideoChapter[] {
  const parsed = chaptersOutputSchema.safeParse(value);
  if (!parsed.success || !parsed.data.chapters.length) throw new Error('模型未返回有效章节，未保存结果。');
  const starts = parsed.data.chapters;
  if (starts[0]!.first !== first || starts.some((item,index) => item.first < first || item.first > last || (index > 0 && item.first <= starts[index-1]!.first))) {
    throw new Error(`章节起始行无效，首章须从${first}开始，后续起点须递增且不超过${last}，未保存结果。`);
  }
  return validateChapters(starts.map((item,index) => ({ ...item, last: (starts[index+1]?.first ?? last+1)-1 })),rows);
}

export function validateChapterMerge(chapters: VideoChapter[], candidates: VideoChapter[]) {
  const starts = new Set(candidates.map(chapter => chapter.first));
  if (chapters.some(chapter => !starts.has(chapter.first) || (chapter.ad && !candidates.some(candidate => candidate.ad && candidate.first === chapter.first && candidate.last === chapter.last))) || candidates.filter(chapter => chapter.ad).some(ad =>
    !chapters.some(chapter => chapter.ad && chapter.first === ad.first && chapter.last === ad.last))) {
    throw new Error('章节合并改变了候选起点或广告区间，未保存结果。');
  }
}

export function chapterBoundaryInstruction(first: number, last: number) {
  return `本次字幕首行号为${first}，末行号为${last}。必须阅读全部字幕，包括总结、补充说明和结束语，不能把“本节就到这”等口播当成字幕结束。先规划完整的章节起点，再输出JSON对象 {"chapters":[{"first":字幕起始行号,"title":"短标题","summary":"本章要点","ad":false}]}。第一章first必须为${first}，其余first严格递增且不超过${last}，只能使用输入中真实存在的行号。不要输出last，程序会将每章结束行设为下一章first减1，末章覆盖到${last}。生成前检查所有主题和末尾补充内容均已纳入章节。识别明确商业推广口播，开场和求三连不算广告，不确定时ad=false。`;
}
