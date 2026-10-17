// 校验聊天流的完成标记并连接取消信号，具体事件与JSON解析交由AI SDK。
export class IncompleteAIStream extends Error {}
export function completedStream(response: Response, signal: AbortSignal) {
  if (!response.body) throw new IncompleteAIStream('模型连接中断，未收到响应正文。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let tail = '', ended = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  function release() {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  function abort() {
    if (ended) return;
    ended = true; output.error(signal.reason); release();
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) { output = controller; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (ended) return;
        if (chunk.done) throw new IncompleteAIStream('模型连接中断，未收到完整结束标记。');
        const text = tail + decoder.decode(chunk.value, { stream: true });
        controller.enqueue(chunk.value);
        if (/(?:^|\r?\n)data: *\[DONE\](?:\r?\n|$)/.test(text)) {
          ended = true; controller.close(); release();
        } else tail = text.slice(-32);
      } catch (error) {
        if (!ended) { ended = true; controller.error(error); release(); }
      }
    },
    cancel() { if (!ended) { ended = true; release(); } },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
