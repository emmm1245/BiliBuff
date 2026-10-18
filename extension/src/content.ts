// 装配网页过滤、观看统计、评论和视频功能，统一拥有页面生命周期。
import { send } from './client';
import { startCommentReading } from './comment-reading';
import { startVideoReading } from './video-reading';
import { startCards } from './filter/cards';
import { trackWatching } from './watching/tracker';
import type { ContentSettings, EventKind, VideoEvent } from './types';
export function startContent(initialSettings: ContentSettings) {
  const controller = new AbortController(), { signal } = controller;
  const comments = startCommentReading(initialSettings, signal), videos = startVideoReading(initialSettings, signal);
  function showError(error: unknown) {
    const launcher = document.querySelector<HTMLElement>('#bf-launcher');
    if (launcher) launcher.title = error instanceof Error ? error.message : '扩展操作失败。';
  }
  const requestTags = (bvid: string) => send({ type: 'tags', bvid });
  function recordEvent(kind: EventKind, video: Pick<VideoEvent,'bvid' | 'title'>, tags: string[] | null = null, reason = '') {
    void send({ type: 'record', event: { kind, bvid: video.bvid, title: video.title, tags, reason, at: Date.now() } }).catch(showError);
  }
  trackWatching(signal, comments.watch, recordEvent, requestTags);
  const stop = startCards(initialSettings,signal,{ requestTags, recordEvent, showError,
    openSettings: () => { void send({ type: 'open-settings' }).catch(showError); },
    configure: settings => { comments.configure(settings); videos.configure(settings); },
  });
  return () => { controller.abort(); stop(); };
}
