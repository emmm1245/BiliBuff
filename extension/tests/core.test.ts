// 验证扩展规则、播放计时、模型输出和旧版备份兼容性。
import { expect, test } from 'vitest';
import { classify, currentSettings, isListPlayback, MAX_WALLPAPER_BYTES, mergeSuggestions, migrateSettings, modelParameters, parseDuration, parseWords, playbackBvid, playbackSeconds, requiresTags, validateBackup, validateClarification, validatePlan, validateSettings, validateSuggestions } from '../src/core';

test('留白默认关闭，旧配置与备份兼容，自选壁纸可以保存、备份和恢复', () => {
  const { homeSearch, homeWallpaper, ...old } = migrateSettings();
  expect(homeSearch).toBe(false); expect(homeWallpaper).toBe('');
  expect(currentSettings(old)).toMatchObject({ homeSearch: false, homeWallpaper: '' });
  expect(validateSettings(old)).toMatchObject({ homeSearch: false, homeWallpaper: '' });
  const settings = validateSettings({ ...old, homeSearch: true, homeWallpaper: 'data:image/png;base64,YQ==' });
  const restored = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null });
  expect(restored.settings).toEqual(settings);
  expect(validateSettings({ ...settings, homeWallpaper: '' }).homeWallpaper).toBe('');
  expect(() => validateSettings({ ...old, homeSearch: 'true' })).toThrow();
  for (const wallpaper of [null, 'https://example.com/bg.jpg', 'data:image/svg+xml;base64,YQ==', 'data:image/png;base64,a";}body{}', `data:image/png;base64,${'A'.repeat(Math.ceil(MAX_WALLPAPER_BYTES / 3) * 4 + 100)}`]) {
    expect(() => validateSettings({ ...old, homeWallpaper: wallpaper })).toThrow('壁纸');
  }
});

test('特殊业务卡片遮罩默认关闭，旧设置兼容，保存和备份保留开关', () => {
  const { blockSpecialCards, ...oldSettings } = migrateSettings();
  expect(blockSpecialCards).toBe(false);
  expect(currentSettings(oldSettings).blockSpecialCards).toBe(false);
  expect(validateSettings(oldSettings).blockSpecialCards).toBe(false);
  const settings = validateSettings({ ...oldSettings, blockSpecialCards: true });
  expect(settings.blockSpecialCards).toBe(true);
  expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null }).settings.blockSpecialCards).toBe(true);
  expect(() => validateSettings({ ...oldSettings, blockSpecialCards: 'true' })).toThrow('规则开关');
});

test('计划分析默认通用模式，旧配置兼容，严格分析可保存备份且不改变过滤开关', () => {
  const { analysisMode, ...old } = migrateSettings();
  expect(analysisMode).toBe('general');
  expect(validateSettings(old).analysisMode).toBe('general');
  const settings = validateSettings({ ...old, analysisMode: 'strict' });
  const restored = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null });
  expect(restored.settings).toMatchObject({ analysisMode: 'strict', strict: false });
  expect(() => validateSettings({ ...old, analysisMode: 'unknown' })).toThrow('计划分析模式');
});

test('自动选量默认关闭，旧设置兼容，保存和备份保留开关及手动数量', () => {
  const { autoSamples, ...old } = migrateSettings();
  expect(autoSamples).toBe(false);
  expect(validateSettings(old).autoSamples).toBe(false);
  const settings = validateSettings({ ...old, autoSamples: true, minWatched: 9, minBlocked: 120 });
  const restored = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null });
  expect(restored.settings).toMatchObject({ autoSamples: true, minWatched: 9, minBlocked: 120 });
  expect(() => validateSettings({ ...old, autoSamples: 'true' })).toThrow();
});

