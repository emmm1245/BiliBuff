// 验证媒体下载重新取地址、来源规则精确匹配，以及错误页面不会被保存成视频。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rules: vi.fn(), download: vi.fn(), search: vi.fn(), media: vi.fn(), saved: {} as Record<string,unknown>, changed: vi.fn() }));
vi.mock('wxt/browser',() => ({ browser: {
  declarativeNetRequest: { updateSessionRules: mocks.rules },
  downloads: { download: mocks.download, search: mocks.search, onChanged: { addListener: mocks.changed } },
  storage: { session: { get: async (key: string) => ({ [key]: mocks.saved[key] }), set: async (value: Record<string,unknown>) => { Object.assign(mocks.saved,value); }, remove: async (key: string) => { delete mocks.saved[key]; } } },
} }));
vi.mock('../src/video-api',() => ({ confirmedPart: async () => ({ data: { title: '课程/二' }, part: { page: 2 } }), videoMedia: mocks.media }));
import { downloadVideo, registerVideoDownloads } from '../src/video-download';
beforeEach(() => {
  vi.clearAllMocks(); mocks.rules.mockResolvedValue(undefined); mocks.download.mockResolvedValue(4); mocks.search.mockResolvedValue([{ state: 'in_progress' }]);
  mocks.media.mockResolvedValue([{ id: 'mp4', url: 'https://cdn.bilivideo.com/video.mp4?sig=a.b', kind: 'video', combined: true, extension: 'mp4', quality: 64 }]);
});
afterEach(() => vi.unstubAllGlobals());
test('只对当前文件设置临时来源，验证后交给浏览器并明确文件名', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response('x',{ status: 206, headers: { 'Content-Type': 'video/mp4' } })));
  expect(await downloadVideo('BVtest',2,'mp4')).toBe(4);
  expect(mocks.media).toHaveBeenCalledWith('BVtest',2);
  const rule = mocks.rules.mock.calls[0]![0].addRules[0];
  expect(new RegExp(rule.condition.regexFilter).test('https://cdn.bilivideo.com/video.mp4?sig=a.b')).toBe(true);
  expect(new RegExp(rule.condition.regexFilter).test('https://cdn.bilivideo.com/other.mp4')).toBe(false);
  expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ saveAs: true, filename: '课程_二-P2-视频-64.mp4' }));
  registerVideoDownloads(); const listener = mocks.changed.mock.calls[0]![0]; listener({ id: 4, state: { current: 'complete' } });
  await vi.waitFor(() => expect(mocks.rules).toHaveBeenCalledWith({ removeRuleIds: [rule.id] }));
});
test('过期或HTML响应不会启动下载，失败时删除临时规则', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response('<html>错误</html>',{ headers: { 'Content-Type': 'text/html' } })));
  await expect(downloadVideo('BVtest',2,'mp4')).rejects.toThrow('错误页面');
  expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.rules.mock.calls.at(-1)![0]).toHaveProperty('removeRuleIds');
});
test('不允许网页传任意地址冒充媒体选项', async () => {
  await expect(downloadVideo('BVtest',2,'https://evil.invalid')).rejects.toThrow('格式已变化'); expect(mocks.download).not.toHaveBeenCalled();
});
