// 为选片来源设置请求总预算、失败退避和来源冷却，并记录脱敏结果。
import type { BrowseSourceAttempt, BrowseVideo } from './browse-types';

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    signal.throwIfAborted();
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort',aborted); resolve(); },ms);
    signal.addEventListener('abort',aborted,{ once: true });
  });
}
export function createBrowseSources(signal: AbortSignal, logs: BrowseSourceAttempt[], cooldowns: Map<string,number>) {
  let count = 0;
  return {
    get remaining() { return 24-count; },
    async collect(source: string, family: string, work: () => Promise<BrowseVideo[]>) {
      if ((cooldowns.get(family) ?? 0) > Date.now()) return [];
      for (let attempt = 1; attempt <= 3 && count < 24; attempt++) {
        signal.throwIfAborted();
        if (attempt > 1) await pause(attempt === 2 ? 1500 : 4000,signal);
        count++;
        try {
          const videos = await work();
          logs.push({ source,attempt,count: videos.length });
          return videos;
        } catch (error) {
          signal.throwIfAborted();
          const message = error instanceof Error ? error.message : String(error);
          logs.push({ source,attempt,count: 0,error: message.slice(0,240) });
          // 仅暂时性的站点与网络错误值得补试，其他错误留给日志。
          if (!/412|429|5\d\d|timeout|超时|network|fetch/i.test(message)) break;
          if (attempt === 3) cooldowns.set(family,Date.now()+10*60000);
        }
      }
      return [];
    },
  };
}
