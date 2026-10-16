// 校验新鲜媒体地址后交给浏览器下载，仅对该文件临时设置B站来源并清理规则。
import { browser } from 'wxt/browser';
import { confirmedPart, videoMedia } from './video-api';
import { safeFilename } from './video-data';

const ruleKey = (downloadId: number) => `video-download-rule-${downloadId}`;
async function clearRule(downloadId: number, ruleId: number) {
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  await browser.storage.session.remove(ruleKey(downloadId));
}
export function registerVideoDownloads() {
  browser.downloads.onChanged.addListener(delta => {
    if (!['complete','interrupted'].includes(delta.state?.current || '')) return;
    void (async () => {
      const key = ruleKey(delta.id), id = (await browser.storage.session.get(key))[key] as number | undefined;
      if (id) await clearRule(delta.id,id);
    })().catch(error => console.warn('下载规则清理失败',error));
  });
}
let downloads: Promise<unknown> = Promise.resolve();
export function downloadVideo(bvid: string, cid: number, choice: string) {
  const task = downloads.then(async () => {
    const [{ data,part },media] = await Promise.all([confirmedPart(bvid,cid),videoMedia(bvid,cid)]);
    const selected = media.find(item => item.id === choice);
    if (!selected) throw new Error('该媒体格式已变化，请刷新下载列表。');
    const id = 100000 + Math.floor(Math.random()*1000000000);
    await browser.declarativeNetRequest.updateSessionRules({ addRules: [{ id, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }] },
      condition: { regexFilter: `^${selected.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`, resourceTypes: ['xmlhttprequest','other','media'] },
    }] });
    let downloadId: number | undefined;
    try {
      const response = await fetch(selected.url,{ headers: { Range: 'bytes=0-0' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      void response.body?.cancel();
      if (!response.ok || /text\/|json/i.test(response.headers.get('Content-Type') || '')) throw new Error('媒体地址已失效或返回错误页面，请刷新下载列表重试。');
      const name = `${safeFilename(data.title)}-P${part.page}-${selected.kind === 'audio' ? '音频' : selected.combined ? '视频' : '仅画面'}-${selected.quality}.${selected.extension}`;
      downloadId = await browser.downloads.download({ url: selected.url, filename: name, saveAs: true, conflictAction: 'uniquify' });
      await browser.storage.session.set({ [ruleKey(downloadId)]: id });
      const [item] = await browser.downloads.search({ id: downloadId });
      if (item?.state !== 'in_progress') await clearRule(downloadId,id);
      return downloadId;
    } catch (error) {
      if (downloadId !== undefined) await clearRule(downloadId,id);
      else await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
      throw error;
    }
  });
  downloads = task.catch(() => {}); return task;
}
