// 管理设置页的计划分析会话、预览、取消和建议选择，与草稿保存独立。
import { useRef, useState } from 'react';
import { analyze, type AnalysisFollowup, type AnalysisTurn } from '../analysis';
import { send } from '../client';
import type { Settings, Snapshot } from '../types';
import type { AnalysisPreview } from './schemas';
import { errorMessage } from '../settings/errors';
interface AnalysisContext { draft: Settings | null; waitForPlan: () => Promise<unknown>; refresh: () => Promise<Snapshot>; setStatus: (value: string) => void }
export function useAnalysisSession() {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [pendingAnalysis, setPendingAnalysis] = useState<Extract<AnalysisTurn, { kind: 'clarification' }> | null>(null);
  const [structuredPreview, setStructuredPreview] = useState<AnalysisPreview | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState('');
  const [analysisCleared, setAnalysisCleared] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef(false); pendingRef.current = Boolean(pendingAnalysis);
  async function runAnalysis(context: AnalysisContext, followup?: AnalysisFollowup) {
    const { draft, waitForPlan, refresh, setStatus } = context;
    if (!draft || busyRef.current) return;
    const controller = new AbortController(); abort.current = controller; busyRef.current = true; setBusy(true); setSelected([]); setAnalysisPreview(''); setStructuredPreview(null);
    setAnalysisCleared(true); setStatus('正在准备分析……');
    try {
      await waitForPlan();
      const latest = await refresh();
      const turn = await analyze(latest.preferences, structuredClone(draft), controller.signal, setStatus, setAnalysisPreview, followup, setStructuredPreview);
      controller.signal.throwIfAborted();
      if (turn.kind === 'clarification') {
        setPendingAnalysis(turn); setStatus('请选择选项、自定义回答或跳过；本次尚未保存新建议。');
      } else {
        await send({ type: 'result', result: turn.result });
        setPendingAnalysis(null); await refresh(); setAnalysisCleared(false); setStatus('分析好了，选中想采用的建议就可以加入规则。');
      }
    } catch (error) {
      setStatus(controller.signal.aborted ? '已取消分析。' : error instanceof Error && error.name === 'TimeoutError' ? '模型请求超时。' : errorMessage(error));
    } finally { setStructuredPreview(null); busyRef.current = false; setBusy(false); abort.current = null; }
  }

  function reset() { setStructuredPreview(null); setPendingAnalysis(null); setAnalysisPreview(''); setSelected([]); }
  return { busy, busyRef, pendingRef, pendingAnalysis, setPendingAnalysis, structuredPreview, analysisPreview, setAnalysisPreview,
    analysisCleared, setAnalysisCleared, selected, setSelected, abort, runAnalysis, reset };
}
