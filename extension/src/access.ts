// 限制网页内容脚本可调用的后台功能，保护计划、密钥和累计记录。
export function mayAccess(type: string, sender: { id?: string; url?: string; frameId?: number }, extensionId: string, optionsUrl: string) {
  if (sender.id !== extensionId) return false;
  if (sender.url?.split('#',1)[0] === optionsUrl) return true;
  if (sender.frameId !== 0 || !sender.url?.startsWith('https://www.bilibili.com/')) return false;
  return ['rules', 'theme', 'suggest', 'tags', 'review', 'record', 'open-settings', 'comments-source', 'comments-page', 'comments-cache', 'comments-analyze', 'comments-cancel',
    'video-source', 'video-subtitles', 'video-density', 'video-selection', 'video-cache-clear', 'video-analyze', 'video-cancel', 'video-media', 'video-download'].includes(type);
}
