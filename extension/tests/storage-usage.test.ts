// 验证存储统计覆盖设置与数据库、权限状态、缺失估算和读取失败，容量单位正确换算。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { formatStorageBytes, readStorageUsage } from '../src/storage-usage';

const mocks = vi.hoisted(() => ({ getBytesInUse: vi.fn(), estimate: vi.fn(), contains: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  storage: { local: { getBytesInUse: mocks.getBytesInUse } }, permissions: { contains: mocks.contains },
} }));

beforeEach(() => {
  mocks.getBytesInUse.mockReset().mockResolvedValue(1024);
  mocks.estimate.mockReset().mockResolvedValue({ usage: 4096, quota: 100000 });
  mocks.contains.mockReset().mockResolvedValue(true);
  vi.stubGlobal('navigator', { storage: { estimate: mocks.estimate } });
});
afterEach(() => vi.unstubAllGlobals());

test('统计整个设置存储与数据库等占用，不把浏览器配额当作用量', async () => {
  expect(await readStorageUsage()).toEqual({ localBytes: 1024, databaseBytes: 4096, unlimited: true });
  expect(mocks.getBytesInUse).toHaveBeenCalledWith(null);
  expect(mocks.contains).toHaveBeenCalledWith({ permissions: ['unlimitedStorage'] });
});

test('未重新加载扩展时如实返回权限状态；缺少估算值不误报零占用', async () => {
  mocks.contains.mockResolvedValue(false);
  mocks.estimate.mockResolvedValue({ quota: 100000 });
  expect(await readStorageUsage()).toEqual({ localBytes: 1024, databaseBytes: null, unlimited: false });
  mocks.estimate.mockResolvedValue({ usage: 0 });
  expect(await readStorageUsage()).toMatchObject({ databaseBytes: 0 });
});

test('读取失败交给设置页报错，不能作为零占用展示', async () => {
  mocks.estimate.mockRejectedValue(new Error('估算失败'));
  await expect(readStorageUsage()).rejects.toThrow('估算失败');
});

test.each([[0, '0 B'], [1023, '1023 B'], [1024, '1 KB'], [1536, '1.5 KB'], [1024 ** 2, '1 MB'], [1024 ** 3, '1 GB']])('容量 %i 字节显示为 %s', (bytes, expected) => {
  expect(formatStorageBytes(bytes)).toBe(expected);
});
