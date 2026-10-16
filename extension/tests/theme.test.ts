// 验证旧主题迁移、设置页同步、读取竞争及卸载后的清理。
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { THEME_KEY, parseTheme } from '../src/theme';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), add: vi.fn(), remove: vi.fn(), effects: [] as Array<() => void | (() => void)> }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: mocks.get, set: mocks.set }, onChanged: { addListener: mocks.add, removeListener: mocks.remove } } } }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));
import { initializeTheme, ThemePicker } from '../src/ui/ThemePicker';

let cache: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.effects.length = 0;
  cache = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) });
  vi.stubGlobal('document', { documentElement: { dataset: { theme: 'system' } } });
  mocks.set.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });
function mount() { initializeTheme(); ThemePicker(); return mocks.effects[0]!(); }

test('缺少扩展主题时迁移旧选择，非法缓存回到系统主题', async () => {
  cache.set(THEME_KEY, 'dark');
  mocks.get.mockResolvedValue({});
  mount();
  await vi.waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ [THEME_KEY]: 'dark' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(parseTheme('other')).toBe('system');
  expect(parseTheme(undefined)).toBe('system');
});

test('已有扩展主题优先于旧缓存，其他设置页变更同步到缓存与页面', async () => {
  cache.set(THEME_KEY, 'light');
  mocks.get.mockResolvedValue({ [THEME_KEY]: 'dark' });
  mount();
  await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  const changed = mocks.add.mock.calls[0]![0];
  changed({ [THEME_KEY]: { newValue: 'system' } }, 'local');
  expect(document.documentElement.dataset.theme).toBe('system');
  expect(cache.get(THEME_KEY)).toBe('system');
  expect(mocks.set).not.toHaveBeenCalled();
});

test('主题事件先于初始读取返回时，不被旧读取覆盖', async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount();
  mocks.add.mock.calls[0]![0]({ [THEME_KEY]: { newValue: 'dark' } }, 'local');
  finish({ [THEME_KEY]: 'light' });
  await Promise.resolve();
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(mocks.set).not.toHaveBeenCalled();
});

test('卸载后解除监听，等待中的读取不再迁移或更新页面', async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const cleanup = mount();
  if (typeof cleanup === 'function') cleanup();
  finish({});
  await Promise.resolve();
  expect(mocks.remove).toHaveBeenCalledWith(mocks.add.mock.calls[0]![0]);
  expect(mocks.set).not.toHaveBeenCalled();
});