test('屏蔽样本支持1至1000且备份保留设置，观看门槛保持1至100', () => {
  const settings = validateSettings({ ...migrateSettings(), minBlocked: 1000 });
  expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null }).settings.minBlocked).toBe(1000);
  for (const value of [0, 1.5, 1001, '100']) expect(() => validateSettings({ ...settings, minBlocked: value })).toThrow('屏蔽');
  expect(() => validateSettings({ ...settings, minWatched: 101 })).toThrow('观看');
});

test('卡片总时长按分秒或时分秒读取，缺失和非法值保持未知', () => {
  expect(parseDuration(' 00:57 ')).toBe(57);
  expect(parseDuration('04:00')).toBe(240);
  expect(parseDuration('136:42')).toBe(8202);
  expect(parseDuration('02:16:42')).toBe(8202);
  for (const text of ['', '直播', '00:00', '01:60', '01:60:00', '1:2', '-1:30', '10:26播放']) expect(parseDuration(text)).toBeNull();
});

test('词条规范化去重，不拆分短语', () => {
  expect(parseWords('ＡＩ，ai\n机器 学习;数学；数学')).toEqual(['ai', '机器 学习', '数学']);
});

test('遮罩原因默认关闭，旧设置补齐默认值，保存及备份保留用户选择', () => {
  const { showMaskReasons, ...oldSettings } = migrateSettings();
  expect(showMaskReasons).toBe(false);
  expect(currentSettings(oldSettings).showMaskReasons).toBe(false);
  expect(validateSettings(oldSettings).showMaskReasons).toBe(false);
  const settings = validateSettings({ ...oldSettings, showMaskReasons: true });
  const backup = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '', events: [], result: null });
  expect(backup.settings.showMaskReasons).toBe(true);
  expect(() => validateSettings({ ...oldSettings, showMaskReasons: 'true' })).toThrow();
});
for (const strict of [false, true]) for (const positiveWins of [false, true]) {
  test(`规则真值表：严格 ${strict}，偏好优先 ${positiveWins}`, () => {
    const settings = migrateSettings({ topics: '数学', blocked: '游戏', tags: false });
    Object.assign(settings, { strict, positiveWins });
    expect(classify('数学', [], settings).kind).toBe('highlight');
    expect(classify('游戏', [], settings).kind).toBe('blocked');
    expect(classify('日常', [], settings).kind).toBe(strict ? 'blocked' : 'normal');
    expect(classify('数学游戏', [], settings).kind).toBe(positiveWins ? 'highlight' : 'blocked');
  });
}
test('严格模式标签未就绪与失败都占位，返回后重判', () => {
  const settings = migrateSettings(); settings.strict = true; settings.positive.tags = ['数学'];
  for (const state of ['loading', 'failed', 'unavailable']) expect(classify('课程', [], settings, state).kind).toBe('pending');
  expect(classify('课程', ['数学'], settings).kind).toBe('highlight');
  expect(classify('课程', [], settings).kind).toBe('blocked');
});
test('负向标题仍可能被偏好标签放行', () => {
  const settings = migrateSettings({ blocked: '游戏' }); settings.positive.tags = ['数学'];
  expect(requiresTags('游戏教学', settings)).toBeTruthy();
  expect(classify('游戏教学', ['数学'], settings).kind).toBe('highlight');
});
test('标签完整匹配不改变跨标签标题词的包含匹配', () => {
  const settings = migrateSettings(); settings.negative.tags = ['游戏']; settings.exactTags = true;
  expect(classify('课程', ['单机游戏'], settings).kind).toBe('normal');
  settings.negative.text = ['游戏'];
  expect(classify('课程', ['单机游戏'], settings).kind).toBe('blocked');
});
test('计时排除拖动、暂停，倍速按实际时间累计', () => {
  expect(playbackSeconds(10, 90, .5, 1)).toBe(0);
  expect(playbackSeconds(10, 3, .5, 1)).toBe(0);
  expect(playbackSeconds(10, 10, 10, 1)).toBe(0);
  expect(playbackSeconds(10, 11, .5, 2)).toBe(.5);
});

