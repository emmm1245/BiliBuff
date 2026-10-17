// 纯粹判定标题标签、优先级和严格模式，不依赖存储、模型或页面。
import { normalize } from './words.ts';
import type { RuleGroup, Settings } from '../types';
export function matchGroup(title: string, tags: string[], group: RuleGroup, exactTags: boolean) {
  const text = normalize(title);
  const labels = tags.map(normalize);
  const titleWord = group.text.find(word => text.includes(word));
  if (titleWord) return { word: titleWord, source: '标题' };
  const tagWord = group.tags.find(word => labels.some(tag => exactTags ? tag === word : tag.includes(word)));
  if (tagWord) return { word: tagWord, source: '视频标签' };
  const crossWord = group.textTags && group.text.find(word => labels.some(tag => tag.includes(word)));
  return crossWord ? { word: crossWord, source: '视频标签（标题词）' } : null;
}
export function requiresTags(title: string, settings: Settings) {
  if (matchGroup(title, [], settings.positive, settings.exactTags) && settings.positiveWins) return false;
  if (matchGroup(title, [], settings.negative, settings.exactTags) && !settings.positiveWins) return false;
  return [settings.positive, settings.negative].some(group => group.tags.length || (group.textTags && group.text.length));
}
export function classify(title: string, tags: string[], settings: Settings, tagState = 'ready'): { kind: 'pending' | 'blocked' | 'highlight' | 'normal'; reason: string } {
  const positive = matchGroup(title, tags, settings.positive, settings.exactTags);
  const negative = matchGroup(title, tags, settings.negative, settings.exactTags);
  if (settings.strict && tagState !== 'ready' && requiresTags(title, settings)) {
    return { kind: 'pending', reason: tagState === 'failed' ? '标签获取失败，尚未确认可放行' : tagState === 'unavailable' ? '此卡片没有可查询的视频标签' : '正在等待视频标签' };
  }
  if (negative && !(positive && settings.positiveWins)) return { kind: 'blocked', reason: `避开内容 · ${negative.source}：${negative.word}` };
  if (positive) return { kind: 'highlight', reason: `偏好内容 · ${positive.source}：${positive.word}` };
  return settings.strict ? { kind: 'blocked', reason: '严格模式：未命中偏好内容' } : { kind: 'normal', reason: '' };
}
