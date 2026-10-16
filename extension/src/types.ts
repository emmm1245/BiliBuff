// 定义规则、模型参数、观看记录、备份和扩展消息的数据结构。
import type { CommentMessage, QuickReadOptions } from './comment-types';
import type { VideoMessage } from './video-types';
export type Side = 'positive' | 'negative';
export type WordField = 'text' | 'tags';
export type EventKind = 'highlight' | 'blocked' | 'watched';
export interface RuleGroup { text: string[]; tags: string[]; textTags: boolean }
export interface AIProvider { id: string; name: string; type: 'deepseek' | 'openai-compatible'; baseUrl: string }
export interface AIOptions {
  providerId?: string;
  model: string;
  thinking: boolean;
  effort: 'low' | 'high' | 'max';
  maxTokens: number;
}
export interface ReviewOptions { enabled: boolean; mode: 'general' | 'decision'; workspaceId: string; providerId?: string; model?: string }
export type ReviewVerdict = 'related' | 'unrelated' | 'unknown' | 'skipped' | 'stale';
export interface Settings {
  positive: RuleGroup;
  negative: RuleGroup;
  strict: boolean;
  positiveWins: boolean;
  exactTags: boolean;
  blockAds: boolean;
  hideCarousel: boolean;
  showMaskReasons: boolean;
  homeSearch: boolean;
  homeWallpaper: string;
  minWatched: number;
  minBlocked: number;
  ai: AIOptions;
  providers: AIProvider[];
  review: ReviewOptions;
  quickRead: QuickReadOptions;
  planMaxLength: number;
}
export type ContentSettings = Settings & { reviewRevision?: number };
export interface VideoEvent {
  kind: EventKind;
  bvid: string;
  title: string;
  tags: string[] | null;
  at: number;
  reason: string;
}
export interface Suggestion { action?: 'add' | 'remove'; side: Side; field: WordField; word: string; reason: string }
export interface Suggestions { summary: string; suggestions: Suggestion[] }
export interface Clarification { summary: string; question: string; options: string[] }
export interface ClarificationAnswer { question: string; kind: 'option' | 'custom' | 'skip'; answer: string }
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
export interface Snapshot { preferences: Preferences; counts: Counts; reviewError?: string }
export type Message =
  | VideoMessage
  | CommentMessage
  | { type: 'suggest'; term: string }
  | { type: 'theme' }
  | { type: 'rules' }
  | { type: 'open-settings' }
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
  | { type: 'samples' }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'export'; includeKey: boolean }
  | { type: 'import'; backup: Backup };
