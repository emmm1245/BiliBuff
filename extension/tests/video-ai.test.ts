// 验证模型识别、256k回退、输出预算与不同服务的思考参数映射。
import { expect, test } from 'vitest';
import { estimateVideoTokens, normalizeVideoSelection, videoContext, videoInputBudget, videoParameters } from '../src/video-ai';
import { indexedChunks } from '../src/video-data';

const unknown = { providerId: 'custom', model: 'unknown-model' };
test('已知型号使用已确认容量，未知和相似别名回退256k，手动容量优先', () => {
  expect(videoContext({ providerId: 'deepseek', model: 'deepseek-flash' })).toBe(1000000);
  expect(videoContext({ ...unknown, model: 'gpt-4o' })).toBe(128000);
  expect(videoContext({ ...unknown, model: 'gpt-4.1' })).toBe(1047576);
  expect(videoContext(unknown)).toBe(256000);
  expect(videoContext({ ...unknown, model: 'my-gpt-4o' })).toBe(256000);
  expect(videoContext({ ...unknown, contextTokens: 32000 })).toBe(32000);
});
test('预算预留20%、输出和指令空间，增大输出会减少字幕输入预算', () => {
  expect(videoInputBudget(unknown)).toBe(256000 * .8 - 8192 - 4096);
  expect(videoInputBudget({ ...unknown, maxTokens: 32768 })).toBeLessThan(videoInputBudget(unknown));
  expect(estimateVideoTokens('中文')).toBe(4); expect(estimateVideoTokens('abcdef')).toBe(2);
  const rows = Array.from({ length: 150 },(_,i) => ({ start: i, end: i+1, text: '完整字幕'.repeat(100) }));
  expect(indexedChunks(rows,videoInputBudget(unknown))).toHaveLength(1);
  const small = indexedChunks(rows,videoInputBudget({ ...unknown, contextTokens: 32000 }));
  expect(small.length).toBeGreaterThan(1); expect(small[0]?.first).toBe(0); expect(small.at(-1)?.last).toBe(149);
});
test('旧选择补齐默认值，DeepSeek、兼容服务和已知推理模型分别映射参数', () => {
  expect(normalizeVideoSelection({ providerId: 'deepseek', model: 'deepseek-flash' })).toMatchObject({ effort: 'off', maxTokens: 8192, contextTokens: 0 });
  expect(videoParameters({ providerId: 'deepseek', model: 'deepseek-flash', effort: 'high', maxTokens: 65536 })).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 65536 });
  expect(videoParameters(unknown)).toEqual({ max_tokens: 8192 });
  expect(videoParameters({ ...unknown, effort: 'low' })).toMatchObject({ reasoning_effort: 'low' });
  expect(videoParameters({ ...unknown, model: 'gpt-5.2', effort: 'max' })).toEqual({ max_completion_tokens: 8192, reasoning_effort: 'xhigh' });
});
test('拒绝超出能力的思考强度、非法输出与上下文容量', () => {
  expect(() => normalizeVideoSelection({ ...unknown, model: 'gpt-4o', effort: 'high' })).toThrow('思考强度');
  expect(() => normalizeVideoSelection({ ...unknown, model: 'gpt-4o', maxTokens: 32768 })).toThrow('输出上限');
  for (const contextTokens of [-1,15000,4000001,NaN]) expect(() => normalizeVideoSelection({ ...unknown, contextTokens })).toThrow('上下文容量');
  expect(() => indexedChunks([{ start: 0, end: 1, text: '很长'.repeat(100) }],20)).toThrow('单句字幕');
});
