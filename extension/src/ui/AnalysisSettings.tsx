// 在计划分析页集中编辑模型、生成参数、计划字数和样本门槛。
import type { Dispatch, SetStateAction } from 'react';
import type { AIOptions, Settings } from '../types';
import { ModelSelection } from './AIServiceSettings';
import styles from './App.module.css';

export function AnalysisSettings({ draft, setDraft, onServices }: {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>>; onServices: () => void;
}) {
  const updateAI = (change: Partial<AIOptions>) => setDraft({ ...draft, ai: { ...draft.ai,
    ...(change.providerId && change.providerId !== (draft.ai.providerId ?? 'deepseek') && change.providerId !== 'deepseek' ? { maxTokens: 4096 } : {}), ...change } });
  return <details className={`${styles.card} ${styles.settingsDetails}`} id="analysis-settings">
    <summary>分析设置</summary>
    <div className={styles.sectionHeading}><h3>服务与模型</h3><button className={styles.textButton} onClick={onServices}>管理 AI 服务</button></div>
    <div className={styles.formGrid}><ModelSelection providers={draft.providers} providerId={draft.ai.providerId} model={draft.ai.model} onChange={updateAI} /></div>
    <div className={styles.settingsGroup}><h3>计划与样本</h3><div className={styles.formGrid}>
      <label>计划字数上限<input type="number" min="1" max="6000" step="1" value={draft.planMaxLength} onChange={event => setDraft({ ...draft, planMaxLength: Number(event.target.value) })} /></label>
      {(['minWatched', 'minBlocked'] as const).map(field => <label key={field}>{field === 'minWatched' ? '观看样本门槛' : '屏蔽样本数量'}<input type="number" min="1" max={field === 'minBlocked' ? 1000 : 100} step="1" value={draft[field]} onChange={event => setDraft({ ...draft, [field]: Number(event.target.value) })} /></label>)}
    </div></div>
    <div className={styles.settingsGroup}><h3>生成参数</h3><div className={styles.formGrid}>
      <label>输出上限（词元）<input type="number" min="1024" max="393216" step="1" value={draft.ai.maxTokens} onChange={event => updateAI({ maxTokens: Number(event.target.value) })} /></label>
      {(draft.ai.providerId ?? 'deepseek') === 'deepseek' && <>
        <label>思考模式<select value={draft.ai.thinking ? 'on' : 'off'} onChange={event => updateAI({ thinking: event.target.value === 'on' })}><option value="off">关闭</option><option value="on">开启</option></select></label>
        <label>思考强度<select disabled={!draft.ai.thinking} value={draft.ai.effort} onChange={event => updateAI({ effort: event.target.value as AIOptions['effort'] })}><option value="low">低</option><option value="high">高</option><option value="max">最高</option></select></label>
      </>}
    </div></div>
  </details>;
}
