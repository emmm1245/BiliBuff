// 合并尚未提交的词条输入，供规则编辑与保存草稿共用。
import type { Settings, Side, WordField } from '../types';
import { parseWords } from '../filter/words';
export type Inputs = Record<`${Side}:${WordField}`, string>;
export const emptyInputs: Inputs = { 'positive:text': '', 'positive:tags': '', 'negative:text': '', 'negative:tags': '' };
export function collectInputs(draft: Settings, inputs: Inputs) {
  const settings = structuredClone(draft);
  for (const side of ['positive', 'negative'] as const) for (const field of ['text', 'tags'] as const) {
    settings[side][field] = [...new Set([...settings[side][field], ...parseWords(inputs[`${side}:${field}`])])];
  }
  return settings;
}
