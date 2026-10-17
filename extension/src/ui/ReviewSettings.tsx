// 在内容过滤页编辑 AI 复核，并连接共用的近期计划和服务管理。
import { Input } from './primitives/input';
import { Button } from './primitives/button';
import { Card } from './primitives/card';
import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from '../types';
import { KeyInput, ModelSelection } from './AIServiceSettings';
import styles from './App.module.css';

export function ReviewSettings({ draft, setDraft, plan, decisionKeyInput, setDecisionKeyInput, onEditPlan, onServices }: {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>>; plan: string;
  decisionKeyInput: string; setDecisionKeyInput: (value: string) => void;
  onEditPlan: () => void; onServices: () => void;
}) {
  return <Card className={styles.card}><h2>AI 复核</h2>
    <label className={styles.switch}><input type="checkbox" checked={draft.review.enabled} onChange={event => setDraft({ ...draft, review: { ...draft.review, enabled: event.target.checked } })} />遮住偏好视频中明显偏离计划的内容</label>
    <div className={styles.planReference}><div><span>近期计划</span><p>{plan.trim() || '尚未填写'}</p></div><Button className={styles.textButton} onClick={onEditPlan}>{plan.trim() ? '编辑计划' : '填写计划'}</Button></div>
    <details className={styles.settingsDetails}><summary>复核设置</summary>
      <div className={styles.formGrid}><label>复核模式<select value={draft.review.mode} onChange={event => setDraft({ ...draft, review: { ...draft.review, mode: event.target.value as Settings['review']['mode'] } })}><option value="general">通用模式</option><option value="decision">阿里云决策模式（实验性）</option></select></label></div>
      {draft.review.mode === 'general' ? <div className={styles.settingsGroup}>
        <div className={styles.sectionHeading}><h3>服务与模型</h3><Button className={styles.textButton} onClick={onServices}>管理 AI 服务</Button></div>
        <div className={styles.formGrid}><ModelSelection providers={draft.providers} providerId={draft.review.providerId} model={draft.review.model ?? 'deepseek-flash'} onChange={change => setDraft({ ...draft, review: { ...draft.review, ...change } })} /></div>
      </div> : <>
        <label className={styles.switch}>阿里云北京业务空间标识<Input value={draft.review.workspaceId} onChange={event => setDraft({ ...draft, review: { ...draft.review, workspaceId: event.target.value.trim() } })} placeholder="复制业务空间管理中的空间标识" /></label>
        <KeyInput label="阿里云密钥" value={decisionKeyInput} onChange={setDecisionKeyInput} placeholder="填写该业务空间可用的百炼密钥" />
        <p className={styles.notice}>密钥仅保存在本机，未加密；清空即可删除。</p>
      </>}
    </details>
  </Card>;
}
