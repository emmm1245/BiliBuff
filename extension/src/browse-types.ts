// 定义通用选片边界、分P证据、小型待推荐池和首页消息。
import type { AIOptions } from './types';

export interface BrowseOptions extends AIOptions { enabled: boolean }
export interface BrowseVideo {
  bvid: string; title: string; author: string; authorId: string; cover: string;
  duration: number; published: number; description: string; tags: string[];
  sources: ('home' | 'search' | 'related')[];
  partCount?: number;
  entry?: { page: number; title: string; duration: number };
}
export interface BrowseEvidence extends BrowseVideo {
  parts: string[]; excerpt: string; coverage: string;
  chapters?: { page: number; cid: number; title: string; duration: number }[];
  checkedPage?: number;
}
export interface BrowseProfile { goals: string[]; topics: string[]; excluded: string[]; formats: string[]; uncertainties: string[] }
export interface BrowsePick { video: BrowseVideo; topic: string; checkedAt: number }
export interface BrowseSourceAttempt { source: string; attempt: number; count: number; error?: string }
export interface BrowseRoundLog {
  at: number; durationMs: number; sources: BrowseSourceAttempt[]; candidates: number; checked: number; accepted: number; published: number; cached: number; error?: string;
}
export interface BrowseFeedback { video: BrowseVideo; vote: 1 | -1; at: number }
export interface BrowseMemory {
  context: string; items: BrowseVideo[]; updatedAt: number; round: number;
  queries: string[]; seen: { bvid: string; at: number; title?: string }[]; feedback: BrowseFeedback[];
  pending?: { id: string; context: string };
  profile?: BrowseProfile;
  pool?: BrowsePick[];
  logs?: BrowseRoundLog[];
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