test('读取普通视频、稍后再看和收藏列表当前视频，排除搜索与其他页面', () => {
  expect(playbackBvid('/video/BVoriginal/', '?bvid=BVwrong')).toBe('BVoriginal');
  expect(playbackBvid('/list/watchlater', '?bvid=BVfirst&oid=123')).toBe('BVfirst');
  expect(playbackBvid('/list/ml123/', '?bvid=BVsecond')).toBe('BVsecond');
  for (const path of ['/all', '/history', '/', '/bangumi/play/ss123', '/list/unknown']) {
    expect(playbackBvid(path, '?bvid=BVtest')).toBe('');
    expect(isListPlayback(path)).toBe(false);
  }
  for (const search of ['', '?oid=123', '?bvid=av123', '?bvid=BVbad%2Fid']) {
    expect(playbackBvid('/list/watchlater', search)).toBe('');
  }
});

test('过滤原因说明匹配来源和词条，区分严格模式与标签失败', () => {
  const settings = migrateSettings({ blocked: '游戏', tags: false });
  expect(classify('游戏实况', [], settings).reason).toBe('避开内容 · 标题：游戏');
  settings.negative.tags = ['娱乐'];
  expect(classify('日常', ['娱乐'], settings).reason).toBe('避开内容 · 视频标签：娱乐');
  settings.strict = true;
  expect(classify('日常', [], settings).reason).toBe('严格模式：未命中偏好内容');
  expect(classify('日常', [], settings, 'failed').reason).toContain('标签获取失败');
});
test('建议仅增量添加，保持原草稿和开关', () => {
  const settings = migrateSettings({ topics: '数学' });
  const merged = mergeSuggestions(settings, [{ side: 'negative', field: 'tags', word: '游戏', reason: '依据' }]);
  expect(merged.negative.tags).toEqual(['游戏']); expect(settings.negative.tags).toEqual([]);
  expect(merged.positiveWins).toBe(settings.positiveWins);
});

test('新增与删除按分区字段应用，重复应用不影响其他词条或原草稿', () => {
  const settings = migrateSettings({ topics: '数学,新闻', blocked: '新闻' }); settings.positive.tags = ['新闻'];
  const suggestions = validateSuggestions({ summary: '整理配置', suggestions: [
    { action: 'remove', side: 'positive', field: 'text', word: '新闻', reason: '偏离计划' },
    { action: 'add', side: 'positive', field: 'tags', word: '英语', reason: '学习需要' },
  ] }).suggestions;
  const merged = mergeSuggestions(settings, suggestions);
  expect(merged.positive.text).toEqual(['数学']); expect(merged.positive.tags).toEqual(['新闻', '英语']); expect(merged.negative.text).toEqual(['新闻']);
  expect(mergeSuggestions(merged, suggestions)).toEqual(merged); expect(settings.positive.text).toEqual(['数学', '新闻']);
});

test('删除不能使严格模式偏好为空，失败不改变草稿，替换成新偏好可行', () => {
  const settings = migrateSettings({ topics: '新闻' }); settings.strict = true;
  const removal = { action: 'remove' as const, side: 'positive' as const, field: 'text' as const, word: '新闻', reason: '不相关' };
  expect(() => mergeSuggestions(settings, [removal])).toThrow('至少一个偏好词条'); expect(settings.positive.text).toEqual(['新闻']);
  expect(mergeSuggestions(settings, [removal, { ...removal, action: 'add', word: '数学' }]).positive.text).toEqual(['数学']);
});

