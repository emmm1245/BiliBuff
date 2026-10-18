// 跨页面串行调度评论读取和签名，持久保存限流冷却并保留250毫秒启动间隔。
import { browser } from 'wxt/browser';
import { signedWbiQuery } from '../wbi-sign';
import { commentJSON, commentPage, CommentReadLimit, type ReplyData } from './api';
import type { CommentMessage } from '../comment-types';
const COOLDOWN = 'comment-requests-paused-until';
export function createCommentReader() {
  let signingKeys: { img: string; sub: string; at: number } | undefined;
  let signing: Promise<void> | undefined;
  let reads: Promise<unknown> = Promise.resolve(), lastStart = -Infinity, blockedUntil = 0;
  const restored = browser.storage.local.get(COOLDOWN).then(value => { blockedUntil = Number(value[COOLDOWN]) || 0; });
  // 所有标签页共用这一后台队列，按启动时间限速；访问限制同时阻止已排队的请求。
  function read<T>(path: string): Promise<T> {
    const task = reads.then(async () => {
      await restored;
      const check = () => { if (blockedUntil > Date.now()) throw new Error(`评论接口暂时受限，请至少等待${Math.ceil((blockedUntil-Date.now())/1000)}秒后手动重试。`); };
      check();
      while (performance.now()-lastStart < 250) await new Promise(resolve => setTimeout(resolve,Math.ceil(250-(performance.now()-lastStart))));
      check(); lastStart = performance.now();
      try { return await commentJSON<T>(path); }
      catch (error) {
        if (error instanceof CommentReadLimit) { blockedUntil = error.until; await browser.storage.local.set({ [COOLDOWN]: blockedUntil }); }
        throw error;
      }
    });
    reads = task.catch(() => {}); return task;
  }
  return async (message: Extract<CommentMessage, { type: 'comments-source' | 'comments-page' }>) => {
    if (message.type === 'comments-source') {
      if (!/^BV\w+$/.test(message.bvid)) throw new Error('视频编号无效。');
      const data = await read<{ aid: number; title: string }>(`/x/web-interface/view?bvid=${encodeURIComponent(message.bvid)}`);
      return { bvid: message.bvid, oid: String(data.aid), title: data.title };
    }
    if (message.type === 'comments-page') {
      if (!/^\d+$/.test(message.oid) || (message.root !== undefined && (!/^\d+$/.test(message.root) || !Number.isInteger(message.pn) || message.pn! < 1))) throw new Error('评论分页参数无效。');
      let path: string;
      if (message.root) path = `/x/v2/reply/reply?${new URLSearchParams({ oid: message.oid, type: '1', root: message.root, ps: '20', pn: String(message.pn) })}`;
      else {
        if (!signingKeys || Date.now() - signingKeys.at > 3600000) {
          signing ??= read<{ wbi_img: { img_url: string; sub_url: string } }>('/x/web-interface/nav').then(data => {
            const key = (url: string) => url.slice(url.lastIndexOf('/')+1).split('.')[0]!;
            signingKeys = { img: key(data.wbi_img.img_url), sub: key(data.wbi_img.sub_url), at: Date.now() };
          }).finally(() => { signing = undefined; });
          await signing;
        }
        path = `/x/v2/reply/wbi/main?${signedWbiQuery({ oid: message.oid, type: '1', mode: '2', pagination_str: JSON.stringify({ offset: message.offset || '' }), plat: '1', web_location: '1315875' }, signingKeys!.img, signingKeys!.sub)}`;
      }
      try { return commentPage(await read<ReplyData>(path)); } catch (error) { signingKeys = undefined; throw error; }
    }
  };
}
