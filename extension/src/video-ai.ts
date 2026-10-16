// 解析视频模型容量、生成参数与输入预算，为字幕和摘要使用同一分段尺度。
import type { VideoEffort, VideoSelection } from './video-types';
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
export function videoParameters(selection: VideoSelection) {
  const effort = selection.effort ?? videoEfforts(selection)[0]!;
  const kind = videoModel(selection).reasoning, output = selection.maxTokens ?? 8192;
  if (selection.providerId === 'deepseek' || kind === 'deepseek') return { max_tokens: output,
    thinking: { type: effort === 'off' ? 'disabled' : 'enabled' },
    ...(effort === 'off' ? {} : { reasoning_effort: effort }), response_format: { type: 'json_object' } };
  return { ...(kind === 'openai' ? { max_completion_tokens: output } : { max_tokens: output }),
    ...(effort === 'default' ? {} : { reasoning_effort: effort === 'off' ? 'none' : effort === 'max' ? 'xhigh' : effort }) };
}
