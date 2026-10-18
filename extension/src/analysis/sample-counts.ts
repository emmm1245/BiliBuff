// 仅根据素材总量独立选择分析样本数，沿用计划分析模型和生成参数。
import { z } from 'zod';
import { modelParameters } from '../core';
import { requestAI } from '../ai-request';
import type { Preferences } from '../types';

export async function chooseSampleCounts(prefs: Preferences, totals: { watched: number; blocked: number }, signal: AbortSignal) {
  if (!totals.watched && !totals.blocked) throw new Error('暂无可用于分析的观看或屏蔽素材，请先积累素材。');
  const schema = z.object({
    watched: z.number().int().min(totals.watched ? 1 : 0).max(Math.min(totals.watched, 100)),
    blocked: z.number().int().min(totals.blocked ? 1 : 0).max(Math.min(totals.blocked, 1000)),
  });
  return requestAI(prefs, prefs.settings.ai, {
    ...modelParameters(prefs.settings.ai), stream: true,
    messages: [
      { role: 'system', content: '你负责为计划分析选择样本数量，不执行计划分析。你只能根据两类素材的当前总量决定合适的数量。观看（偏好）样本推荐至少10条，屏蔽样本推荐至少100条；这不是硬性门槛，素材不足时可以减少，素材充足时可以增加，以兼顾代表性与分析成本。不超过现有总量，观看最多100条，屏蔽最多1000条。有素材的类别至少选1条，没有素材的类别返回0。只返回JSON对象，包含整数 watched 和 blocked。' },
      { role: 'user', content: JSON.stringify(totals) },
    ],
  }, AbortSignal.any([signal, AbortSignal.timeout(300000)]), value => schema.parse(value), '自动选量', { schema });
}
