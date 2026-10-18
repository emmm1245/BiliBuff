// 为模型调用关联日常诊断与按需保存的原始输入输出，日志失败不影响业务。
export { DEBUG_ENABLED_KEY, debugEnabled, setDebugEnabled, debugState, allDebugLogs, clearDebugLogs } from './platform/ai-logs';
export type { AIDebugFeature, AIDebugLog } from './platform/ai-logs';
import { debugEnabled, beginLog, finishLog, type AIDebugFeature, type AIDebugLog } from './platform/ai-logs';
import { beginOperation, failureSummary, hasOperation, safeLogText, traceForSignal } from './platform/diagnostics';
import { removeDebugLog } from './platform/ai-logs';

function loggingError(error: unknown) { console.warn('调试日志未能保存：', error); }

export async function traceAIWork<T>(feature: AIDebugFeature, details: Pick<AIDebugLog, 'service' | 'url' | 'input'>,
  signal: AbortSignal, work: (capture: (response: Response, input?: Record<string, unknown>) => Promise<Response>, recordInput: (input: Record<string, unknown>) => Promise<void>) => Promise<T>): Promise<T> {
  const started = Date.now();
  const operation = await beginOperation(feature, '正在调用模型', traceForSignal(signal));
  await operation.step('模型请求', 'debug', { service: safeLogText(details.service, 100), endpoint: safeLogText(details.url, 200),
    model: typeof details.input.model === 'string' ? safeLogText(details.input.model, 100) : '服务默认模型' });
  let log: AIDebugLog | undefined;
  try {
    if (await debugEnabled()) {
      log = { ...details, id: operation.id, operationId: operation.id, feature, startedAt: new Date(started).toISOString(), output: '', status: 'pending' };
      await beginLog(log);
      if (!await hasOperation(operation.id)) { await removeDebugLog(log.id); log = undefined; }
      if (log) await operation.rawLog(log.id);
    }
  } catch (error) { log = undefined; loggingError(error); }
  const chunks: string[] = [];
  let capturedLength = 0;
  const decoder = new TextDecoder();
  let lastSaved = started;
  let httpStatus = 0;
  async function capture(response: Response, input?: Record<string, unknown>) {
    httpStatus = response.status;
    if (log) {
      log.httpStatus = response.status;
      if (input) log.input = input;
      if (response.body) {
        const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          async transform(chunk, controller) {
            const text = decoder.decode(chunk, { stream: true });
            const available = 256 * 1024 - capturedLength;
            if (available > 0) { chunks.push(text.slice(0, available)); capturedLength += Math.min(text.length, available); }
            if (log && text.length > available) log.truncated = true;
            controller.enqueue(chunk);
            if (log && Date.now() - lastSaved >= 1000) {
              lastSaved = Date.now();
              await finishLog({ ...log, output: chunks.join(''), durationMs: lastSaved - started }).catch(loggingError);
            }
          },
        }));
        response = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      if (!response.ok) {
        const output = await response.text();
        response = new Response(output, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    }
    return response;
  }
  try {
    const result = await work(capture, async input => { if (log) { log.input = input; await finishLog(log).catch(loggingError); } });
    if (log) { log.status = httpStatus >= 400 ? 'error' : 'success'; if (httpStatus >= 400) log.error = `HTTP ${httpStatus}`; }
    await operation.step('模型请求结束', 'debug', { httpStatus });
    await operation.finish(httpStatus >= 400 ? 'error' : 'success', httpStatus >= 400 ? `模型请求失败（${httpStatus}）` : '模型输出已通过业务校验', log?.id);
    return result;
  } catch (error) {
    const cancelled = signal.aborted && signal.reason?.name !== 'TimeoutError';
    await operation.step(signal.aborted ? cancelled ? '用户或业务取消了请求' : '模型请求超时' : failureSummary(error), cancelled ? 'info' : 'error', { httpStatus });
    await operation.finish(cancelled ? 'cancelled' : 'error', cancelled ? '模型调用已取消' : signal.aborted ? '模型调用超时' : '模型调用失败', log?.id);
    if (log) {
      log.status = signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'cancelled' : 'error';
      log.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    throw error;
  } finally {
    if (log) {
      log.output = chunks.join('') + decoder.decode();
      log.durationMs = Date.now() - started;
      await finishLog(log).catch(loggingError);
    }
  }
}

export function traceAIRequest<T>(feature: AIDebugFeature, details: Pick<AIDebugLog, 'service' | 'url' | 'input'>,
  signal: AbortSignal, request: () => Promise<Response>, consume: (response: Response) => Promise<T>) {
  return traceAIWork(feature, details, signal, async capture => consume(await capture(await request())));
}
