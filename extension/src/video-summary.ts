// 定义视频总结的组件目录、结构校验、流式预览和完整文本转换。
import { defineCatalog, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { clock } from './video-data';
import type { SubtitleRow } from './video-types';

const title = z.string().trim().min(1).max(100);
const reference = z.number().int().nonnegative();
const item = z.object({ title, text: z.string().max(240), detail: z.string().max(1200), ref: reference });
const group = z.object({ title, condition: z.string().max(240), items: z.array(item).min(1).max(5) });
export const summaryComponents = {
  KeyPoints: { props: group, description: '核心要点：独立的重要信息，无明确关系时优先使用，不重复顶部结论。' },
  Steps: { props: group, description: '步骤：有依据的先后操作，最多5步，不补写字幕未讲的操作。' },
  Comparison: { props: z.object({ title, condition: z.string().max(240),
    left: title, right: title, leftFit: z.string().max(120), rightFit: z.string().max(120),
    items: z.array(z.object({ title, left: z.string().max(160), right: z.string().max(160), detail: z.string().max(1200), ref: reference })).min(1).max(3) }),
    description: '对比：明确比较的两个对象、适用条件与最多3个差异维度，不编写未知值和评分。' },
  CausalChain: { props: group.extend({ items: z.array(item.extend({ relation: z.string().max(60) })).min(2).max(4) }),
    description: '因果链：有明确依据的原因、过程或影响。relation说明与下一节点关系，末项为空；区分因果、相关和推测。' },
  Argument: { props: group.extend({ speaker: title, claim: title, items: z.array(item).min(1).max(3) }),
    description: '观点依据：说清speaker表达者、claim主张、论据与成立条件，预测不得转为事实。' },
  Timeline: { props: group, description: '时间线：事件或路线的阶段变化，条目标题写事件时间或阶段，ref仅为播放定位行号。' },
};
export const summaryCatalog = defineCatalog(schema, { components: summaryComponents, actions: {} });
export const summaryBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('KeyPoints'), props: summaryComponents.KeyPoints.props }),
  z.object({ type: z.literal('Steps'), props: summaryComponents.Steps.props }),
  z.object({ type: z.literal('Comparison'), props: summaryComponents.Comparison.props }),
  z.object({ type: z.literal('CausalChain'), props: summaryComponents.CausalChain.props }),
  z.object({ type: z.literal('Argument'), props: summaryComponents.Argument.props }),
  z.object({ type: z.literal('Timeline'), props: summaryComponents.Timeline.props }),
]);
export const summaryOutputSchema = z.object({ headline: z.string().trim().min(1).max(100), context: z.string().max(240),
  blocks: z.array(summaryBlockSchema).min(1).max(3) });
export type SummaryBlock = z.infer<typeof summaryBlockSchema>;
export type SummaryUI = z.infer<typeof summaryOutputSchema>;
export interface SummaryPreview { headline: string; context: string; blocks: SummaryBlock[] }
export interface VideoSummary { summary: string; points: string[]; ui?: SummaryUI }

export const summaryInstruction = `完整阅读输入，生成适合350像素窄栏快速扫读的视频总结，只输出符合结构的JSON对象。
headline先生成，一句话结论尽量不超过40个汉字。context简述必要的全局适用条件，无内容则为空字符串。
blocks由你从以下目录自由选择、组合和排序，通常1–3个区块，简单内容允许只用核心要点；禁止凑组件、重复表达。
${Object.entries(summaryComponents).map(([name, component]) => `${name}：${component.description}`).join('\n')}
每区块重要限制写condition直接展示，无则为空。默认阅读最多3条，条目title尽量16字内，text尽量40字内，长论据与例子写detail，无内容则为空。
ref必须来自输入中真实存在的字幕行号，每条选择最相关的一行，不输出时间、不编造数字或事实。不让用户做额外选择。
合并分段时必须保留各段重要信息、限定条件和原字幕行号，只能沿用输入parts中已有的ref，不根据不完整资料补全事实。`;

export function summaryRefs(value: SummaryUI | SummaryPreview) {
  return new Set(value.blocks.flatMap(block => block.props.items.map(item => item.ref)));
}
function validRefs(block: SummaryBlock, first: number, last: number, allowed?: ReadonlySet<number>) {
  return block.props.items.every(item => item.ref >= first && item.ref <= last && (!allowed || allowed.has(item.ref)));
}
export function validateSummary(value: unknown, first: number, last: number, allowed?: ReadonlySet<number>): SummaryUI {
  const parsed = summaryOutputSchema.parse(value);
  if (parsed.blocks.some(block => !validRefs(block, first, last, allowed))) throw new Error('总结引用不属于本次字幕资料，未保存结果。');
  return parsed;
}
// 部分结构只用于阅读；只接纳字段完整且引用有效的区块，不将预览保存为结果。
export function summaryPreview(value: unknown, first: number, last: number, allowed?: ReadonlySet<number>): SummaryPreview {
  const envelope = z.object({ headline: z.string().max(100).optional(), context: z.string().max(240).optional(), blocks: z.array(z.unknown()).optional() }).safeParse(value);
  if (!envelope.success) return { headline: '', context: '', blocks: [] };
  return { headline: envelope.data.headline ?? '', context: envelope.data.context ?? '', blocks: (envelope.data.blocks ?? []).slice(0,3).flatMap(block => {
    const parsed = summaryBlockSchema.safeParse(block);
    return parsed.success && validRefs(parsed.data,first,last,allowed) ? [parsed.data] : [];
  }) };
}
export function summarySpec(value: SummaryUI | SummaryPreview): Spec {
  const keys = value.blocks.map((_,index) => `block-${index}`);
  return { root: 'summary', elements: { summary: { type: 'SummaryLayout', props: {}, children: keys },
    ...Object.fromEntries(value.blocks.map((block,index) => [keys[index]!, { type: block.type, props: block.props, children: [] }])) } };
}
export function summaryText(value: SummaryUI, rows: SubtitleRow[]): string {
  const lines = [value.headline, value.context];
  for (const block of value.blocks) {
    const props = block.props;
    lines.push('', props.title);
    if (block.type === 'Argument') lines.push(`${block.props.speaker}：${block.props.claim}`);
    if (block.type === 'Comparison') lines.push(`${block.props.left}：${block.props.leftFit}`, `${block.props.right}：${block.props.rightFit}`);
    if (props.condition) lines.push(`适用条件：${props.condition}`);
    for (const [index,item] of props.items.entries()) {
      const text = 'text' in item ? item.text : `${'left' in props ? props.left : ''}：${item.left}；${'right' in props ? props.right : ''}：${item.right}`;
      lines.push(`${index+1}. ${item.title}${text ? `：${text}` : ''} [${clock(rows[item.ref]!.start)}]`);
      if (item.detail) lines.push(item.detail);
      if ('relation' in item && item.relation) lines.push(`↓ ${item.relation}`);
    }
  }
  return lines.filter((line,index) => line || (index > 0 && lines[index-1])).join('\n');
}
