// 解析视频模型容量、生成参数、输入预算和三档内容章节数量要求。
import type { ChapterDensity, ChapterRange, VideoAssistantOptions, VideoEffort, VideoSelection } from './video-types';
export function defaultVideoOptions(selection: VideoSelection = { providerId: 'deepseek', model: 'deepseek-flash' }): VideoAssistantOptions {
  const defaults = { ...selection, effort: selection.effort ?? videoEfforts(selection)[0]!, maxTokens: selection.maxTokens ?? 8192, contextTokens: selection.contextTokens ?? 0 };
  return { chapterDensity: 'balanced', chapterRanges: { concise: { min: 2, max: 3 }, balanced: { min: 3, max: 6 }, detailed: { min: 5, max: 12 } }, autoSummary: false, autoChapters: false, autoSkipAds: false, summary: { ...defaults }, chapters: { ...defaults }, chat: { ...defaults } };
}
export function videoModel(selection: VideoSelection) {
  const model = selection.model.trim().toLowerCase();
  // 容量来自官方模型文档；只匹配确认过的型号，未知别名使用256k。
  if (['deepseek-flash','deepseek-v4-pro'].includes(model)) return { context: 1000000, output: 393216, reasoning: 'deepseek' };
  if (/^gpt-4\.1(?:-2025-04-14)?$/.test(model)) return { context: 1047576, output: 32768, reasoning: 'none' };
  if (/^gpt-4o(?:-2024-08-06|-2024-11-20)?$/.test(model)) return { context: 128000, output: 16384, reasoning: 'none' };
  if (/^gpt-5\.2(?:-2025-12-11)?$/.test(model)) return { context: 400000, output: 128000, reasoning: 'openai' };
  return { context: 256000, output: 393216, reasoning: 'compatible' };
}
export function videoEfforts(selection: VideoSelection): VideoEffort[] {
  const kind = videoModel(selection).reasoning;
  if (selection.providerId === 'deepseek' || kind === 'deepseek') return ['off','low','high','max'];
  if (kind === 'none') return ['default'];
  return kind === 'openai' ? ['default','off','low','medium','high','max'] : ['default','low','medium','high'];
}
export function normalizeVideoSelection(value: VideoSelection): VideoSelection {
  const effort = value.effort ?? videoEfforts(value)[0]!;
  const maxTokens = value.maxTokens ?? 8192, contextTokens = value.contextTokens ?? 0;
  if (!videoEfforts(value).includes(effort)) throw new Error('当前模型不支持所选思考强度，请重新选择。');
  if (!Number.isInteger(maxTokens) || maxTokens < 1024 || maxTokens > videoModel(value).output) throw new Error(`输出上限需为1,024–${videoModel(value).output.toLocaleString()}之间的整数。`);
  if (!Number.isInteger(contextTokens) || (contextTokens !== 0 && (contextTokens < 16000 || contextTokens > 4000000))) throw new Error('上下文容量需为16,000–4,000,000之间的整数，留空自动识别。');
  const selection = { ...value, effort, maxTokens, contextTokens };
  if (videoInputBudget(selection) < 2048) throw new Error('输出上限占用过多上下文，请降低输出上限或核对上下文容量。');
  return selection;
}
export function estimateVideoTokens(text: string) {
  let weight = 0;
  for (const char of text) weight += char.codePointAt(0)! < 128 ? 1 / 3 : 2;
  return Math.ceil(weight);
}
export function videoContext(selection: VideoSelection) { return selection.contextTokens || videoModel(selection).context; }
export function videoInputBudget(selection: VideoSelection) {
  return Math.floor(videoContext(selection) * 0.8) - (selection.maxTokens ?? 8192) - 4096;
}
export function videoParameters(selection: VideoSelection, structured = true) {
  const effort = selection.effort ?? videoEfforts(selection)[0]!;
  const kind = videoModel(selection).reasoning, output = selection.maxTokens ?? 8192;
  if (selection.providerId === 'deepseek' || kind === 'deepseek') return { max_tokens: output,
    thinking: { type: effort === 'off' ? 'disabled' : 'enabled' },
    ...(effort === 'off' ? {} : { reasoning_effort: effort }), ...(structured ? { response_format: { type: 'json_object' } } : {}) };
  return { ...(kind === 'openai' ? { max_completion_tokens: output } : { max_tokens: output }),
    ...(effort === 'default' ? {} : { reasoning_effort: effort === 'off' ? 'none' : effort === 'max' ? 'xhigh' : effort }) };
}

export function chapterDensityInstruction(density: ChapterDensity, range: ChapterRange) {
  const modes = { concise: { label: '精简', rule: '只保留主要话题，合并连续的小知识点，避免频繁分段' },
    balanced: { label: '适中', rule: '按明确的话题转换划分，兼顾完整性与阅读效率' },
    detailed: { label: '详细', rule: '细分重要知识点、步骤和示例，方便精确定位' } };
  const mode = modes[density];
  return `章节密度：${mode.label}。${mode.rule}。整段视频的非广告内容章节偏好区间为${range.min}–${range.max}个（下限${range.min}个、上限${range.max}个），尽量遵循，广告章节另算；内容完整和语义连贯优先于数量，不必为凑数强行拆分或合并。字幕行不足时内容章节数不超过非广告字幕行数。明确商业广告仍须单独分段，不为减少章节数将广告混入正文。数量偏好不能成为遗漏字幕的理由。`;
}
