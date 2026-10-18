// 定义通用选片边界、分P证据、小型待推荐池和首页消息。
import type { AIOptions } from './types';

export interface BrowseOptions extends AIOptions { enabled: boolean; scopeNote?: string }
export interface BrowseVideo {
  bvid: string; title: string; author: string; authorId: string; cover: string;
  duration: number; published: number; description: string; tags: string[];
  sources: ('home' | 'search' | 'related')[];
  partCount?: number;
  entry?: { page: number; title: string; duration: number };
  queryKeys?: string[];
}
export interface BrowseEvidence extends BrowseVideo {
  parts: string[]; excerpt: string; coverage: string;
  chapters?: { page: number; cid: number; title: string; duration: number }[];
  checkedPage?: number;
}
export interface BrowseProfile { goals: string[]; topics: string[]; excluded: string[]; formats: string[]; uncertainties: string[] }
export interface BrowsePick {
  video: BrowseVideo; topic: string; checkedAt: number;
  scopeKey?: string; topicKey?: string; contentType?: string; evidence?: 'catalog' | 'content';
}
export interface BrowseSearchTask { query: string; intent: string; scopeKey: string; order: 'totalrank' | 'pubdate'; fallback: string; originalQuery?: string }
export interface BrowseQueryResult extends BrowseSearchTask {
  id: string; key: string; page: number; at: number; ok: boolean; errorKind?: string; durationMs: number;
  returned: number; rawReturned: number; added: number; filtered: number; shortlisted: number; qualified: number; pooled: number; published: number;
}
export interface BrowseSourceAttempt { source: string; attempt: number; count: number; error?: string; kind?: string; durationMs?: number }
export interface BrowseRequestLog { kind: string; path: string; durationMs: number; sent?: boolean; http?: number; code?: number; count?: number; error?: string; errorKind?: string }
export interface BrowseRoundLog {
  at: number; durationMs: number; sources: BrowseSourceAttempt[]; candidates: number; checked: number; accepted: number; published: number; cached: number; error?: string;
  contextVersion?: number; revision?: number; requests?: BrowseRequestLog[]; queries?: BrowseQueryResult[];
  scopes?: Record<string,number>; evidence?: Record<string,number>; detailed?: number; subtitles?: number;
  modelCalls?: number; inputTokens?: number; outputTokens?: number; stages?: Record<string,number>; unselected?: number;
  usageComplete?: boolean;
  plannedQueries?: number; skippedQueries?: { query: string; reason: string }[];
}
export interface BrowseFeedback { video: BrowseVideo; vote: 1 | -1; at: number }
export interface BrowseMemory {
  context: string; items: BrowseVideo[]; updatedAt: number; round: number;
  queries: string[]; seen: { bvid: string; at: number; title?: string }[]; feedback: BrowseFeedback[];
  pending?: { id: string; context: string };
  profile?: BrowseProfile;
  pool?: BrowsePick[];
  logs?: BrowseRoundLog[];
  searches?: BrowseQueryResult[];
}
export interface BrowseState {
  items: (BrowseVideo & { vote: 1 | -1 | 0 })[];
  busy: boolean; status: string; error: string; updatedAt: number; ready: boolean;
}
export type BrowseMessage =
  | { type: 'browse-state' }
  | { type: 'browse-refresh' }
  | { type: 'browse-cancel' }
  | { type: 'browse-feedback'; bvid: string; vote: 1 | -1 | 0 };