test('旧建议按新增兼容，新备份保留删除动作和本次澄清记录', () => {
  const old = { summary: '旧建议', suggestions: [{ side: 'positive', field: 'text', word: '数学', reason: '符合计划' }], plan: '备考', at: 1 };
  const backup = { format: 'bilibili-focus-backup', version: 1, settings: migrateSettings(), plan: '备考', events: [], result: old };
  expect(validateBackup(backup).result?.suggestions[0]?.action).toBe('add');
  const updated = { ...old, suggestions: [{ ...old.suggestions[0], action: 'remove' }],
    clarifications: [{ question: '具体目标？', kind: 'custom', answer: '备考数学' }, { question: '进度？', kind: 'skip', answer: '' }] };
  const restored = validateBackup({ ...backup, result: updated });
  expect(restored.result?.suggestions[0]?.action).toBe('remove'); expect(restored.result?.clarifications).toEqual(updated.clarifications);
  expect(() => validateBackup({ ...backup, result: { ...updated, clarifications: [{ question: '目标？', kind: 'custom', answer: '' }] } })).toThrow();
});

test('同一词条的冲突操作拒绝，同类建议去重，未知操作拒绝', () => {
  const item = { side: 'positive', field: 'text', word: '数学', reason: '理由' };
  expect(() => validateSuggestions({ summary: '', suggestions: [{ ...item, action: 'add' }, { ...item, action: 'remove' }] })).toThrow('同时建议新增和删除');
  expect(validateSuggestions({ summary: '', suggestions: [item, item] }).suggestions).toHaveLength(1);
  expect(() => validateSuggestions({ summary: '', suggestions: [{ ...item, action: 'replace' }] })).toThrow('无效的词条操作');
});

test('澄清选项必须有效且不重复，自定义和跳过由界面并列提供', () => {
  expect(validateClarification({ summary: '需要明确方向', question: '学习用途？', options: [' 考试 ', '项目'] }).options).toEqual(['考试', '项目']);
  for (const options of [[], ['考试'], ['考试', '考试'], ['考试', '自定义'], ['考试', '跳过'], ['考试', '']]) {
    expect(() => validateClarification({ summary: '', question: '用途？', options })).toThrow();
  }
});
test('旧版备份补齐模型参数，保留空密钥的明确移除语义', () => {
  const settings = migrateSettings(); const old = { ...settings, ai: undefined };
  const backup = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: old, plan: '备考', events: [], result: null, apiKey: '' });
  expect(backup.settings.ai.model).toBe('deepseek-flash'); expect(backup.apiKey).toBe('');
});
test('拒绝严格模式空偏好、非法备份与未知字段注入', () => {
  expect(() => validateSettings({ ...migrateSettings(), strict: true })).toThrow();
  expect(() => validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: {}, plan: '', events: [] })).toThrow();
  const settings = validateSettings({ ...migrateSettings(), injected: true, positive: { ...migrateSettings().positive, injected: true } });
  expect('injected' in settings).toBe(false); expect('injected' in settings.positive).toBe(false);
});
test('思考模式与输出上限进入模型请求', () => {
  const ai = { ...migrateSettings().ai, thinking: true, effort: 'max' as const, maxTokens: 131072 };
  expect(modelParameters(ai)).toEqual({ model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'max', max_tokens: 131072 });
});

test('旧配置默认关闭复核且限100字，新配置和阿里云密钥可以往返备份', () => {
  const { review, planMaxLength, ...old } = migrateSettings();
  expect(review.enabled).toBe(false); expect(planMaxLength).toBe(100);
  expect(validateSettings(old)).toMatchObject({ review: { enabled: false, mode: 'general', workspaceId: '' }, planMaxLength: 100 });
  const settings = validateSettings({ ...old, review: { enabled: true, mode: 'decision', workspaceId: '123', injected: true }, planMaxLength: 200 });
  const backup = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '备考', events: [], result: null, decisionApiKey: 'key' });
  expect(backup.settings.review).toEqual({ enabled: true, mode: 'decision', workspaceId: '123' });
  expect(backup.settings.planMaxLength).toBe(200); expect(backup.decisionApiKey).toBe('key');
  expect(() => validateBackup({ ...backup, decisionApiKey: 'bad key' })).toThrow();
  expect(validateBackup({ ...backup, decisionApiKey: '' }).decisionApiKey).toBe('');
});

