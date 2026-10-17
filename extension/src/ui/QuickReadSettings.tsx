// 编辑评论速读的自动触发、分析范围和模型选择。
import { Input } from './primitives/input';
import { Button } from './primitives/button';
import { Card } from './primitives/card';
import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from '../types';
import { ModelSelection } from './AIServiceSettings';
import styles from './App.module.css';

export function QuickReadSettings({ draft, setDraft, onServices }: {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>>; onServices: () => void;
}) {
  return <>
    <Card className={styles.card}><h2>自动速读</h2>
      <label className={styles.switch}><input type="checkbox" checked={draft.quickRead.auto} onChange={event => setDraft({ ...draft, quickRead: { ...draft.quickRead, auto: event.target.checked } })} />实际观看超过 5 分钟后自动速读</label>
    </Card>
    <Card className={styles.card}><h2>分析范围</h2><div className={styles.formGrid}>
      <label>最多分析评论数<Input type="number" min="1" max="10000" value={draft.quickRead.limit} onChange={event => setDraft({ ...draft, quickRead: { ...draft.quickRead, limit: Number(event.target.value) } })} /></label>
      <label>推荐评论数量<Input type="number" min="1" max="50" value={draft.quickRead.valuableCount} onChange={event => setDraft({ ...draft, quickRead: { ...draft.quickRead, valuableCount: Number(event.target.value) } })} /></label>
    </div></Card>
    <Card className={styles.card}>
      <div className={styles.sectionHeading}><h2>服务与模型</h2><Button className={styles.textButton} onClick={onServices}>管理 AI 服务</Button></div>
      <div className={styles.formGrid}><ModelSelection providers={draft.providers} providerId={draft.quickRead.providerId} model={draft.quickRead.model} onChange={change => setDraft({ ...draft, quickRead: { ...draft.quickRead, ...change } })} /></div>
    </Card>
  </>;
}
