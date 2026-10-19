// 验证总结组件组合、引用边界、完整导出、局部预览和安全渲染。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { summaryOutputSchema, summaryPreview, summarySpec, summaryText, validateSummary } from '../src/video-summary';
import type { SummaryBlock, SummaryUI } from '../src/video-summary';
import { VideoSummary } from '../src/ui/ai/VideoSummary';

const item = { title: '<img src=x onerror=alert(1)>', text: '说明', detail: '折叠中的完整论据', ref: 1 };
const common = { title: '区块', condition: '重要限制', items: [item] };
const blocks: SummaryBlock[] = [
  { type: 'KeyPoints', props: common }, { type: 'Steps', props: common }, { type: 'Timeline', props: common },
  { type: 'Comparison', props: { title: '比较', condition: '主观体验', left: '甲', right: '乙', leftFit: '通勤', rightFit: '久戴',
    items: [{ title: '舒适', left: '有压力', right: '轻松', detail: '原始比较依据', ref: 1 }] } },
  { type: 'CausalChain', props: { title: '解释链', condition: '', items: [{ ...item, relation: '可能影响' },{ ...item, title: '结果', relation: '' }] } },
  { type: 'Argument', props: { ...common, speaker: '受访者', claim: '作者判断' } },
];
const rows = [{ start: 0, end: 30, text: '第一句' },{ start: 30, end: 40, text: '论据' }];
const ui = (block = blocks[0]!): SummaryUI => ({ headline: '核心结论', context: '全局条件', blocks: [block] });

test.each(blocks)('$type组件经过同一目录校验并由实际渲染器展示，引用使用真实时间', block => {
  const value = validateSummary(ui(block),0,1);
  expect(summaryOutputSchema.safeParse(value).success).toBe(true);
  const html = renderToStaticMarkup(createElement(VideoSummary,{ value, rows, seek: vi.fn() }));
  expect(html).toContain('00:30'); expect(html).toContain('核心结论');
  expect(html).not.toContain('<img');
  if (block.type !== 'CausalChain') expect(html).toContain(block.props.condition);
  expect(summaryText(value,rows)).toContain(block.props.items[0]!.detail);
});

test('混合内容保留模型选择的组件顺序，未开放未知组件和任意布局', () => {
  const value = { ...ui(), blocks: [blocks[2]!,blocks[3]!,blocks[0]!] };
  const spec = summarySpec(validateSummary(value,0,1));
  expect(spec.elements.summary!.children).toEqual(['block-0','block-1','block-2']);
  expect(spec.elements['block-0']!.type).toBe('Timeline');
  expect(summaryOutputSchema.safeParse({ ...ui(), blocks: [{ type: 'Script', props: {} }] }).success).toBe(false);
  expect(summaryOutputSchema.safeParse({ ...ui(), blocks }).success).toBe(false);
});

test('越界及合并时凭空添加的引用拒绝保存', () => {
  expect(() => validateSummary(ui(),0,0)).toThrow('引用');
  expect(() => validateSummary(ui(),0,1,new Set([0]))).toThrow('引用');
  expect(validateSummary(ui(),0,1,new Set([1]))).toEqual(ui());
});

test('预览接纳标题和已完成区块，过滤残缺或越界组件；生成期间禁用定位', () => {
  const preview = summaryPreview({ headline: '正在形成', blocks: [blocks[0],{ type: 'Steps', props: { title: '未完整' } }] },0,1);
  expect(preview.headline).toBe('正在形成'); expect(preview.blocks).toHaveLength(1);
  expect(summaryPreview(ui(),0,0).blocks).toEqual([]);
  const html = renderToStaticMarkup(createElement(VideoSummary,{ value: preview, rows, seek: vi.fn(), streaming: true }));
  expect(html).toMatch(/<button[^>]*disabled/); expect(html).toContain('aria-busy="true"');
});

test.each(blocks)('$type：追加未完成条目保留原内容，完整后追加', block => {
  const original = summaryPreview(ui(block),0,1);
  const unfinished = { ...block, props: { ...block.props, items: [...block.props.items,{ title: '下一条' }] } };
  const during = summaryPreview(ui(unfinished as SummaryBlock),0,1);
  expect(during).toEqual(original);
  const appended = { ...block.props.items[0]!, title: '下一条' };
  const completed = { ...block, props: { ...block.props, items: [...block.props.items,appended] } };
  const after = summaryPreview(ui(completed as SummaryBlock),0,1);
  expect(after.blocks[0]?.props.items).toEqual([...block.props.items,appended]);
  expect(summarySpec(during).elements.summary!.children).toEqual(summarySpec(after).elements.summary!.children);
});

test('尚未完整的前置区块不被跳过，后续区块不会占用其渲染位置', () => {
  const pending = { type: 'Steps', props: { title: '未完成', items: [] } };
  const preview = summaryPreview({ headline: '结论', context: '', blocks: [pending,blocks[0]] },0,1);
  expect(preview.blocks).toEqual([]);
});

test.each(['KeyPoints','Steps','Timeline'] as const)('%s所有条目直接可见，完整依据仍可展开及复制', type => {
  const steps = ui({ type, props: { ...common, items: Array.from({ length: 5 },(_,i) => ({ ...item, title: `步骤${i+1}` })) } });
  const text = summaryText(steps,rows);
  expect(text).toContain('步骤5'); expect(text).toContain('重要限制'); expect(text).toContain('折叠中的完整论据');
  expect(summaryText(ui(blocks[5]!),rows)).toContain('受访者：作者判断');
  const html = renderToStaticMarkup(createElement(VideoSummary,{ value: steps, rows, seek: vi.fn() }));
  const visibleItems = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  expect(visibleItems).toContain('步骤4'); expect(visibleItems).toContain('步骤5');
  expect(html).toContain('summary-detail');
  expect(html).not.toContain('<details open');
});
