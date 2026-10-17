// 管理备份选择、导出与导入确认，复用现有密钥和记录合并语义。
import { useState } from 'react';
import { send } from '../client';
import type { Backup, Snapshot } from '../types';
import { errorMessage } from './errors';
interface BackupContext { busy: boolean; waitForPlan: () => Promise<unknown>; load: (value: Snapshot) => void; setStatus: (value: string) => void; setSaving: (value: boolean) => void }
export function useBackup({ busy, waitForPlan, load, setStatus, setSaving }: BackupContext) {
  const [includeKey, setIncludeKey] = useState(false);
  const [imported, setImported] = useState<Backup | null>(null);
  async function exportData() {
    try {
      await waitForPlan();
      const backup = await send({ type: 'export', includeKey });
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `bilibuff-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000); setStatus('备份已导出。');
    } catch (error) { setStatus(errorMessage(error)); }
  }
  async function importData() {
    if (!imported || busy || !confirm('导入会替换规则、计划和上次建议，合并累计记录，并丢弃本页草稿。确认导入？')) return;
    setSaving(true);
    try { await waitForPlan(); await send({ type: 'import', backup: imported }); load(await send({ type: 'snapshot' })); setImported(null); setStatus('导入完成，累计记录已合并。'); }
    catch (error) { setStatus(errorMessage(error)); } finally { setSaving(false); }
  }
  return { includeKey, setIncludeKey, imported, setImported, exportData, importData };
}
