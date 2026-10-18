// 定义评论采集、速读设置、模型结果及网页与后台之间的受限消息。
import type { QuickReadPreview } from './analysis/schemas';
export interface QuickReadOptions { auto: boolean; autoMinutes: number; useVideoSummary: boolean; limit: number; valuableCount: number; providerId: string; model: string }
export interface VideoCommentsSource { bvid: string; oid: string; title: string }
export interface CommentRecord { id: string; root: string; parent: string; author: string; text: string; likes: number; time: number; replies: number }
export interface CommentPage { comments: CommentRecord[]; expected: number; end: boolean; offset: string; pageSize: number; selected: boolean }
export interface QuickReadResult {
  bvid: string; title: string; key: string; at: number; total: number; selected: number;
  complete?: boolean; expected?: number;
  summary: string; topics: { title: string; summary: string; refs: string[] }[];
  valuable: { id: string; reason: string }[]; sources: CommentRecord[];
}
export type CommentMessage =
  | { type: 'comments-source'; bvid: string }
  | { type: 'comments-page'; oid: string; root?: string; pn?: number; offset?: string }
  | { type: 'comments-cache'; bvid: string }
  | { type: 'comments-analyze'; requestId: string; source: VideoCommentsSource; comments: CommentRecord[]; total: number; complete?: boolean; expected?: number; page?: number }
  | { type: 'comments-cancel'; requestId: string };
// 生成进度只推送到发起页面，不作为网页请求开放。
export interface QuickReadProgress { type: 'comments-progress'; requestId: string; bvid: string; summary: string; thinking: boolean; partial?: QuickReadPreview }
