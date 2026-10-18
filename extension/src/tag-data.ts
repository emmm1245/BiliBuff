// 从新版标签响应中保留视频主题与话题，排除背景音乐。
import { BiliRequestError } from './bili-client';
export function themeTags(value: unknown) {
  if (!Array.isArray(value)) throw new BiliRequestError('标签响应缺少列表。','invalid');
  return [...new Set<string>(value.filter(tag => tag.tag_type !== 'bgm' && typeof tag.tag_name === 'string').map(tag => tag.tag_name.trim()).filter(Boolean))];
}
