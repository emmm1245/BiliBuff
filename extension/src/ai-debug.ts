// 连接AI执行与原始网络日志，日志持久化和开关由平台存储模块管理。
export { DEBUG_ENABLED_KEY, debugEnabled, setDebugEnabled, debugState, allDebugLogs, clearDebugLogs } from './platform/ai-logs';
export type { AIDebugFeature, AIDebugLog } from './platform/ai-logs';
import { debugEnabled, beginLog, finishLog, type AIDebugFeature, type AIDebugLog } from './platform/ai-logs';

function loggingError(error: unknown) { console.warn('调试日志未能保存：', error); }

export async function traceAIWork<T>(feature: AIDebugFeature, details: Pick<AIDebugLog, 'service' | 'url' | 'input'>,
  signal: AbortSignal, work: (capture: (response: Response, input?: Record<string, unknown>) => Promise<Response>, recordInput: (input: Record<string, unknown>) => Promise<void>) => Promise<T>): Promise<T> {
  const started = Date.now();
  let log: AIDebugLog | undefined;
  try {
    if (await debugEnabled()) {
      log = { ...details, id: crypto.randomUUID(), feature, startedAt: new Date(started).toISOString(), output: '', status: 'pending' };
      await beginLog(log);
    }
  } catch (error) { log = undefined; loggingError(error); }
  const chunks: string[] = [];
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
            chunks.push(decoder.decode(chunk, { stream: true })); controller.enqueue(chunk);
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
    return result;
  } catch (error) {
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
