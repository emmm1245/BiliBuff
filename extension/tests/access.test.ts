// 验证设置页与网页脚本之间的后台权限边界。
import { expect, test } from 'vitest';
import { mayAccess } from '../src/access';
const id = 'extension-id';
const options = `chrome-extension://${id}/options.html`;
test('网页只能读取规则、请求标签及复核、记录事件与打开设置', () => {
  const sender = { id, url: 'https://www.bilibili.com/video/BVtest', frameId: 0 };
  for (const type of ['rules', 'theme', 'suggest', 'tags', 'review', 'record', 'open-settings']) expect(mayAccess(type, sender, id, options)).toBe(true);
  for (const type of ['snapshot', 'samples', 'save', 'plan', 'result', 'export', 'import', 'debug-state', 'debug-toggle', 'debug-export', 'debug-clear']) expect(mayAccess(type, sender, id, options)).toBe(false);
});
test('设置页可以调用可信接口，外部扩展和子框架被拒绝', () => {
  expect(mayAccess('export', { id, url: options }, id, options)).toBe(true);
  expect(mayAccess('rules', { id: 'other', url: options }, id, options)).toBe(false);
  expect(mayAccess('rules', { id, url: 'https://www.bilibili.com/', frameId: 1 }, id, options)).toBe(false);
  expect(mayAccess('rules', { id, url: 'https://www.bilibili.com.evil.invalid/', frameId: 0 }, id, options)).toBe(false);
});
