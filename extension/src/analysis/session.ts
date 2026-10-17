// 准备计划分析样本和澄清会话，发送前补齐所选样本标签并保留版本。
import { send } from '../client';
import { validatePlan } from '../core';
import { aiConnection } from '../ai-providers';
import type { AnalysisResult, Clarification, ClarificationAnswer, Preferences, Settings, VideoEvent } from '../types';
export interface AnalysisSession {
  plan: string;
  revision: number;
  rules: Settings;
  sampleCounts: { watched: number; blocked: number };
  messages: { role: 'user' | 'assistant'; content: string }[];
  clarifications: ClarificationAnswer[];
  question: Clarification | null;
}
export type AnalysisTurn = { kind: 'result'; result: AnalysisResult } | { kind: 'clarification'; question: Clarification; session: AnalysisSession };
export interface AnalysisFollowup { session: AnalysisSession; answer: ClarificationAnswer }

export async function prepareSession(prefs: Preferences, draft: Settings, signal: AbortSignal, progress: (text: string) => void): Promise<AnalysisSession> {
  validatePlan(prefs.plan, prefs.settings.planMaxLength);
  aiConnection(prefs, prefs.settings.ai);
  const { watched, blocked } = await send({ type: 'samples' });
  if (!prefs.plan.trim() || watched.length < prefs.settings.minWatched || blocked.length < prefs.settings.minBlocked) throw new Error('请先填写计划，并满足两类样本门槛。');
  const work = [...watched, ...blocked].filter(record => !Array.isArray(record.tags));
  let cursor = 0, finished = 0;
  progress(`准备样本：观看 ${watched.length} 条，屏蔽 ${blocked.length} 条；待补标签 ${work.length} 条。`);
  async function worker() {
    while (cursor < work.length) {
      signal.throwIfAborted();
      const record = work[cursor++]!;
      record.tags = await send({ type: 'tags', bvid: record.bvid });
      signal.throwIfAborted();
      await send({ type: 'record', event: record });
      finished++;
      progress(`正在补齐标签 ${finished}/${work.length}；尚未发送给模型。`);
    }
  }
  const workers = await Promise.allSettled([worker(), worker()]);
  signal.throwIfAborted();
  if (workers.some(worker => worker.status === 'rejected')) throw new Error('部分样本标签获取失败，本次未调用模型，请稍后手动重试。');
  const sample = (records: VideoEvent[]) => records.map(record => ({ title: record.title.slice(0, 300), tags: record.tags!.slice(0, 40).map(tag => tag.slice(0, 80)) }));
  return { plan: prefs.plan, revision: prefs.revision, rules: structuredClone(draft), sampleCounts: { watched: watched.length, blocked: blocked.length },
    messages: [{ role: 'user', content: JSON.stringify({ plan: prefs.plan.trim(), watched: sample(watched), blocked: sample(blocked),
      rules: { positive: draft.positive, negative: draft.negative, strict: draft.strict, positiveWins: draft.positiveWins, exactTags: draft.exactTags } }) }],
    clarifications: [], question: null };
}

