// 定义设置与规则的外部数据结构，供边界校验和类型推导共用。
import { z } from 'zod';

export const ruleGroupSchema = z.object({ text: z.array(z.string()), tags: z.array(z.string()), textTags: z.boolean() });
export const providerSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(['deepseek', 'openai-compatible']), baseUrl: z.string() });
export const aiOptionsSchema = z.object({ providerId: z.string().min(1).optional(), model: z.string().regex(/^\S*$/),
  thinking: z.boolean(), effort: z.enum(['low', 'high', 'max']), maxTokens: z.number().int().min(1024).max(393216) });
export const eventSchema = z.object({ kind: z.enum(['highlight', 'blocked', 'watched']), bvid: z.string().regex(/^BV\w+$/),
  title: z.string().refine(value => !!value.trim()), tags: z.array(z.string()).nullable(), at: z.number().nonnegative(), reason: z.string() });
export type RuleGroup = z.infer<typeof ruleGroupSchema>;
export type AIProvider = z.infer<typeof providerSchema>;
export type AIOptions = z.infer<typeof aiOptionsSchema>;
export type VideoEvent = z.infer<typeof eventSchema>;

const chapterRangeSchema = z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).refine(value => value.min <= value.max);
export const chapterRangesSchema = z.object({ concise: chapterRangeSchema, balanced: chapterRangeSchema, detailed: chapterRangeSchema });
