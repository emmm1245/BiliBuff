// 在日常功能中独立配置AI推荐开关、共用计划及选片模型。
import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { send } from '../client';
import type { Settings } from '../types';
import type { BrowseOptions } from '../browse-types';
import { ModelSelection } from './AIServiceSettings';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Textarea } from './primitives/textarea';
import { Card } from './primitives/card';
import styles from './App.module.css';

export function BrowseSettings({ draft, setDraft, plan, onEditPlan, onServices }: {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>>; plan: string;
  onEditPlan: () => void; onServices: () => void;
}) {
  const options = draft.browse;
  const [clearing,setClearing] = useState(false), [status,setStatus] = useState('');
  const update = (change: Partial<BrowseOptions>) => setDraft({ ...draft, browse: { ...options,...change } });
  async function clearCache() {
    setClearing(true); setStatus('');
    try {
      await send({ type: 'browse-cache-clear' });
      setStatus('缓存已清空，返回首页可重新选片。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '清空失败，请稍后重试。'); }
    finally { setClearing(false); }
  }
  return <>
    <Card className={styles.card}>
      <label className={styles.switch}><input type="checkbox" role="switch" checked={options.enabled} onChange={event => update({ enabled: event.target.checked })} />开启 AI帮你刷</label>
      <p className={styles.notice}>融合B站推荐，为近期计划精选视频，开启后自动使用留白首页。</p>
      <div className={styles.planReference}><div><span>近期计划</span><p>{plan.trim() || '尚未填写'}</p></div><Button className={styles.textButton} onClick={onEditPlan}>{plan.trim() ? '编辑计划' : '填写计划'}</Button></div>
      <div className={styles.formGrid}><label>推荐范围补充（可选）<Textarea rows={3} maxLength={1000} value={options.scopeNote ?? ''} onChange={event => update({ scopeNote: event.target.value })} placeholder="可解释计划中的简称，或补充希望包含、排除的内容。" /></label></div>
    </Card>
    <Card className={styles.card}>
      <div className={styles.sectionHeading}><h2>选片模型</h2><Button className={styles.textButton} onClick={onServices}>管理 AI 服务</Button></div>
      <div className={styles.formGrid}><ModelSelection providers={draft.providers} providerId={options.providerId} model={options.model} onChange={update} /></div>
      <p className={styles.notice}>开启后，计划、偏好、赞踩、近期推荐标题和候选文字会发送给所选服务。赞踩仅用于本功能。</p>
      <details className={styles.settingsDetails}><summary>生成设置</summary><div className={styles.formGrid}>
        <label>输出上限（词元）<Input type="number" min="1024" max="393216" step="1" value={options.maxTokens} onChange={event => update({ maxTokens: Number(event.target.value) })} /></label>
        {options.providerId === 'deepseek' && <label>思考强度<select value={options.thinking ? options.effort : 'off'} onChange={event => update(event.target.value === 'off' ? { thinking: false } : { thinking: true, effort: event.target.value as BrowseOptions['effort'] })}>
          <option value="off">关</option><option value="low">低</option><option value="high">高</option><option value="max">最高</option>
        </select></label>}
      </div></details>
    </Card>
    <Card className={styles.card}>
      <h2>实验性功能</h2>
      <p className={styles.notice}>清除当前推荐、待推荐候选池、展示记录、搜索记忆和从计划提炼的选片理解，下次重新选片。旧视频可能再次出现。</p>
      <p className={styles.notice}>保留赞踩、日志、来源冷却时间、近期计划及所有配置。正在进行的选片会先停止。</p>
      <Button disabled={clearing} onClick={() => void clearCache()}>{clearing ? '正在清空…' : '清空缓存'}</Button>
      {status && <p role="status">{status}</p>}
    </Card>
  </>;
}
