// 定义模型建议与澄清的传输结构，本地词条、引用与会话关系仍由业务校验。
import { z } from 'zod';

export const suggestionSchema = z.object({ action: z.enum(['add', 'remove']).optional(), side: z.enum(['positive', 'negative']),
  field: z.enum(['text', 'tags']), word: z.string(), reason: z.string() });
export const suggestionsSchema = z.object({ summary: z.string(), suggestions: z.array(suggestionSchema).max(40) });
export const clarificationSchema = z.object({ summary: z.string(), question: z.string(), options: z.array(z.string()).min(2).max(5) });
export const answerSchema = z.object({ question: z.string(), kind: z.enum(['option', 'custom', 'skip']), answer: z.string() });
export const analysisOutputSchema = z.union([
  clarificationSchema.extend({ kind: z.literal('clarification') }),
  suggestionsSchema.extend({ kind: z.literal('result') }),
]);
export const quickReadOutputSchema = z.object({ summary: z.string(), topics: z.array(z.object({ title: z.string(), summary: z.string(), refs: z.array(z.string()) })).max(6),
  valuable: z.array(z.object({ id: z.string(), reason: z.string() })) });
export const chaptersOutputSchema = z.object({ chapters: z.array(z.object({ first: z.number().int(), title: z.string(), summary: z.string(), ad: z.boolean() })) });
export const reviewOutputSchema = z.object({ decisions: z.record(z.string(), z.enum(['related', 'unrelated', 'unknown'])) });
export type Suggestion = z.infer<typeof suggestionSchema>;
export type Suggestions = z.infer<typeof suggestionsSchema>;
export type Clarification = z.infer<typeof clarificationSchema>;
export type ClarificationAnswer = z.infer<typeof answerSchema>;

// 增量只用于显示，完整结果仍使用上面的正式结构与业务校验。
export const analysisPreviewSchema = z.object({ summary: z.string().optional(), kind: z.enum(['clarification', 'result']).optional(),
  question: z.string().optional(), options: z.array(z.string().optional()).optional(),
  suggestions: z.array(suggestionSchema.partial().optional()).optional() });
export const quickReadPreviewSchema = z.object({ summary: z.string().optional(),
  topics: z.array(quickReadOutputSchema.shape.topics.element.partial().optional()).optional(),
  valuable: z.array(quickReadOutputSchema.shape.valuable.element.partial().optional()).optional() });
export const chaptersPreviewSchema = z.object({ chapters: z.array(chaptersOutputSchema.shape.chapters.element.partial().optional()).optional() });
export type AnalysisPreview = z.infer<typeof analysisPreviewSchema>;
export type QuickReadPreview = z.infer<typeof quickReadPreviewSchema>;
export type ChapterPreview = z.infer<typeof chaptersPreviewSchema>['chapters'];
