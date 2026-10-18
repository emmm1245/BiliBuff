// 验证消息边界拒绝非法输入、移除未知字段，并保留空密钥与旧设置的业务校验入口。
import { expect, expectTypeOf, test } from 'vitest';
import { parseMessage } from '../src/platform/messages';
import type { MessageResult } from '../src/platform/messages';
import type { Snapshot } from '../src/types';

test('消息拒绝未知能力、非法参数及伪造进度消息', () => {
  for (const message of [null, {}, { type: 'unknown' }, { type: 'tags', bvid: '../bad' }, { type: 'debug-toggle', enabled: 'true' },
    { type: 'video-progress', requestId: 'x' }, { type: 'video-analyze', bvid: 'BVtest', cid: 1, language: 'zh', fingerprint: 'x', task: 'summary', requestId: '' }]) {
    expect(() => parseMessage(message)).toThrow('参数无效');
  }
});
test('未知请求字段不传入业务，网页指定的旧视频模型不会覆盖可信设置', () => {
  expect(parseMessage({ type: 'tags', bvid: 'BVtest', apiKey: 'secret' })).toEqual({ type: 'tags', bvid: 'BVtest' });
  const message = parseMessage({ type: 'video-analyze', bvid: 'BVtest', cid: 1, language: 'zh', fingerprint: 'x', task: 'summary', requestId: 'x', selection: { providerId: 'other' } });
  expect(message).not.toHaveProperty('selection');
});
test('样本请求兼容手动模式，并校验自动选量范围', () => {
  expect(parseMessage({ type: 'samples' })).toEqual({ type: 'samples' });
  expect(parseMessage({ type: 'samples', counts: { watched: 0, blocked: 1000 } })).toEqual({ type: 'samples', counts: { watched: 0, blocked: 1000 } });
  for (const counts of [{ watched: 101, blocked: 1 }, { watched: 1, blocked: 1001 }, { watched: -1, blocked: 1 }, { watched: 1, blocked: 1.5 }]) {
    expect(() => parseMessage({ type: 'samples', counts })).toThrow('参数无效');
  }
});

test('保存边界保留密钥省略与显式清空的区别，并允许旧设置进入迁移', () => {
  const base = { type: 'save', settings: { old: true }, revision: 0 };
  expect(parseMessage(base)).not.toHaveProperty('apiKey');
  expect(parseMessage({ ...base, apiKey: '', providerKeys: {} })).toMatchObject({ settings: { old: true }, apiKey: '', providerKeys: {} });
  expectTypeOf<MessageResult<{ type: 'snapshot' }>>().toEqualTypeOf<Snapshot>();
});


test('视频请求保留三档章节密度并拒绝非法档位，旧请求仍可省略', () => {
  const message = { type: 'video-analyze', bvid: 'BVtest', cid: 1, language: 'zh', fingerprint: 'x', task: 'chapters', requestId: 'x' };
  for (const density of ['concise','balanced','detailed']) expect(parseMessage({ ...message, density })).toMatchObject({ density });
  expect(parseMessage(message)).not.toHaveProperty('density');
  expect(() => parseMessage({ ...message, density: 'invalid' })).toThrow('参数无效');
});


test('密度记忆消息只接受预设档位，不能借机改写其他设置', () => {
  expect(parseMessage({ type: 'video-density', density: 'detailed', settings: { autoChapters: true } })).toEqual({ type: 'video-density', density: 'detailed' });
  expect(() => parseMessage({ type: 'video-density', density: 'invalid' })).toThrow('参数无效');
});

test('总结背景记忆只接受布尔开关，不能借机改写其他设置', () => {
  expect(parseMessage({ type: 'comments-context', enabled: true, settings: { auto: true } })).toEqual({ type: 'comments-context', enabled: true });
  expect(() => parseMessage({ type: 'comments-context', enabled: 'true' })).toThrow('参数无效');
});
