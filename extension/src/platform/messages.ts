// 统一扩展请求的结构校验与返回类型；发送者权限仍在后台读取消息前检查。
import { z } from 'zod';
import { eventSchema } from '../settings/schemas';
import type { AnalysisResult, Backup, ContentSettings, Message, Preferences, ReviewVerdict, Snapshot, VideoEvent } from '../types';
import type { CommentPage, QuickReadResult, VideoCommentsSource } from '../comment-types';
import type { ChapterDensity, MediaChoice, VideoAssistantOptions, VideoCache, VideoSource } from '../video-types';
import type { AIDebugLog } from '../ai-debug';
import type { Theme } from '../theme';
import type { BrowseState } from '../browse-types';

const text = z.string();
const bvid = text.regex(/^BV\w+$/);
const cid = z.number().int().positive();
const requestId = text.min(1).max(100);
const identity = { bvid, cid };
const subtitles = { ...identity, language: text.regex(/^[\w-]{1,50}$/) };
const comment = z.object({ id: text.regex(/^\d+$/), root: text, parent: text, author: text, text, likes: z.number(), time: z.number(), replies: z.number() });
// 设置、建议和备份沿用各业务保存边界的完整校验，避免在传输边界提前丢失旧字段默认值与空密钥语义。
export const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('suggest'), term: text.max(100) }),
  ...(['browse-state','browse-refresh','browse-cancel'] as const).map(type => z.object({ type: z.literal(type) })),
  z.object({ type: z.literal('browse-feedback'), bvid, vote: z.union([z.literal(1),z.literal(-1),z.literal(0)]) }),
  ...(['theme','rules','snapshot','debug-state','debug-export','debug-clear','video-selection'] as const).map(type => z.object({ type: z.literal(type) })),
  z.object({ type: z.literal('samples'), counts: z.object({ watched: z.number().int().min(0).max(100), blocked: z.number().int().min(0).max(1000) }).optional() }),
  z.object({ type: z.literal('open-settings'), section: z.enum(['videoAssistant','browse','home']).optional() }),
  z.object({ type: z.literal('tags'), bvid }),
  z.object({ type: z.literal('review'), bvid, title: text.min(1).max(300), durationSeconds: cid.nullable().optional() }),
  z.object({ type: z.literal('record'), event: eventSchema }),
  z.object({ type: z.literal('debug-toggle'), enabled: z.boolean() }),
  z.object({ type: z.literal('save'), settings: z.unknown(), revision: z.number().int().nonnegative(), apiKey: text.optional(), providerKeys: z.record(text,text).optional(), decisionApiKey: text.optional() }),
  z.object({ type: z.literal('plan'), plan: text.max(6000) }),
  z.object({ type: z.literal('result'), result: z.unknown() }),
  z.object({ type: z.literal('export'), includeKey: z.boolean() }),
  z.object({ type: z.literal('import'), backup: z.unknown() }),
  z.object({ type: z.literal('comments-source'), bvid }),
  z.object({ type: z.literal('comments-page'), oid: text.regex(/^\d+$/), root: text.regex(/^\d+$/).optional(), pn: cid.optional(), offset: text.optional() }),
  z.object({ type: z.literal('comments-cache'), bvid }),
  z.object({ type: z.literal('comments-analyze'), requestId, source: z.object({ bvid, oid: text.regex(/^\d+$/), title: text }), comments: z.array(comment).min(1).max(10000), total: z.number().int().nonnegative(), complete: z.boolean().optional(), expected: z.number().optional(), page: cid.optional() }),
  z.object({ type: z.literal('comments-context'), enabled: z.boolean() }),
  z.object({ type: z.literal('comments-cancel'), requestId }),
  z.object({ type: z.literal('video-density'), density: z.enum(['concise','balanced','detailed']) }),
  z.object({ type: z.literal('video-source'), bvid, page: cid, cid: cid.optional() }),
  z.object({ type: z.literal('video-subtitles'), ...subtitles, refresh: z.boolean().optional() }),
  z.object({ type: z.literal('video-cache-clear'), ...identity }),
  z.object({ type: z.literal('video-analyze'), ...subtitles, fingerprint: text, task: z.enum(['summary','chapters','chat']), density: z.enum(['concise','balanced','detailed']).optional(), requestId, question: text.max(2000).optional() }),
  z.object({ type: z.literal('video-cancel'), requestId }),
  z.object({ type: z.literal('video-media'), ...identity }),
  z.object({ type: z.literal('video-download'), ...identity, choice: text }),
]);
export function parseMessage(value: unknown): Message {
  const parsed = messageSchema.safeParse(value);
  if (!parsed.success) throw new Error('扩展消息参数无效。');
  return parsed.data as Message;
}
export interface MessageResults {
  'browse-state': BrowseState; 'browse-refresh': BrowseState; 'browse-cancel': void; 'browse-feedback': BrowseState;
  suggest: string[]; theme: Theme; rules: ContentSettings; 'open-settings': unknown; tags: string[]; review: ReviewVerdict; record: unknown;
  snapshot: Snapshot; 'debug-state': { enabled: boolean; count: number }; 'debug-toggle': void; 'debug-clear': void;
  'debug-export': { format: string; version: number; exportedAt: string; logs: AIDebugLog[] };
  save: Preferences; plan: void; samples: { watched: VideoEvent[]; blocked: VideoEvent[] }; result: AnalysisResult; export: Backup; import: void;
  'comments-source': VideoCommentsSource; 'comments-page': CommentPage; 'comments-cache': QuickReadResult | null; 'comments-analyze': QuickReadResult; 'comments-cancel': void; 'comments-context': boolean;
  'video-density': ChapterDensity; 'video-source': VideoSource; 'video-subtitles': VideoCache; 'video-selection': VideoAssistantOptions; 'video-cache-clear': void;
  'video-analyze': VideoCache; 'video-cancel': void; 'video-media': MediaChoice[]; 'video-download': unknown;
}
export type MessageResult<M extends Message> = MessageResults[M['type']];
