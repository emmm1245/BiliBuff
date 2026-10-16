// 解码模型的流式事件，逐步预览中文说明并拒绝未完整结束的输出。
export function previewSummary(content: string): string {
  const value = content.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)/)?.[1];
  if (value === undefined) return '';
  try { return JSON.parse(`"${value}"`) as string; } catch { return ''; }
}

export async function readAnalysisStream(response: Response, signal: AbortSignal, preview: (text: string) => void, thinking: () => void) {
  if (!response.body) throw new Error('模型没有返回可读取的流式结果。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', finish: string | null = null, hasReasoning = false, done = false;
  let lastPreview = '';
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });

  function line(value: string) {
    if (!value.startsWith('data:')) return;
    const data = value.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    const chunk = JSON.parse(data) as { error?: unknown; choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }[] };
    if (chunk.error) throw new Error('模型流式请求失败，未保存建议。');
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.delta?.reasoning_content && !hasReasoning) { hasReasoning = true; thinking(); }
    if (typeof choice.delta?.content === 'string') {
      content += choice.delta.content;
      const text = previewSummary(content);
      if (text && text !== lastPreview) { lastPreview = text; preview(text); }
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }

  try {
    while (!done) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while (!done && (end = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
      }
      if (chunk.done) { if (!done && buffer.trim()) line(buffer.replace(/\r$/, '')); break; }
    }
    if (!done) throw new Error('模型连接中断，结果未完整接收，未保存建议。');
    return { choices: [{ finish_reason: finish, message: { content, reasoning_content: hasReasoning ? 'thinking' : '' } }] };
  } finally {
    signal.removeEventListener('abort', cancel);
    // 结束标记已决定结果；底层网络清理不能阻塞返回或取消反馈。
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
