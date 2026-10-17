// 校验两种复核结果及逐项对应，保留阿里云的双概率阈值。
import { reviewOutputSchema } from '../analysis/schemas';
type Decision = 'related' | 'unrelated' | 'unknown';
const OPTIONS = ['related','unrelated','unknown'];
export function parseGeneralReview(value: unknown, ids: string[]): Decision[] {
  const parsed = reviewOutputSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI 复核结果格式无效。');
  return ids.map(id => { const verdict = parsed.data.decisions[id]; if (!verdict) throw new Error('AI 复核缺少视频判定。'); return verdict; });
}
export function parseDecisionResponse(value: unknown, ids: string[]): Decision[] {
  const response = value as { answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string,number> }> } | null;
  if (!response?.answers) throw new Error('决策模型缺少判定结果。');
  const decisions = response.answers;
  if (!decisions || typeof decisions !== 'object') throw new Error('AI 复核结果格式无效。');
  return ids.map(id => {
    const answer = decisions[id];
    const verdict = (answer as { choice?: string } | null)?.choice;
    if (!OPTIONS.includes(String(verdict))) throw new Error('AI 复核缺少视频判定或返回了无效分类。');
    {
      const result = answer as { confidence?: number; probabilities?: Record<string, number> };
      if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 ||
          !result.probabilities || OPTIONS.some(option => typeof result.probabilities![option] !== 'number' ||
            !Number.isFinite(result.probabilities![option]) || result.probabilities![option]! < 0 || result.probabilities![option]! > 1)) throw new Error('决策模型概率数据无效。');
      // 概率仅用于保守筛选，不能当作经过校准的准确率。
      if (verdict === 'unrelated' && (result.confidence < .8 || result.probabilities.unrelated! < .8)) return 'unknown';
    }
    return verdict as Decision;
  });
}

