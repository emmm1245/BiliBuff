// 使用现有 Node 独立验证扩展核心规则、备份、权限与计时，不安装依赖、不访问网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.ts';
import { mayAccess } from '../src/access.ts';

test('扩展规则遵守模式、优先级、标题、标签及失败状态约定', () => {
  for (const strict of [false, true]) for (const positiveWins of [false, true]) for (const exactTags of [false, true]) {
    const settings = core.migrateSettings();
    Object.assign(settings, { strict, positiveWins, exactTags });
    settings.positive = { text: ['数学'], tags: ['学习'], textTags: false };
    settings.negative = { text: ['游戏'], tags: ['游戏'], textTags: false };
    const otherwise = strict ? 'blocked' : 'normal';
    const conflict = positiveWins ? 'highlight' : 'blocked';
    for (const [title, tags, expected] of [
      ['数学', [], 'highlight'], ['游戏', [], 'blocked'], ['日常', [], otherwise],
      ['数学游戏', [], conflict], ['日常', ['学习'], 'highlight'],
      ['日常', ['单机游戏'], exactTags ? otherwise : 'blocked'],
      ['日常', ['学习', '游戏'], conflict],
    ]) assert.equal(core.classify(title, tags, settings).kind, expected);
    assert.equal(core.requiresTags('数学', settings), !positiveWins);
    assert.equal(core.requiresTags('游戏', settings), positiveWins);
    for (const state of ['loading', 'failed', 'unavailable']) {
      assert.equal(core.classify('日常', [], settings, state).kind, strict ? 'pending' : 'normal');
    }
  }
});
test('扩展备份往返保留规则、模型参数、记录和空密钥语义', () => {
  const settings = core.migrateSettings();
  settings.positive.text = ['数学']; settings.positive.tags = ['学习'];
  settings.negative.text = ['游戏']; settings.negative.tags = ['娱乐'];
  settings.ai.maxTokens = 4096;
  const backup = { format: 'bilibili-focus-backup', version: 1, settings, plan: '备考', events: [{ kind: 'watched', bvid: 'BVtest', title: '数学', tags: ['学习'], at: 123, reason: '' }], result: null, apiKey: '' };
  const restored = core.validateBackup(backup);
  assert.deepEqual(restored, backup);
  assert.deepEqual(core.validateBackup(JSON.parse(JSON.stringify(restored))), backup);
});
test('输入校验拒绝非法字段值，清除未知配置字段', () => {
  assert.throws(() => core.validateSettings({ ...core.migrateSettings(), strict: true }));
  assert.throws(() => core.validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: {}, plan: '', events: [] }));
  const defaults = core.migrateSettings();
  const settings = core.validateSettings({ ...defaults, injected: true, positive: { ...defaults.positive, injected: true } });
  assert.equal('injected' in settings, false); assert.equal('injected' in settings.positive, false);
});
test('网页脚本不能读取计划、密钥和累计样本', () => {
  const id = 'test'; const options = 'chrome-extension://test/options.html';
  const sender = { id, url: 'https://www.bilibili.com/', frameId: 0 };
  for (const type of ['rules', 'record', 'tags', 'review', 'open-settings']) assert.equal(mayAccess(type, sender, id, options), true);
  for (const type of ['snapshot', 'samples', 'save', 'plan', 'result', 'export', 'import']) assert.equal(mayAccess(type, sender, id, options), false);
  assert.equal(mayAccess('export', { id, url: options }, id, options), true);
  assert.equal(mayAccess('rules', { ...sender, url: 'https://www.bilibili.com.evil.invalid/' }, id, options), false);
});
test('模型截断、思考过程、无效结构都不保存，旧建议仍按新增兼容', () => {
  for (const response of [{}, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, { choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'thinking' } }] }]) assert.throws(() => core.parseAnalysisResponse(response));
  const settings = core.migrateSettings(); const merged = core.mergeSuggestions(settings, [{ side: 'positive', field: 'text', word: '数学', reason: '依据' }]);
  assert.deepEqual(merged.positive.text, ['数学']); assert.deepEqual(settings.positive.text, []);
});
test('播放时长排除拖动，倍速按实际时间累计', () => {
  assert.equal(core.playbackSeconds(10, 90, .5, 1), 0); assert.equal(core.playbackSeconds(10, 3, .5, 1), 0);
  assert.equal(core.playbackSeconds(10, 11, .5, 2), .5);
});
