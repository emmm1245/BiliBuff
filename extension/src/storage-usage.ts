// 读取扩展设置存储、数据库等占用的估算值及无限存储权限，统一格式化容量。
import { browser } from 'wxt/browser';

export interface StorageUsage { localBytes: number; databaseBytes: number | null; unlimited: boolean }

export async function readStorageUsage(): Promise<StorageUsage> {
  const [localBytes, estimate, unlimited] = await Promise.all([
    browser.storage.local.getBytesInUse(null),
    navigator.storage.estimate(),
    browser.permissions.contains({ permissions: ['unlimitedStorage'] }),
  ]);
  return { localBytes, databaseBytes: estimate.usage ?? null, unlimited };
}

export function formatStorageBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${Number(value.toFixed(2))} ${units[unit]}`;
}
