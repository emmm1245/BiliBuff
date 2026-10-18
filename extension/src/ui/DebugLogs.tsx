// 阅读和筛选本机操作日志，按需查看模型正文并导出诊断。
import { Button } from './primitives/button';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AIDebugLog } from '../ai-debug';
import { operationFamily, type OperationLog } from '../platform/diagnostics';
import type { MessageResults } from '../platform/messages';
import { send } from '../client';
import styles from './App.module.css';
import logs from './DebugLogs.module.css';

const levels = { error: '错误', warn: '警告', info: '信息', debug: '调试' };
const statuses = { pending: '进行中或已中断', success: '完成', error: '失败', cancelled: '已取消' };
const time = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false });
export function logText(data: MessageResults['debug-export']) {
  const lines = [`BiliBuff ${data.environment.extensionVersion} · ${data.exportedAt}`, data.environment.browser, ''];
  for (const log of [...data.operations].sort((a,b) => a.at-b.at)) {
    lines.push(`${time(log.at)} [${levels[log.level]}] ${log.feature} · ${statuses[log.status]} · ${log.message}`,
      `编号：${log.id}${log.parentId ? ` · 所属操作：${log.parentId}` : ''}${log.durationMs !== undefined ? ` · 耗时：${log.durationMs}毫秒` : ''}`);
    for (const step of log.steps) lines.push(`  ${time(step.at)} [${levels[step.level]}] ${step.message}${step.details ? ` ${JSON.stringify(step.details)}` : ''}`);
    if (log.droppedSteps) lines.push(`  已省略较早的${log.droppedSteps}条步骤。`);
    lines.push('');
  }
  lines.push(`模型原始记录：${data.logs.length}条；B站请求：${data.biliNetwork.logs.length}条；选片轮次：${data.browseRounds.length}条。`,
    '本文件仅含诊断摘要；原始模型正文及请求明细请使用结构化导出。');
  return lines.join('\n');
}
function Operation({ log, children, onExport }: { log: OperationLog; children?: ReactNode; onExport: (id: string) => void }) {
  const [raw, setRaw] = useState<AIDebugLog | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  async function readRaw() {
    setLoading(true); setStatus('');
    try {
      const value = await send({ type: 'debug-detail', id: log.rawLogId! });
      setRaw(value); if (!value) setStatus('原始记录已清除或超过保留期限。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '读取失败。'); }
    finally { setLoading(false); }
  }
  return <details className={logs.operation}>
    <summary><span className={logs.meta}><time dateTime={new Date(log.at).toISOString()}>{time(log.at)}</time>
      <span data-level={log.level}>{levels[log.level]}</span><span>{log.feature}</span><span>{statuses[log.status]}</span>
      {log.durationMs !== undefined && <span>{(log.durationMs / 1000).toFixed(1)}秒</span>}</span><strong>{log.message}</strong></summary>
    <div className={logs.body}>
      <p className={styles.notice}>操作编号：{log.id}</p>
      {log.steps.length > 0 && <ol className={logs.steps}>{log.steps.map((step,index) => <li key={index}>
        <span className={logs.meta}>{time(step.at)} · {levels[step.level]}</span><span>{step.message}</span>
        {step.details && <pre>{JSON.stringify(step.details, null, 2)}</pre>}
      </li>)}</ol>}
      {!!log.droppedSteps && <p className={styles.notice}>较早的{log.droppedSteps}条步骤已省略，请求明细可查看结构化导出。</p>}
      <div className={styles.row}><Button onClick={() => onExport(log.id)}>导出这次操作</Button>
        {log.rawLogId && <Button disabled={loading} onClick={() => void readRaw()}>查看原始模型记录</Button>}</div>
      {status && <p role="status">{status}</p>}
      {raw && <details className={logs.raw}><summary>原始模型记录（可能含个人内容）</summary>
        {raw.truncated && <p>内容超过保存上限，已截断；模型实际接收和生成的内容不受影响。</p>}
        <p>状态：{statuses[raw.status]} · 服务：{raw.service}</p>
        <h4>请求输入</h4><pre>{JSON.stringify(raw.input, null, 2)}</pre>
        <h4>原始输出</h4><pre>{raw.output || '尚无输出'}</pre>{raw.error && <pre>{raw.error}</pre>}
      </details>}{children}
    </div>
  </details>;
}

export function DebugLogs() {
  const [state, setState] = useState<MessageResults['debug-state'] | null>(null);
  const [items, setItems] = useState<OperationLog[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [feature, setFeature] = useState(''), [level, setLevel] = useState(''), [query, setQuery] = useState('');
  const [range, setRange] = useState('7'), [page, setPage] = useState(0);
  const refresh = useCallback(async () => {
    const [next, list] = await Promise.all([send({ type: 'debug-state' }), send({ type: 'debug-list' })]);
    setState(next); setItems(list);
  }, []);
  useEffect(() => {
    if (!open || busy) return;
    let alive = true;
    const read = () => {
      if (document.hidden) return;
      void Promise.all([send({ type: 'debug-state' }), send({ type: 'debug-list' })]).then(([next, list]) => {
        if (alive) { setState(next); setItems(list); }
      }, error => { if (alive) setStatus(error.message); });
    };
    read(); window.addEventListener('focus', read);
    const timer = window.setInterval(read, 5000);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', read); };
  }, [open, busy]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await work(); await refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : '调试日志操作失败。'); }
    finally { setBusy(false); }
  }
  async function download(format: 'json' | 'txt', operationId?: string) {
    const data = await send({ type: 'debug-export', operationId });
    const url = URL.createObjectURL(new Blob([format === 'json' ? JSON.stringify(data, null, 2) : logText(data)], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `bilibuff-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('调试日志已下载。');
  }
  const ids = new Set(items.map(item => item.id));
  const roots = items.filter(item => !item.parentId || !ids.has(item.parentId));
  const filtered = roots.filter(root => Date.now() - root.at <= Number(range) * 86400000 &&
    operationFamily(items, root.id).some(item => (!feature || item.feature === feature) && (!level || item.level === level || item.steps.some(step => step.level === level)) &&
      (!query.trim() || `${item.feature} ${item.message} ${item.id} ${item.steps.map(step => step.message).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages - 1);
  function renderOperation(log: OperationLog): ReactNode {
    return <Operation key={log.id} log={log} onExport={id => { void act(() => download('json', id)); }}>
      {items.filter(child => child.parentId === log.id).sort((a,b) => a.at-b.at).map(renderOperation)}
    </Operation>;
  }
  return <details className={`${styles.card} ${styles.settingsDetails}`} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}><summary>日志与诊断</summary>
    <p>日常诊断默认记录关键操作结果，仅保存在本机。展开操作可查看步骤、模型调用和错误。</p>
    <label className={styles.switch}><input type="checkbox" checked={state?.enabled ?? false} disabled={!state || busy}
      onChange={event => { const enabled = event.target.checked; void act(async () => { await send({ type: 'debug-toggle', enabled }); setStatus(enabled ? '详细模型调试已开启。' : '详细模型调试已关闭，已有日志保留。'); }); }} />记录完整模型输入与输出</label>
    <p>记录 AI 请求、回复和错误，仅保存在本机，不含密钥。可能包含计划、观看记录和评论，分享前请检查。</p>
    <p className={styles.notice}>诊断摘要保留7天，最多500条、约2MB；原始模型记录保留3天，最多50条、10MB，输入与输出各最多约26万字符。进行中状态也可能代表后台已中断。</p>
    <div className={styles.row}><span>{state ? `诊断 ${state.operations} 条 · 模型原始记录 ${state.count} 条` : '正在读取日志…'}</span>
      <Button disabled={!state || busy} onClick={() => void act(() => download('json'))}>导出完整日志</Button>
      <Button disabled={!state || busy} onClick={() => void act(() => download('txt'))}>导出易读摘要</Button>
      <Button disabled={busy} onClick={() => void act(refresh)}>刷新</Button>
      <Button disabled={!state || busy} onClick={() => void act(async () => { await send({ type: 'debug-clear' }); setPage(0); setStatus('日志已清除，业务缓存和有效冷却保留。'); })}>清除日志</Button>
    </div>
    <div className={logs.filters}>
      <label>功能<select value={feature} onChange={event => { setFeature(event.target.value); setPage(0); }}><option value="">全部功能</option>{[...new Set(items.map(item => item.feature))].sort().map(name => <option key={name}>{name}</option>)}</select></label>
      <label>级别<select value={level} onChange={event => { setLevel(event.target.value); setPage(0); }}><option value="">全部级别</option>{Object.entries(levels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>时间<select value={range} onChange={event => { setRange(event.target.value); setPage(0); }}><option value="1">最近24小时</option><option value="7">最近7天</option></select></label>
      <label>搜索<input value={query} placeholder="功能、步骤或操作编号" onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    </div>
    {status && <p role="status">{status}</p>}
    <div aria-live="polite">{filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(renderOperation)}</div>
    {!filtered.length && <p className={styles.empty}>{items.length ? '没有符合条件的日志。' : '暂无诊断记录，执行功能后会在这里显示。'}</p>}
    <div className={styles.row}><span>共{filtered.length}次操作 · 第{currentPage + 1}/{pages}页</span>
      <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button>
      <Button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>
  </details>;
}
