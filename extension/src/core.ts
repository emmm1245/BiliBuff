// 提供不依赖浏览器的规则判定、播放计时、模型结果和备份校验。
import type { AIOptions, AnalysisResult, Backup, Clarification, ClarificationAnswer, RuleGroup, Settings, Side, Suggestion, Suggestions, VideoEvent, WordField } from './types';
import { DEEPSEEK, DEEPSEEK_MODELS, validateProviderKeys, validateProviders } from './ai-providers.ts';

export function normalize(text: string) { return text.normalize('NFKC').toLowerCase().trim(); }
export function parseWords(text: string) { return [...new Set(text.split(/[\n,，;；]+/).map(normalize).filter(Boolean))]; }
export function migrateSettings(old: { topics?: string; blocked?: string; tags?: boolean } = {}): Settings {
  return {
    positive: { text: parseWords(old.topics || ''), tags: [], textTags: old.tags ?? true },
    negative: { text: parseWords(old.blocked || ''), tags: [], textTags: old.tags ?? true },
    strict: false, positiveWins: true, exactTags: false, blockAds: true, hideCarousel: false, showMaskReasons: false,
    homeSearch: false, homeWallpaper: '', minWatched: 10, minBlocked: 100,
    ai: { model: 'deepseek-flash', thinking: false, effort: 'high', maxTokens: 65536 },
    providers: [{ ...DEEPSEEK }],
    review: { enabled: false, mode: 'general', workspaceId: '' },
    quickRead: { auto: false, limit: 1000, valuableCount: 5, providerId: 'deepseek', model: 'deepseek-flash' }, planMaxLength: 100,
  };
}
export function currentSettings(saved: Partial<Settings> = {}): Settings {
  const defaults = migrateSettings();
  return { ...defaults, ...saved, ai: { ...defaults.ai, ...saved.ai }, review: { ...defaults.review, ...saved.review }, quickRead: { ...defaults.quickRead, ...saved.quickRead } };
}
export const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024;
export function validateWallpaper(value: unknown): string {
  if (typeof value !== 'string' || (value !== '' &&
      (value.length > Math.ceil(MAX_WALLPAPER_BYTES / 3) * 4 + 100 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)))) {
    throw new Error('壁纸请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。');
  }
  return value;
}
export function validatePlan(plan: string, maxLength: number) {
  if (!plan.trim()) throw new Error('请先填写近期计划。');
  if (plan.length > maxLength) throw new Error(`近期计划超过 ${maxLength} 字，请缩短计划或在“AI 计划分析 → 分析设置”中提高上限。`);
}
export function validWorkspaceId(value: string) {
  return /^(?:\d+|(?:ws|llm)-[a-z0-9]+(?:-[a-z0-9]+)*)$/i.test(value);
}
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
export function isListPlayback(pathname: string) { return /^\/list\/(?:watchlater|ml\d+)\/?$/.test(pathname); }
export function playbackBvid(pathname: string, search = '') {
  const id = pathname.match(/^\/video\/(BV\w+)\/?$/)?.[1] ||
    (isListPlayback(pathname) ? new URLSearchParams(search).get('bvid') || '' : '');
  return /^BV\w+$/.test(id) ? id : '';
}
export function playbackSeconds(previous: number, current: number, wallSeconds: number, rate: number) {
  const delta = current - previous;
  if (delta <= 0 || wallSeconds <= 0 || delta > wallSeconds * rate + 1) return 0;
  return Math.min(delta / rate, wallSeconds);
}
export function parseDuration(text: string): number | null {
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(text.trim())) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.slice(1).some(part => part > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}
export function recentSamples(records: VideoEvent[], limit = 100) {
  const unique = new Map<string, VideoEvent>();
  for (const record of records) {
    if (!record.bvid || !record.title) continue;
    if (!unique.has(record.bvid) || unique.get(record.bvid)!.at < record.at) unique.set(record.bvid, record);
  }
  return [...unique.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据结构不正确。');
  return value as Record<string, unknown>;
}
export function validateAIOptions(value: unknown): AIOptions {
  const ai = object(value);
  if (typeof ai.model !== 'string' || /\s/.test(ai.model) || (ai.providerId !== undefined && (typeof ai.providerId !== 'string' || !ai.providerId)) ||
      ((ai.providerId ?? 'deepseek') === 'deepseek' && !DEEPSEEK_MODELS.includes(ai.model)) || typeof ai.thinking !== 'boolean' ||
      !['low', 'high', 'max'].includes(String(ai.effort)) || !Number.isInteger(ai.maxTokens) || Number(ai.maxTokens) < 1024 || Number(ai.maxTokens) > 393216) {
    throw new Error('请检查模型设置：选择有效模型与思考强度，生成上限填写 1,024–393,216 之间的整数。');
  }
  return { ...(ai.providerId !== undefined ? { providerId: ai.providerId as string } : {}), model: ai.model, thinking: ai.thinking, effort: ai.effort as AIOptions['effort'], maxTokens: Number(ai.maxTokens) };
}
export function modelParameters(ai: AIOptions) {
  const options = validateAIOptions(ai);
  if ((options.providerId ?? 'deepseek') !== 'deepseek') return { model: options.model, max_tokens: options.maxTokens };
  return { model: options.model, thinking: { type: options.thinking ? 'enabled' : 'disabled' },
    ...(options.thinking ? { reasoning_effort: options.effort } : {}), max_tokens: options.maxTokens };
}
export function validateSuggestions(value: unknown): Suggestions {
  const data = object(value);
  if (typeof data.summary !== 'string' || !Array.isArray(data.suggestions) || data.suggestions.length > 40) throw new Error('模型返回的建议结构不正确，请手动重试。');
  const seen = new Map<string, Suggestion['action']>();
  const suggestions: Suggestion[] = data.suggestions.map((value): Suggestion => {
    const item = object(value);
    if (!['positive', 'negative'].includes(String(item.side)) || !['text', 'tags'].includes(String(item.field)) || typeof item.word !== 'string' || typeof item.reason !== 'string') throw new Error('模型返回了无效词条。');
    if (item.action !== undefined && item.action !== 'add' && item.action !== 'remove') throw new Error('模型返回了无效的词条操作。');
    const word = normalize(item.word);
    if (!word || word.length > 60 || /[\n,，;；]/.test(word)) throw new Error('模型返回了无效词条。');
    return { action: item.action === 'remove' ? 'remove' : 'add', side: item.side as Side, field: item.field as WordField, word, reason: item.reason.slice(0, 400) };
  }).filter(item => {
    const key = `${item.side}:${item.field}:${item.word}`;
    if (seen.has(key)) {
      if (seen.get(key) !== item.action) throw new Error('模型对同一词条同时建议新增和删除，请重新分析。');
      return false;
    }
    seen.set(key, item.action); return true;
  });
  return { summary: data.summary.slice(0, 4000), suggestions };
}
export function parseModelResponse(value: unknown): unknown {
  const response = object(value);
  const choices = response.choices;
  const choice = Array.isArray(choices) && choices[0] ? object(choices[0]) : null;
  if (!choice?.message) throw new Error('接口返回缺少分析结果，未保存建议。');
  if (choice.finish_reason === 'length') throw new Error('模型生成达到输出上限，结果被截断，未保存建议。');
  if (choice.finish_reason !== 'stop') throw new Error('模型未正常结束生成，未保存建议。');
  const message = object(choice.message);
  if (typeof message.content !== 'string' || !message.content.trim()) throw new Error(message.reasoning_content ? '模型只返回了思考过程，没有正式结果，未保存建议。' : '模型返回的正式结果为空，未保存建议。');
  let parsed: unknown;
  try { parsed = JSON.parse(message.content); } catch { throw new Error('模型没有返回完整 JSON，未保存建议。'); }
  return parsed;
}
export function parseAnalysisResponse(value: unknown) {
  return validateSuggestions(parseModelResponse(value));
}
export function validateClarification(value: unknown): Clarification {
  const data = object(value);
  if (typeof data.summary !== 'string' || typeof data.question !== 'string' || !data.question.trim() || data.question.length > 300 ||
      !Array.isArray(data.options) || data.options.length < 2 || data.options.length > 5 ||
      data.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 200)) throw new Error('模型返回的澄清选项不完整，请重新分析。');
  const options = data.options.map(option => (option as string).trim());
  if (new Set(options).size !== options.length || options.some(option => /^(自定义|跳过)$/.test(option))) throw new Error('模型返回了重复的澄清选项，请重新分析。');
  return { summary: data.summary.slice(0, 4000), question: data.question.trim(), options };
}
export function validateClarificationAnswer(value: unknown): ClarificationAnswer {
  const data = object(value);
  if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 300 ||
      !['option', 'custom', 'skip'].includes(String(data.kind)) || typeof data.answer !== 'string' || data.answer.length > 1000 ||
      (data.kind === 'skip' ? data.answer !== '' : !data.answer.trim())) throw new Error('请填写有效的澄清回答（最多 1000 字）。');
  return { question: data.question, kind: data.kind as ClarificationAnswer['kind'], answer: data.answer.trim() };
}
export function mergeSuggestions(settings: Settings, suggestions: Suggestion[]) {
  const merged = structuredClone(settings);
  for (const { action, side, field, word } of suggestions) {
    if (action === 'remove') merged[side][field] = merged[side][field].filter(value => value !== word);
    else if (!merged[side][field].includes(word)) merged[side][field].push(word);
  }
  if (merged.strict && !merged.positive.text.length && !merged.positive.tags.length) throw new Error('严格模式需要至少一个偏好词条，请保留一个偏好词条或同时选择新增建议。');
  return merged;
}
export function validateSettings(value: unknown): Settings {
  const data = object(value);
  if (!data.positive || !data.negative) throw new Error('缺少规则分区。');
  const settings = currentSettings(data as Partial<Settings>);
  for (const side of ['positive', 'negative'] as const) {
    const group = object(settings[side]);
    if (typeof group.textTags !== 'boolean') throw new Error('词条开关无效。');
    for (const field of ['text', 'tags'] as const) {
      const words = group[field];
      if (!Array.isArray(words) || words.some(word => typeof word !== 'string' || !word.trim())) throw new Error('词条数据无效。');
      settings[side] = { ...settings[side], [field]: [...new Set(words.map(normalize))] };
    }
    settings[side] = { text: settings[side].text, tags: settings[side].tags, textTags: group.textTags };
  }
  for (const field of ['strict', 'positiveWins', 'exactTags', 'blockAds', 'hideCarousel', 'showMaskReasons', 'homeSearch'] as const) if (typeof settings[field] !== 'boolean') throw new Error('规则开关无效。');
  settings.homeWallpaper = validateWallpaper(settings.homeWallpaper);
  for (const field of ['minWatched', 'minBlocked'] as const) {
    const limit = field === 'minBlocked' ? 1000 : 100;
    if (!Number.isInteger(settings[field]) || settings[field] < 1 || settings[field] > limit) throw new Error(`${field === 'minBlocked' ? '屏蔽' : '观看'}样本数量必须为 1–${limit} 的整数。`);
  }
  if (settings.strict && !settings.positive.text.length && !settings.positive.tags.length) throw new Error('严格模式需要至少一个偏好词条。');
  settings.ai = validateAIOptions(settings.ai);
  settings.providers = validateProviders(settings.providers);
  const quick = object(settings.quickRead);
  if (typeof quick.auto !== 'boolean' || !Number.isInteger(quick.limit) || Number(quick.limit) < 1 || Number(quick.limit) > 10000 ||
      !Number.isInteger(quick.valuableCount) || Number(quick.valuableCount) < 1 || Number(quick.valuableCount) > 50 ||
      typeof quick.providerId !== 'string' || !settings.providers.some(provider => provider.id === quick.providerId) ||
      typeof quick.model !== 'string' || /\s/.test(quick.model) || (quick.providerId === 'deepseek' && !DEEPSEEK_MODELS.includes(quick.model))) {
    throw new Error('请检查评论速读设置：分析上限为1–10000条，推荐数量为1–50条，并选择有效服务与模型。');
  }
  settings.quickRead = { auto: quick.auto, limit: Number(quick.limit), valuableCount: Number(quick.valuableCount), providerId: quick.providerId, model: quick.model };
  if (!settings.providers.some(provider => provider.id === (settings.ai.providerId ?? 'deepseek'))) throw new Error('请重新选择手动分析使用的 AI 服务。');
  const review = object(settings.review);
  if (typeof review.enabled !== 'boolean' || !['general', 'decision'].includes(String(review.mode)) ||
      typeof review.workspaceId !== 'string' || (review.workspaceId && !validWorkspaceId(review.workspaceId))) throw new Error('请检查 AI 复核模式和阿里云业务空间标识（例如 ws-abc123）。');
  settings.review = { enabled: review.enabled, mode: review.mode as Settings['review']['mode'], workspaceId: review.workspaceId };
  if (review.providerId !== undefined || review.model !== undefined) {
    if (typeof review.providerId !== 'string' || !settings.providers.some(provider => provider.id === review.providerId) ||
        typeof review.model !== 'string' || /\s/.test(review.model) || (review.providerId === 'deepseek' && !DEEPSEEK_MODELS.includes(review.model))) throw new Error('请检查 AI 复核使用的服务与模型。');
    settings.review = { ...settings.review, providerId: review.providerId, model: review.model };
  }
  if (!Number.isInteger(settings.planMaxLength) || settings.planMaxLength < 1 || settings.planMaxLength > 6000) throw new Error('计划最大字数必须为 1–6000 之间的整数。');
  // 仅返回已知字段，备份和消息不能注入任意配置。
  return { positive: settings.positive, negative: settings.negative, strict: settings.strict, positiveWins: settings.positiveWins,
    exactTags: settings.exactTags, blockAds: settings.blockAds, hideCarousel: settings.hideCarousel, showMaskReasons: settings.showMaskReasons,
    homeSearch: settings.homeSearch, homeWallpaper: settings.homeWallpaper,
    minWatched: settings.minWatched, minBlocked: settings.minBlocked, ai: settings.ai, providers: settings.providers, review: settings.review, quickRead: settings.quickRead, planMaxLength: settings.planMaxLength };
}
export function validateEvent(value: unknown): VideoEvent {
  const event = object(value);
  if (!['highlight', 'blocked', 'watched'].includes(String(event.kind)) || typeof event.bvid !== 'string' || !/^BV\w+$/.test(event.bvid) ||
    typeof event.title !== 'string' || !event.title.trim() || typeof event.at !== 'number' || !Number.isFinite(event.at) || event.at < 0 ||
    !(event.tags === null || (Array.isArray(event.tags) && event.tags.every(tag => typeof tag === 'string'))) || typeof event.reason !== 'string') throw new Error('视频记录无效。');
  return { kind: event.kind as VideoEvent['kind'], bvid: event.bvid, title: event.title, at: event.at, tags: event.tags as string[] | null, reason: event.reason };
}
export function validateResult(value: unknown): AnalysisResult {
  const result = object(value);
  if (typeof result.plan !== 'string' || result.plan.length > 6000 || typeof result.at !== 'number' || !Number.isFinite(result.at) || result.at < 0) throw new Error('分析记录无效。');
  if (result.clarifications !== undefined && !Array.isArray(result.clarifications)) throw new Error('分析澄清记录无效。');
  return { ...validateSuggestions(result), plan: result.plan, at: result.at, ...(result.ai ? { ai: validateAIOptions(result.ai) } : {}),
    ...(Array.isArray(result.clarifications) ? { clarifications: result.clarifications.map(validateClarificationAnswer) } : {}) };
}
export function validateBackup(value: unknown): Backup {
  const data = object(value);
  if (data.format !== 'bilibili-focus-backup' || data.version !== 1 || typeof data.plan !== 'string' || data.plan.length > 6000 || !Array.isArray(data.events)) throw new Error('备份格式不正确或版本不支持，未导入。');
  const backup: Backup = { format: 'bilibili-focus-backup', version: 1, settings: validateSettings(data.settings), plan: data.plan, events: data.events.map(validateEvent), result: data.result == null ? null : validateResult(data.result) };
  if (Object.hasOwn(data, 'apiKey')) {
    if (typeof data.apiKey !== 'string' || /\s/.test(data.apiKey)) throw new Error('备份中的密钥无效。');
    backup.apiKey = data.apiKey;
  }
  if (Object.hasOwn(data, 'decisionApiKey')) {
    if (typeof data.decisionApiKey !== 'string' || /\s/.test(data.decisionApiKey)) throw new Error('备份中的阿里云密钥无效。');
    backup.decisionApiKey = data.decisionApiKey;
  }
  if (Object.hasOwn(data, 'providerKeys')) backup.providerKeys = validateProviderKeys(data.providerKeys, backup.settings.providers);
  return backup;
}
