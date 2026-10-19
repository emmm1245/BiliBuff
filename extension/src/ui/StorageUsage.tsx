// 在数据与维护页展示本地存储估算用量和权限状态。
import { Button } from './primitives/button';
import { Card } from './primitives/card';
import { useEffect, useState } from 'react';
import { formatStorageBytes, readStorageUsage, type StorageUsage as Usage } from '../storage-usage';
import styles from './App.module.css';

export function StorageUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [refreshId, setRefreshId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => setRefreshId(value => value + 1);
    setLoading(true); setError('');
    void readStorageUsage().then(value => { if (alive) setUsage(value); }, error => {
      if (alive) { setUsage(null); setError(error instanceof Error ? error.message : '存储用量读取失败，请重试。'); }
    }).finally(() => { if (alive) setLoading(false); });
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [refreshId]);

  return <Card className={styles.card} aria-busy={loading}><h2>本地存储</h2>
    {usage && <>
      <div className={`${styles.stats} ${styles.storageStats}`}>
        <div><small>估算合计</small><strong>{usage.databaseBytes === null ? '暂不可用' : formatStorageBytes(usage.localBytes + usage.databaseBytes)}</strong></div>
        <div><small>设置与缓存</small><strong>{formatStorageBytes(usage.localBytes)}</strong></div>
        <div><small>记录等占用（估算）</small><strong>{usage.databaseBytes === null ? '暂不可用' : formatStorageBytes(usage.databaseBytes)}</strong></div>
      </div>
      {!usage.unlimited && <p className={styles.banner}>存储权限尚未生效，请更新并重新加载扩展。</p>}
    </>}
    <p>用量为浏览器估算值，更新可能稍有延迟。</p>
    <div className={styles.row}><Button disabled={loading} onClick={() => setRefreshId(value => value + 1)}>{loading ? '正在读取…' : '刷新用量'}</Button></div>
    {error && <p role="alert">存储用量读取失败：{error}</p>}
  </Card>;
}
