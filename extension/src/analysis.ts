// 准备一次分析样本，流式生成增删建议，并按需进行选项式澄清。
export type { AnalysisSession, AnalysisTurn, AnalysisFollowup } from './analysis/session';
import { prepareSession, type AnalysisTurn, type AnalysisFollowup } from './analysis/session';
import { SYSTEM_PROMPT } from './analysis/prompt';
import { send } from './client';
import { modelParameters, validateClarification, validateClarificationAnswer, validatePlan, validateSuggestions } from './core';
import { analysisOutputSchema, analysisPreviewSchema, type AnalysisPreview } from './analysis/schemas';
import { aiConnection } from './ai-providers';
import { requestAI } from './ai-request';
import type { Preferences, Settings } from './types';

export async function analyze(prefs: Preferences, draft: Settings, signal: AbortSignal, progress: (text: string) => void,
  preview: (text: string) => void = () => {}, followup?: AnalysisFollowup, partial?: (value: AnalysisPreview) => void): Promise<AnalysisTurn> {
  signal.throwIfAborted();
  validatePlan(prefs.plan, prefs.settings.planMaxLength);
  let session = followup?.session ?? await prepareSession(prefs, draft, signal, progress);
  const latest = await send({ type: 'snapshot' });
  signal.throwIfAborted();
  validatePlan(session.plan, latest.preferences.settings.planMaxLength);
  if (session.plan !== latest.preferences.plan || session.plan !== prefs.plan) throw new Error('近期计划已改变，请重新分析。');
  if (session.revision !== latest.preferences.revision || JSON.stringify(session.rules) !== JSON.stringify(draft)) throw new Error('规则或设置已改变，请重新分析。');
  const connection = aiConnection(prefs, prefs.settings.ai);
  let forceResult = false;
  if (followup) {
    const answer = validateClarificationAnswer(followup.answer);
    if (!session.question || answer.question !== session.question.question ||
        (answer.kind === 'option' && !session.question.options.includes(answer.answer))) throw new Error('澄清问题已改变，请重新选择。');
    forceResult = answer.kind !== 'custom';
    session = { ...session, clarifications: [...session.clarifications, answer],
      messages: [...session.messages, { role: 'user', content: JSON.stringify({ ...answer, instruction: forceResult ? '直接给最终结果，不再提问。' : '信息足够直接给结果，否则澄清剩余关键歧义。' }) }] };
  }
  progress(`正在由 ${connection.provider.name} · ${connection.model} 分析，最长等待 5 分钟；请保持本页打开。`);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
  return requestAI<AnalysisTurn>(prefs, prefs.settings.ai, {
    ...modelParameters(prefs.settings.ai), stream: true,
    ...(connection.provider.type === 'deepseek' ? { response_format: { type: 'json_object' } } : {}), messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.messages,
    ],
  }, requestSignal, parsedValue => {
    const parsed = parsedValue as { kind?: unknown } | null;
    signal.throwIfAborted();
    if (parsed?.kind === 'clarification') {
      if (forceResult) throw new Error('模型未按你的选择给出结果，请重试本轮回答。');
      const question = validateClarification(parsed);
      return { kind: 'clarification', question, session: { ...session, question,
        messages: [...session.messages, { role: 'assistant', content: JSON.stringify(parsedValue) }] } };
    }
    if (parsed?.kind !== 'result') throw new Error('模型返回的分析类型无效，未保存建议。');
    const suggestions = validateSuggestions(parsed);
    if (suggestions.suggestions.some(item => item.action === 'remove' && !session.rules[item.side][item.field].includes(item.word))) throw new Error('模型建议删除不存在的词条，未保存建议。');
    return { kind: 'result', result: { ...suggestions, at: Date.now(), plan: session.plan, ai: structuredClone(prefs.settings.ai),
      sampleCounts: session.sampleCounts, clarifications: session.clarifications } };
  }, '计划分析', { schema: analysisOutputSchema,
    partial: value => { const parsed = analysisPreviewSchema.safeParse(value); if (parsed.success) partial?.(parsed.data); },
    preview: text => { progress('正在接收分析说明……'); preview(text); },
    thinking: () => progress('模型正在思考，等待正式分析……'),
  });
}
