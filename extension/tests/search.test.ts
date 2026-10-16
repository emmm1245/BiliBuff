// 验证历史格式和最近 20 条语义，以及匿名联想请求和不可信返回内容。
import { afterEach, expect, test, vi } from 'vitest';
import { addSearchHistory, parseSearchHistory, requestSuggestions } from '../src/search';

afterEach(() => { vi.unstubAllGlobals(); });
test('历史保留原字段，完整词去重并移到最前，只保留最近 20 条', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ value: `词${i}`, timestamp: 20 - i }));
  const updated = addSearchHistory(entries, '词10', 100);
  expect(updated).toHaveLength(20); expect(updated[0]).toEqual({ value: '词10', timestamp: 100 });
  expect(updated.filter(item => item.value === '词10')).toHaveLength(1);
  expect(entries[0]).toEqual({ value: '词0', timestamp: 20 });
  expect(addSearchHistory(entries, '新词', 100)[19]?.value).toBe('词18');
  expect(parseSearchHistory(null)).toEqual([]);
  expect(parseSearchHistory(JSON.stringify([{ value: '词', timestamp: 1, extra: '保留' }]))).toEqual([{ value: '词', timestamp: 1, extra: '保留' }]);
  for (const data of [undefined, {}, 'null', '{}', '[{"value":1,"timestamp":1}]', '[{"value":"词"}]']) expect(() => parseSearchHistory(data)).toThrow();
});

test('联想只请求固定官方地址，不带登录信息，不使用返回 HTML', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { result: { tag: [
    { value: '摄影教程', name: '<img src=x onerror=alert(1)>' }, { value: '摄影教程' }, { value: 1 }, { value: '' }, { value: '摄影构图' },
  ] } } }) });
  vi.stubGlobal('fetch', fetcher);
  expect(await requestSuggestions('摄影 & 构图')).toEqual(['摄影教程', '摄影构图']);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url.origin + url.pathname).toBe('https://api.bilibili.com/x/web-interface/suggest');
  expect(url.searchParams.get('term')).toBe('摄影 & 构图'); expect(options.credentials).toBe('omit');
  expect(await requestSuggestions('   ')).toEqual([]);
  await expect(requestSuggestions('词'.repeat(101))).rejects.toThrow('100');
  expect(fetcher).toHaveBeenCalledOnce();
});

test('联想接口失败或返回结构变更时拒绝结果，不伪造联想', async () => {
  for (const data of [{ code: -1 }, { code: 0, data: { result: { tag: null } } }]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    await expect(requestSuggestions('摄影')).rejects.toThrow('暂不可用');
  }
});
