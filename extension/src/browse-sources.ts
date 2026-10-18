// 为选片来源设置请求总预算、失败退避和来源冷却，并记录脱敏结果。
import type { BrowseSourceAttempt, BrowseVideo } from './browse-types';
import { browseFailureKind, browsePause } from './browse-network';
export function createBrowseSources(signal: AbortSignal, logs: BrowseSourceAttempt[], cooldowns: Map<string,number>) {
  let count = 0;
  return {
    get remaining() { return 24-count; },
    async collect(source: string, family: string, work: () => Promise<BrowseVideo[]>) {
      if ((cooldowns.get(family) ?? 0) > Date.now()) { logs.push({ source,attempt: 0,count: 0,kind: 'cooldown' }); return []; }
      if (count >= 24) { logs.push({ source,attempt: 0,count: 0,kind: 'budget' }); return []; }
      for (let attempt = 1; attempt <= 3 && count < 24; attempt++) {
        signal.throwIfAborted();
        if (attempt > 1) await browsePause(attempt === 2 ? 1500 : 4000,signal);
        count++;
        const start = Date.now();
        try {
          const videos = await work();
          logs.push({ source,attempt,count: videos.length,durationMs: Date.now()-start,kind: videos.length ? 'success' : 'empty' });
          return videos;
        } catch (error) {
          signal.throwIfAborted();
          const message = error instanceof Error ? error.message : String(error);
          const kind = browseFailureKind(error);
          logs.push({ source,attempt,count: 0,error: message.slice(0,240),kind,durationMs: Date.now()-start });
          if (kind === 'limited') { cooldowns.set(family,Date.now()+10*60000); break; }
          if (['budget','cooldown'].includes(kind)) break;
          // 仅暂时性的站点与网络错误值得补试，其他错误留给日志。
          if (!/5\d\d|timeout|超时|network|fetch/i.test(message)) break;
          if (attempt === 3) cooldowns.set(family,Date.now()+10*60000);
        }
      }
      return [];
    },
  };
}
