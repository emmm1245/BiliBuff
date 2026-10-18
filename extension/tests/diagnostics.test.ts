// 离线验证诊断的关联、并发、清除隔离、容量淘汰、脱敏和只读权限。
import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { allOperations, beginOperation, bindTraceSignal, clearOperations, DIAGNOSTIC_AGE, DIAGNOSTIC_LIMIT,
  operationFamily, recordTraceStep, retainedOperations, safeLogText, type OperationLog } from '../src/platform/diagnostics';
import { mayAccess } from '../src/access';
import { parseMessage } from '../src/platform/messages';
import { logText } from '../src/ui/DebugLogs';
import type { MessageResults } from '../src/platform/messages';
vi.mock('wxt/browser', () => ({ browser: {} }));

beforeEach(async () => { vi.restoreAllMocks(); await clearOperations(); });

test('并发步骤不相互覆盖，模型子任务可以追溯所属操作', async () => {
  const parent = await beginOperation('选片', '开始');
  const child = await beginOperation('模型', '请求', parent.id);
  const signal = bindTraceSignal(new AbortController().signal, parent.id);
  await Promise.all(Array.from({ length: 10 }, (_, i) => recordTraceStep(signal, `步骤${i}`, i === 2 ? 'warn' : 'debug')));
  await child.finish('success', '模型完成', 'raw-id');
  await parent.finish('success', '发布完成');
  const logs = await allOperations();
  expect(logs.find(log => log.id === parent.id)).toMatchObject({ status: 'success', level: 'warn', durationMs: expect.any(Number) });
  expect(logs.find(log => log.id === parent.id)?.steps).toHaveLength(10);
  expect(logs.find(log => log.id === child.id)).toMatchObject({ parentId: parent.id, rawLogId: 'raw-id' });
  expect(operationFamily(logs, parent.id)).toHaveLength(2);
  expect(operationFamily(logs, child.id)).toHaveLength(1);
});

test('清除后旧步骤、结束状态和迟到的子任务都不恢复记录', async () => {
  const old = await beginOperation('选片', '开始');
  const signal = bindTraceSignal(new AbortController().signal, old.id);
  await clearOperations();
  await Promise.all([old.step('迟到'), old.finish('success', '迟到'), recordTraceStep(signal, '迟到请求', 'warn')]);
  await beginOperation('模型', '清除前操作的新子任务', old.id);
  expect(await allOperations()).toEqual([]);
  const next = await beginOperation('选片', '新的操作');
  expect(await allOperations()).toMatchObject([{ id: next.id }]);
});

test('错误、取消、警告可区分，日志不会保存无限长的步骤', async () => {
  const operation = await beginOperation('视频', '生成');
  for (let i = 0; i < 65; i++) await operation.step('内容'.repeat(200), 'debug');
  await operation.finish('cancelled', '已取消');
  const [log] = await allOperations();
  expect(log).toMatchObject({ status: 'cancelled', level: 'info' });
  expect(log!.droppedSteps).toBeGreaterThan(0);
  expect(new TextEncoder().encode(JSON.stringify(log)).length).toBeLessThanOrEqual(4096);
  const failed = await beginOperation('视频', '生成'); await failed.finish('error', '保存失败');
  expect((await allOperations()).find(log => log.id === failed.id)?.level).toBe('error');
});

test('按时间、条数和体积淘汰，保留较新的诊断', () => {
  const now = Date.now();
  const make = (id: number, at = now - id): OperationLog => ({ id: String(id), feature: '测试', message: '完成', at, updatedAt: at, level: 'info', status: 'success', steps: [] });
  const logs = Array.from({ length: DIAGNOSTIC_LIMIT + 10 }, (_, i) => make(i));
  logs.push(make(999, now - DIAGNOSTIC_AGE - 1));
  const kept = retainedOperations(logs, now);
  expect(kept).toHaveLength(DIAGNOSTIC_LIMIT); expect(kept[0]?.id).toBe('0');
  expect(kept.some(log => log.id === '999')).toBe(false);
  const oversized = Array.from({ length: 5 }, (_, i) => ({ ...make(i), message: '字'.repeat(300000) }));
  expect(retainedOperations(oversized, now)).toHaveLength(2);
});

test('摘要移除认证信息和地址中的查询参数', () => {
  const text = safeLogText('https://user:password@example.com/path?api_key=hidden Bearer private-value sk-test-secret token=another-secret');
  for (const secret of ['password', 'hidden', 'private-value', 'sk-test-secret', 'another-secret']) expect(text).not.toContain(secret);
  expect(text).toContain('https://example.com/path');
  expect(safeLogText('{"token":"quoted-secret"}')).not.toContain('quoted-secret');
});

test('易读导出保留任务关联与步骤，但不包含原始模型正文', async () => {
  const operation = await beginOperation('离线测试', '完成');
  await operation.step('读取候选', 'info', { count: 8 });
  await operation.finish('success', '发布8条');
  const data: MessageResults['debug-export'] = { format: 'bilibili-focus-debug', version: 2, exportedAt: '2026-10-18T12:00:00Z',
    environment: { extensionVersion: '1.0.0', browser: 'offline-browser' }, operations: await allOperations(), browseRounds: [], biliNetwork: { logs: [], cooldowns: {} },
    logs: [{ id: 'raw', feature: '计划分析', service: 'offline', url: 'https://example.com', startedAt: '', status: 'success', input: { text: 'private-plan' }, output: 'private-output' }] };
  const output = logText(data);
  for (const value of [operation.id, '发布8条', '读取候选', 'offline-browser', '1.0.0']) expect(output).toContain(value);
  for (const value of ['private-plan', 'private-output']) expect(output).not.toContain(value);
});

test('日志写入失败仍返回可使用的记录器', async () => {
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => { throw new Error('quota'); });
  const operation = await beginOperation('测试', '开始');
  await expect(operation.finish('success', '完成')).resolves.toBeUndefined();
  transaction.mockRestore();
  expect(await allOperations()).toEqual([]);
});

test('日志列表、详情和导出仅允许可信设置页读取，参数受校验', () => {
  for (const type of ['debug-list', 'debug-detail', 'debug-export', 'debug-clear']) {
    expect(mayAccess(type, { id: 'test', frameId: 0, url: 'https://www.bilibili.com/' }, 'test', 'chrome-extension://test/options.html')).toBe(false);
    expect(mayAccess(type, { id: 'test', frameId: 0, url: 'chrome-extension://test/options.html' }, 'test', 'chrome-extension://test/options.html')).toBe(true);
  }
  expect(parseMessage({ type: 'debug-export', operationId: 'operation-id' })).toEqual({ type: 'debug-export', operationId: 'operation-id' });
  expect(() => parseMessage({ type: 'debug-detail', id: '' })).toThrow();
});