test('计划上限限制保存配置与模型输入，旧超长备份保留原文', () => {
  expect(() => validatePlan('数'.repeat(100), 100)).not.toThrow();
  expect(() => validatePlan('数'.repeat(101), 100)).toThrow('超过 100 字');
  expect(() => validatePlan(' ', 100)).toThrow('填写');
  for (const limit of [0, 1.5, 6001, '100']) expect(() => validateSettings({ ...migrateSettings(), planMaxLength: limit })).toThrow();
  for (const review of [{ enabled: 'true' }, { mode: 'other' }, { workspaceId: '123.evil' }]) {
    expect(() => validateSettings({ ...migrateSettings(), review: { ...migrateSettings().review, ...review } })).toThrow();
  }
  const plan = '旧'.repeat(101);
  expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: migrateSettings(), plan, events: [], result: null }).plan).toBe(plan);
});

test('阿里云空间标识支持 ws 和 llm 前缀，保存和备份保留原标识', () => {
  for (const workspaceId of ['ws-example123', 'llm-example123', '123']) {
    const settings = validateSettings({ ...migrateSettings(), review: { enabled: true, mode: 'decision', workspaceId } });
    expect(settings.review.workspaceId).toBe(workspaceId);
    const backup = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings, plan: '备考', events: [], result: null });
    expect(backup.settings.review.workspaceId).toBe(workspaceId);
  }
  for (const workspaceId of ['ws-', 'ws-abc.evil', 'ws-abc/path', 'ws-abc@evil', 'ws-abc\n', 'https://ws-abc.cn-beijing.maas.aliyuncs.com']) {
    expect(() => validateSettings({ ...migrateSettings(), review: { ...migrateSettings().review, workspaceId } })).toThrow();
  }
});


test('旧视频设置补齐适中章节密度，三档选择随备份保留，非法值拒绝保存', () => {
  const settings = migrateSettings(), { chapterDensity, ...video } = settings.videoAssistant;
  expect(chapterDensity).toBe('balanced');
  expect(validateSettings({ ...settings, videoAssistant: video }).videoAssistant.chapterDensity).toBe('balanced');
  for (const density of ['concise','balanced','detailed'] as const) {
    const saved = validateSettings({ ...settings, videoAssistant: { ...video, chapterDensity: density } });
    expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: saved, plan: '', events: [], result: null }).settings.videoAssistant.chapterDensity).toBe(density);
  }
  expect(() => validateSettings({ ...settings, videoAssistant: { ...video, chapterDensity: 'invalid' } })).toThrow('章节密度');
});


test('三档章节范围补齐默认值、自定义范围随备份保留，拒绝上下限倒置', () => {
  const settings = migrateSettings(), { chapterRanges, ...old } = settings.videoAssistant;
  expect(chapterRanges).toEqual({ concise: { min: 2, max: 3 }, balanced: { min: 3, max: 6 }, detailed: { min: 5, max: 12 } });
  expect(validateSettings({ ...settings, videoAssistant: old }).videoAssistant.chapterRanges).toEqual(chapterRanges);
  const saved = validateSettings({ ...settings, videoAssistant: { ...settings.videoAssistant, chapterRanges: { ...chapterRanges, concise: { min: 1, max: 4 } } } });
  expect(validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: saved, plan: '', events: [], result: null }).settings.videoAssistant.chapterRanges.concise).toEqual({ min: 1, max: 4 });
  for (const range of [{ min: 4, max: 3 },{ min: 0, max: 3 },{ min: 1.5, max: 3 }]) expect(() => validateSettings({ ...settings, videoAssistant: { ...settings.videoAssistant, chapterRanges: { ...chapterRanges, concise: range } } })).toThrow('上下限');
});
