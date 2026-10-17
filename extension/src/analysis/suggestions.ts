// 将用户选择的增删建议合入规则副本，保留严格模式与词条约束。
import type { Settings, Suggestion } from '../types';
export function mergeSuggestions(settings: Settings, suggestions: Suggestion[]) {
  const merged = structuredClone(settings);
  for (const { action, side, field, word } of suggestions) {
    if (action === 'remove') merged[side][field] = merged[side][field].filter(value => value !== word);
    else if (!merged[side][field].includes(word)) merged[side][field].push(word);
  }
  if (merged.strict && !merged.positive.text.length && !merged.positive.tags.length) throw new Error('严格模式需要至少一个偏好词条，请保留一个偏好词条或同时选择新增建议。');
  return merged;
}
