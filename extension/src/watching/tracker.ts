// 统计实际观看时间并连接评论自动采集，排除暂停、拖动与倍速误计。
import { playbackBvid, playbackSeconds } from './logic';
import type { EventKind, VideoEvent } from '../types';
export function trackWatching(signal: AbortSignal, watch: (bvid: string, seconds: number, playing: boolean) => void, recordEvent: (kind: EventKind, video: Pick<VideoEvent,'bvid' | 'title'>, tags?: string[] | null, reason?: string) => void, requestTags: (bvid: string) => Promise<string[]>) {
    let bvid = '', seconds = 0, playedMedia = 0, lastTime = 0, lastWall = 0, recorded = false;
    let player: HTMLVideoElement | null = null;
    function resetBaseline() { lastWall = 0; }
    function record() {
      const title = document.querySelector('h1.video-title')?.textContent?.trim();
      if (recorded || !bvid || !title) return;
      recorded = true;
      const video = { bvid, title };
      recordEvent('watched', video);
      requestTags(bvid).then(tags => recordEvent('watched', video, tags)).catch(() => {});
    }
    function onProgress(event: Event) {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.closest('#bilibili-player, .bpx-player-container')) return;
      const id = playbackBvid(location.pathname, location.search);
      if (!id) return;
      if (id !== bvid) { bvid = id; seconds = 0; playedMedia = 0; recorded = false; lastWall = 0; }
      if (player !== video) {
        player = video; lastWall = 0;
        video.addEventListener('seeking', resetBaseline, { signal });
        video.addEventListener('pause', resetBaseline, { signal });
        video.addEventListener('ratechange', resetBaseline, { signal });
        video.addEventListener('waiting', resetBaseline, { signal });
      }
      const now = performance.now();
      if (!video.paused && !video.seeking && lastWall) {
        const elapsed = playbackSeconds(lastTime, video.currentTime, (now - lastWall) / 1000, video.playbackRate);
        seconds += elapsed;
        playedMedia += elapsed * video.playbackRate;
      }
      lastTime = video.currentTime; lastWall = video.paused || video.seeking ? 0 : now;
      watch(id, seconds, !video.paused && !video.seeking);
      if (seconds >= 30) record();
    }
    document.addEventListener('playing', onProgress, { capture: true, signal });
    document.addEventListener('timeupdate', onProgress, { capture: true, signal });
    document.addEventListener('ended', event => {
      const video = event.target;
      if (video instanceof HTMLVideoElement && video === player && playbackBvid(location.pathname, location.search) === bvid && video.duration > 0 && video.duration < 30 &&
          playedMedia >= video.duration * 0.9) record();
    }, { capture: true, signal });
  }

