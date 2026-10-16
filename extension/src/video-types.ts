// 定义视频工作台的分P身份、字幕、章节、问答、下载与受限后台消息。
export interface VideoPart { page: number; cid: number; title: string; duration: number }
export interface SubtitleTrack { id: string; name: string; ai: boolean }
export interface SubtitleRow { start: number; end: number; text: string }
export interface VideoSource {
  bvid: string; aid: number; cid: number; page: number; title: string; part: string; duration: number;
  parts: VideoPart[]; tracks: SubtitleTrack[]; subtitleError?: string;
}
export type VideoEffort = 'default' | 'off' | 'low' | 'medium' | 'high' | 'max';
export interface VideoSelection { providerId: string; model: string; effort?: VideoEffort; maxTokens?: number; contextTokens?: number }
export interface VideoChapter { first: number; last: number; title: string; summary: string; ad: boolean }
export interface VideoAnswer { question: string; answer: string; refs: number[]; at: number; selection?: VideoSelection }
export interface VideoResult<T> { value: T; at: number; selection: VideoSelection; fingerprint: string }
export interface VideoCache {
  source: VideoSource; language: string; rows: SubtitleRow[]; fingerprint: string; at: number;
  summary?: VideoResult<{ summary: string; points: string[] }>;
  chapters?: VideoResult<VideoChapter[]>; answers: VideoAnswer[];
}
export interface MediaChoice { id: string; label: string; kind: 'video' | 'audio'; combined: boolean; quality: number; codec: string; extension: string; size?: number }
export type VideoTask = 'summary' | 'chapters' | 'chat';
export type VideoMessage =
  | { type: 'video-source'; bvid: string; page: number; cid?: number }
  | { type: 'video-subtitles'; bvid: string; cid: number; language: string; refresh?: boolean }
  | { type: 'video-cache-clear'; bvid: string; cid: number }
  | { type: 'video-selection' }
  | { type: 'video-analyze'; bvid: string; cid: number; language: string; fingerprint: string; task: VideoTask; requestId: string; selection: VideoSelection; question?: string }
  | { type: 'video-cancel'; requestId: string }
  | { type: 'video-media'; bvid: string; cid: number }
  | { type: 'video-download'; bvid: string; cid: number; choice: string };
export interface VideoProgress { type: 'video-progress'; requestId: string; summary: string; thinking: boolean }
