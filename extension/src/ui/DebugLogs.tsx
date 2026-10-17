// 提供独立的调试日志开关、下载和清除操作，并显示本机记录数量。
import { Button } from './primitives/button';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEBUG_ENABLED_KEY } from '../ai-debug';
import { send } from '../client';
import styles from './App.module.css';

export function DebugLogs() {
  const [state, setState] = useState<{ enabled: boolean; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void send({ type: 'debug-state' }).then(value => {
        if (alive) setState(value);
      }, error => { if (alive) setStatus(error.message); });
    };
    const changed = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && DEBUG_ENABLED_KEY in changes) refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    browser.storage.onChanged.addListener(changed);
    const timer = window.setInterval(refresh, 3000);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); browser.storage.onChanged.removeListener(changed); };
  }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true); setStatus('');
    try { await work(); setState(await send({ type: 'debug-state' })); }
    catch (error) { setStatus(error instanceof Error ? error.message : '调试日志操作失败。'); }
    finally { setBusy(false); }
  }
  async function download() {
    const data = await send({ type: 'debug-export' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `bilibuff-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('调试日志已下载。');
  }
  return <details className={`${styles.card} ${styles.settingsDetails}`}><summary>调试日志</summary>
    <label className={styles.switch}><input type="checkbox" checked={state?.enabled ?? false} disabled={!state || busy}
      onChange={event => { const enabled = event.target.checked; void act(async () => { await send({ type: 'debug-toggle', enabled }); setStatus(enabled ? '调试日志已开启。' : '调试日志已关闭，已有日志保留。'); }); }} />开启调试日志</label>
    <p>记录 AI 请求、回复和错误，仅保存在本机，不含密钥。可能包含计划、观看记录和评论，分享前请检查。</p>
    <div className={styles.row}><span>{state ? `已记录 ${state.count} 条` : '正在读取日志…'}</span>
      <Button disabled={!state?.count || busy} onClick={() => void act(download)}>下载日志</Button>
      <Button disabled={!state || busy} onClick={() => void act(async () => { await send({ type: 'debug-clear' }); setStatus('调试日志已清除。'); })}>清除日志</Button>
    </div>{status && <p role="status">{status}</p>}
  </details>;
}
