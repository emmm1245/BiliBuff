// 验证慢保存期间的并发保护、同稿失败阻止重试与修改后继续保存。
import { expect, test, vi } from 'vitest';
import { createSaveGate } from '../src/settings/save-gate';
test('慢保存不会重复发起写入，随后提交的新草稿可以独立写入', async () => {
  const gate = createSaveGate(), writes: string[] = [];
  let finish!: () => void;
  const first = gate.run('草稿一', async () => { writes.push('草稿一'); await new Promise<void>(resolve => { finish = resolve; }); });
  expect(await gate.run('草稿二', async () => { writes.push('草稿二'); })).toBe(false);
  finish(); expect(await first).toBe(true);
  expect(await gate.run('草稿二', async () => { writes.push('草稿二'); })).toBe(true);
  expect(writes).toEqual(['草稿一','草稿二']);
});
test('真实写入失败后不循环请求，同内容主动重试或编辑新内容后可以恢复', async () => {
  const gate = createSaveGate(), write = vi.fn(async () => { throw new Error('存储失败'); });
  await expect(gate.run('草稿一',write)).rejects.toThrow('存储失败');
  expect(await gate.run('草稿一',write)).toBe(false); expect(write).toHaveBeenCalledTimes(1);
  gate.failure.current = '';
  await expect(gate.run('草稿一',write)).rejects.toThrow('存储失败'); expect(write).toHaveBeenCalledTimes(2);
  expect(await gate.run('草稿二',async () => {})).toBe(true); expect(gate.failure.current).toBe('');
});
