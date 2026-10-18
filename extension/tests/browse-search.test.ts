// 验证查询独立分页、失败与空结果的区分、替代搜索和近似任务去重。
import { expect, test } from 'vitest';
import { browseQueryKey, browseQueryPage, normalizeBrowseQuery, prepareBrowseSearches } from '../src/browse-search';
import type { BrowseQueryResult, BrowseSearchTask } from '../src/browse-types';

const task = (query = '自然光 人像', order: BrowseSearchTask['order'] = 'totalrank'): BrowseSearchTask => ({ query,order,intent: '实拍演示',scopeKey: '摄影',fallback: '人像 用光' });
const record = (query: BrowseSearchTask, change: Partial<BrowseQueryResult> = {}): BrowseQueryResult => ({ ...query,id: 'query',key: browseQueryKey(query),
  page: 1,at: 1,ok: true,durationMs: 1,returned: 20,rawReturned: 20,added: 12,filtered: 0,shortlisted: 3,qualified: 2,pooled: 1,published: 1,...change });
test('新查询第一页，相同查询按规范化标识继续，不同查询和排序互不串页', () => {
  const history = [record(task(),{ page: 3 })];
  expect(browseQueryPage(history,task('自然光人像'))).toBe(4);
  expect(browseQueryPage(history,task('自然光 构图'))).toBe(1);
  expect(browseQueryPage(history,task('自然光 人像','pubdate'))).toBe(1);
  expect(normalizeBrowseQuery('  ＡＩ：摄影 ')).toBe('ai摄影');
});
test('请求失败不推进页码、不触发缺片替代；成功但空或重复才尝试替代表达', () => {
  const failed = record(task(),{ ok: false,errorKind: 'limited',returned: 0,added: 0 });
  expect(browseQueryPage([failed],task())).toBe(1);
  expect(prepareBrowseSearches([task()],[failed])[0]?.query).toBe('自然光 人像');
  const empty = record(task(),{ returned: 0,added: 0 });
  const alternate = prepareBrowseSearches([task()],[empty])[0]!;
  expect(alternate.query).toBe('人像 用光'); expect(browseQueryPage([empty],alternate)).toBe(1);
  expect(alternate.originalQuery).toBe('自然光 人像');
  expect(prepareBrowseSearches([task()],[record(task(),{ added: 0 })])[0]?.query).toBe('人像 用光');
});
test('原查询与替代查询均无新增时不重复空刷，同方向近似重复合并但保留不同主题', () => {
  const alternate = { ...task(),query: '人像 用光' };
  const skipped: { query: string; reason: string }[] = [];
  expect(prepareBrowseSearches([task()],[record(task(),{ added: 0 }),record(alternate,{ added: 0 })],skipped)).toEqual([]);
  expect(skipped).toEqual([{ query: task().query,reason: 'alternate-exhausted' }]);
  expect(prepareBrowseSearches([task(),task('自然光人像')],[])).toHaveLength(1);
  expect(prepareBrowseSearches([task(),{ ...task(),query: '自然光 建筑',scopeKey: '建筑' }],[])).toHaveLength(2);
  expect(prepareBrowseSearches([task(),{ ...task(),scopeKey: '建筑' }],[])).toHaveLength(1);
});

test('最近发布查询过一段时间返回第一页获取新稿，同一轮仍可继续翻页', () => {
  const latest = task('自然光 人像','pubdate');
  expect(browseQueryPage([record(latest,{ at: Date.now() })],latest)).toBe(2);
  expect(browseQueryPage([record(latest,{ at: Date.now()-7*3600000 })],latest)).toBe(1);
  expect(prepareBrowseSearches([latest],[record(latest,{ at: Date.now()-7*3600000,added: 0 })])[0]?.query).toBe(latest.query);
});

test('仅去除空格与明确的修饰词，不混淆语言符号、版本或只差一字的目标', () => {
  expect(browseQueryKey(task('C# 入门'))).not.toBe(browseQueryKey(task('C 入门')));
  expect(browseQueryKey(task('Python 3.10'))).not.toBe(browseQueryKey(task('Python 310')));
  expect(prepareBrowseSearches([task('数学一 基础课程'),task('数学二 基础课程')],[])).toHaveLength(2);
  const prior = task('人像构图实拍讲解');
  const next = prepareBrowseSearches([task('超详细人像构图实拍讲解')],[record(prior,{ page: 2 })])[0]!;
  expect(browseQueryPage([record(prior,{ page: 2 })],next)).toBe(3);
});
