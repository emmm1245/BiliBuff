// 验证流式事件分段、中文解码、说明预览和中断时不接受半成品。
import { expect, test, vi } from 'vitest';
import { previewSummary, readAnalysisStream } from '../src/analysis-stream';
import { parseAnalysisResponse } from '../src/core';

function event(content: string, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\r\n\r\n`;
}
function response(text: string, byteSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += byteSize) controller.enqueue(bytes.slice(i, i + byteSize));
    controller.close();
  } }));
}

test('中文按单字节分块、换行和保活注释仍能正确解码，完整 JSON 前已有预览', async () => {
  const preview = vi.fn(); const thinking = vi.fn();
  const data = ': keep-alive\r\n\r\n' + event('{"summary":"中文') + event('分析","suggestions":[]}') + event('', 'stop') + 'data: [DONE]';
  const parsed = await readAnalysisStream(response(data), new AbortController().signal, preview, thinking);
  expect(preview.mock.calls.map(call => call[0])).toEqual(['中文', '中文分析']);
  expect(parseAnalysisResponse(parsed)).toEqual({ summary: '中文分析', suggestions: [] }); expect(thinking).not.toHaveBeenCalled();
});

test('转义字符预览为可读文字，不展示 JSON 标记', () => {
  expect(previewSummary('{"summary":"第一行\\n\\"引号\\"')).toBe('第一行\n"引号"');
  expect(previewSummary('{"summary":"\\u6570')).toBe('数');
  expect(previewSummary('{"summary":"\\u65')).toBe('');
  expect(previewSummary('{"kind":"result"')).toBe('');
});

test('思考只更新阶段，不展示思考内容，只有思考的结果拒绝保存', async () => {
  const thinking = vi.fn(); const preview = vi.fn();
  const data = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '内部思考内容' } }] }) + '\n\n' + event('', 'stop') + 'data: [DONE]\n\n';
  const parsed = await readAnalysisStream(response(data, 50), new AbortController().signal, preview, thinking);
  expect(thinking).toHaveBeenCalledTimes(1); expect(preview).not.toHaveBeenCalled();
  expect(() => parseAnalysisResponse(parsed)).toThrow('只返回了思考过程');
});

test('有结束原因但缺少结束标记的断流也不能接受', async () => {
  await expect(readAnalysisStream(response(event('{"summary":"半成品","suggestions":[]}', 'stop')), new AbortController().signal, () => {}, () => {})).rejects.toThrow('连接中断');
});

test.each(['length', null])('结束原因 %s 不正常时拒绝保存', async finish => {
  const parsed = await readAnalysisStream(response(event('{"summary":"结果","suggestions":[]}', finish) + 'data: [DONE]\n'), new AbortController().signal, () => {}, () => {});
  expect(() => parseAnalysisResponse(parsed)).toThrow(finish === 'length' ? '输出上限' : '未正常结束');
});

test('取消正在等待的流会释放读取器并拒绝结果', async () => {
  const cancel = vi.fn(); const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(event('{"summary":"正在生成'))); }, cancel });
  const preview = vi.fn(); const task = readAnalysisStream(new Response(body), controller.signal, preview, () => {});
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('正在生成'));
  controller.abort(); await expect(task).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
});

test('完整结果已到达但底层取消一直未完成时，仍及时返回结果并释放读取器', async () => {
  let finishCleanup!: () => void;
  const cancel = vi.fn(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
  const body = new ReadableStream<Uint8Array>({ start(stream) {
    stream.enqueue(new TextEncoder().encode(event('{"summary":"结果","suggestions":[]}', 'stop') + 'data: [DONE]\n\n'));
  }, cancel });
  let settled = false;
  const task = readAnalysisStream(new Response(body), new AbortController().signal, () => {}, () => {}).then(value => { settled = true; return value; });
  try {
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });
    expect(body.locked).toBe(false); expect(parseAnalysisResponse(await task).summary).toBe('结果');
  } finally { finishCleanup(); await task; }
});

test('用户取消时即使底层清理一直未完成，也立即拒绝结果并释放读取器', async () => {
  let finishCleanup!: () => void;
  const cancel = vi.fn(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
  const controller = new AbortController(); const preview = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(stream) {
    stream.enqueue(new TextEncoder().encode(event('{"summary":"生成中')));
  }, cancel });
  let settled = false;
  const task = readAnalysisStream(new Response(body), controller.signal, preview, () => {}).catch(error => { settled = true; return error; });
  try {
    await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('生成中')); controller.abort();
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });
    expect((await task).name).toBe('AbortError'); expect(body.locked).toBe(false);
  } finally { finishCleanup(); await task; }
});

test('接口返回错误事件和损坏事件都拒绝接受', async () => {
  for (const data of ['data: {"error":{"message":"failed"}}\n\n', 'data: invalid\n\n']) {
    await expect(readAnalysisStream(response(data), new AbortController().signal, () => {}, () => {})).rejects.toThrow();
  }
});
