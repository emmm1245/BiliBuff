// 为通用搜索计划规范化查询、选择独立页码，并根据真实供给使用有界替代查询。
import { z } from 'zod';
import type { BrowseQueryResult, BrowseSearchTask } from './browse-types';

export const browseSearchPlanSchema = z.object({ searches: z.array(z.object({
  query: z.string().trim().min(1).max(80), intent: z.string().trim().min(1).max(100), scopeKey: z.string().trim().min(1).max(100),
  order: z.enum(['totalrank','pubdate']), fallback: z.string().trim().max(80),
})).max(4) });
export const browseSearchTask = `规划最多4项B站搜索任务，输出 {"searches":[{"query":"实际搜索词","intent":"搜索用途","scopeKey":"目标主题","order":"totalrank","fallback":"供给不足时的替代表达，可为空"}]}。
紧扣原计划和用户明确补充，结合主题覆盖、近期搜索及逐查询效果，区分寻找系统内容、具体知识点、实际问题、常用术语/别名和近期内容。无需每类都有，也不平均分配主题。
搜索词采用真实标题常见的少量高信息量词，例如领域、知识点、必要的形式；不堆叠夸赞词、无必要年份、长计划简称，不使用未经验证的高级搜索语法，不假定分P标题能召回课程。
order为totalrank（综合）或pubdate（最近发布），通用内容不强制最新。fallback应改变限制程度或有效表达，不能只加减空格。
请求失败是来源故障，不代表主题没有供给；成功但无结果时适度放宽词，成功但跑题时增加限定，大量重复时换角度，已覆盖充足的方向降低优先级。优质方向可深入互补子主题。只输出真实任务，允许空数组停止搜索。`;

export function normalizeBrowseQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu,char => '#+./_-'.includes(char) ? char : '');
}
export function browseQueryKey(task: Pick<BrowseSearchTask,'query' | 'order'>) { return `${task.order}:${normalizeBrowseQuery(task.query)}`; }
export function browseQueryPage(history: BrowseQueryResult[], task: BrowseSearchTask) {
  const key = browseQueryKey(task), previous = history.findLast(item => item.key === key && item.ok);
  if (task.order === 'pubdate' && previous && Date.now()-previous.at >= 6*3600000) return 1;
  return previous ? previous.page+1 : 1;
}
function similar(a: string, b: string) {
  // 不用高字面相似度合并科目、编程语言或版本，避免“只差一字”实为不同目标。
  const plain = (s: string) => s.replace(/超详细|最详细|保姆级|全网最全/g,'');
  return plain(a) === plain(b);
}
export function prepareBrowseSearches(tasks: BrowseSearchTask[], history: BrowseQueryResult[], skipped: { query: string; reason: string }[] = []) {
  const result: BrowseSearchTask[] = [];
  for (const proposed of tasks) {
    let task = { ...proposed };
    const equivalent = history.findLast(item => item.order === task.order && normalizeBrowseQuery(item.scopeKey) === normalizeBrowseQuery(task.scopeKey) &&
      normalizeBrowseQuery(item.intent) === normalizeBrowseQuery(task.intent) && similar(normalizeBrowseQuery(item.query),normalizeBrowseQuery(task.query)));
    if (equivalent && task.query !== equivalent.query) { task.originalQuery = task.query; task.query = equivalent.query; }
    const last = history.findLast(item => item.key === browseQueryKey(task));
    const refreshLatest = task.order === 'pubdate' && last && Date.now()-last.at >= 6*3600000;
    if (last?.ok && !refreshLatest && (!last.returned || !last.added)) {
      if (!task.fallback || normalizeBrowseQuery(task.fallback) === normalizeBrowseQuery(task.query)) { skipped.push({ query: proposed.query,reason: 'exhausted' }); continue; }
      task = { ...task,originalQuery: proposed.query,query: task.fallback,fallback: '' };
      const alternate = history.findLast(item => item.key === browseQueryKey(task));
      if (alternate?.ok && (!alternate.returned || !alternate.added)) { skipped.push({ query: proposed.query,reason: 'alternate-exhausted' }); continue; }
    }
    if (result.some(item => browseQueryKey(item) === browseQueryKey(task) || (item.order === task.order && normalizeBrowseQuery(item.scopeKey) === normalizeBrowseQuery(task.scopeKey) &&
        normalizeBrowseQuery(item.intent) === normalizeBrowseQuery(task.intent) && similar(normalizeBrowseQuery(item.query),normalizeBrowseQuery(task.query))))) { skipped.push({ query: proposed.query,reason: 'duplicate' }); continue; }
    result.push(task);
  }
  return result;
}
export function browseSearchSummary(history: BrowseQueryResult[]) {
  return history.slice(-24).map(({ query,intent,scopeKey,order,page,ok,errorKind,returned,added,filtered,shortlisted,qualified,published }) =>
    ({ query,intent,scopeKey,order,page,ok,errorKind,returned,added,filtered,shortlisted,qualified,published }));
}
