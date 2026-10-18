// 定义规则、模型参数、观看记录、备份和扩展消息的数据结构。
import type { CommentMessage, QuickReadOptions } from './comment-types';
import type { ChapterDensity, VideoAssistantOptions, VideoMessage } from './video-types';
import type { BrowseMessage, BrowseOptions } from './browse-types';
export type Side = 'positive' | 'negative';
export type WordField = 'text' | 'tags';
export type EventKind = 'highlight' | 'blocked' | 'watched';
export type { RuleGroup, AIProvider, AIOptions, VideoEvent } from './settings/schemas';
import type { RuleGroup, AIProvider, AIOptions, VideoEvent } from './settings/schemas';
export type { Suggestion, Suggestions, Clarification, ClarificationAnswer } from './analysis/schemas';
import type { Suggestions, ClarificationAnswer } from './analysis/schemas';
export interface ReviewOptions { enabled: boolean; mode: 'general' | 'decision'; workspaceId: string; providerId?: string; model?: string }
export type ReviewVerdict = 'related' | 'unrelated' | 'unknown' | 'skipped' | 'stale';
export interface Settings {
  positive: RuleGroup;
  negative: RuleGroup;
  strict: boolean;
  positiveWins: boolean;
  exactTags: boolean;
  blockAds: boolean;
  blockSpecialCards: boolean;
  hideCarousel: boolean;
  showMaskReasons: boolean;
  homeSearch: boolean;
  homeWallpaper: string;
  minWatched: number;
  minBlocked: number;
  autoSamples: boolean;
  analysisMode: 'general' | 'strict';
  ai: AIOptions;
  providers: AIProvider[];
  review: ReviewOptions;
  quickRead: QuickReadOptions;
  videoAssistant: VideoAssistantOptions;
  browse: BrowseOptions;
  planMaxLength: number;
}
export type ContentSettings = Settings & { reviewRevision?: number };
export interface AnalysisResult extends Suggestions {
  at: number;
  plan: string;
  ai?: AIOptions;
  sampleCounts?: { watched: number; blocked: number };
  clarifications?: ClarificationAnswer[];
}
export interface Preferences {
  schemaVersion: 1;
  revision: number;
  settings: Settings;
  plan: string;
  apiKey: string;
  providerKeys?: Record<string, string>;
  decisionApiKey?: string;
  reviewRevision?: number;
  result: AnalysisResult | null;
}
export interface Backup {
  format: 'bilibili-focus-backup';
  version: 1;
  exportedAt?: string;
  settings: Settings;
  plan: string;
  events: VideoEvent[];
  result: AnalysisResult | null;
  apiKey?: string;
  providerKeys?: Record<string, string>;
  decisionApiKey?: string;
}
export type Counts = Record<EventKind, number>;
export interface Snapshot { preferences: Preferences; counts: Counts; sampleCounts: { watched: number; blocked: number }; reviewError?: string }
export type Message =
  | BrowseMessage
  | VideoMessage
  | { type: 'video-density'; density: ChapterDensity }
  | { type: 'comments-context'; enabled: boolean }
  | CommentMessage
  | { type: 'suggest'; term: string }
  | { type: 'theme' }
  | { type: 'rules' }
  | { type: 'open-settings'; section?: 'videoAssistant' | 'browse' | 'home' }
  | { type: 'tags'; bvid: string }
  | { type: 'review'; bvid: string; title: string; durationSeconds?: number | null }
  | { type: 'record'; event: VideoEvent }
  | { type: 'snapshot' }
  | { type: 'debug-state' }
  | { type: 'debug-toggle'; enabled: boolean }
  | { type: 'debug-export' }
  | { type: 'debug-clear' }
  | { type: 'save'; settings: Settings; revision: number; apiKey?: string; providerKeys?: Record<string, string>; decisionApiKey?: string }
  | { type: 'plan'; plan: string }
  | { type: 'samples'; counts?: { watched: number; blocked: number } }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'export'; includeKey: boolean }
  | { type: 'import'; backup: Backup };
