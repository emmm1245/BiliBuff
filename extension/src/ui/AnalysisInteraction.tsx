// 展示计划分析的增量建议与澄清预览，以及完整问题的回答入口。
import { Button } from './primitives/button';
import { Textarea } from './primitives/textarea';
import { Card } from './primitives/card';
import { Markdown } from './ai/Markdown';
import { useState } from 'react';
import type { AnalysisFollowup, AnalysisTurn } from '../analysis';
import type { AnalysisPreview } from '../analysis/schemas';
import type { ClarificationAnswer } from '../types';
import styles from './App.module.css';

export function ClarificationHistory({ answers }: { answers: ClarificationAnswer[] }) {
  return answers.length ? <details className={styles.history}><summary>本次补充的信息（{answers.length} 轮）</summary>{answers.map((item, index) =>
    <p key={index}><strong>{item.question}</strong><br />{item.kind === 'skip' ? '已跳过，按已有信息分析' : `${item.kind === 'custom' ? '自定义' : '已选择'}：${item.answer}`}</p>)}</details> : null;
}

export function AnalysisInteraction({ pending, disabled, busy, onAnswer, onEnd }: {
  pending: Extract<AnalysisTurn, { kind: 'clarification' }>;
  disabled: boolean;
  busy: boolean;
  onAnswer: (followup: AnalysisFollowup) => void;
  onEnd: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [input, setInput] = useState('');
  const { question, session } = pending;
  function answer(kind: ClarificationAnswer['kind'], value = '') {
    onAnswer({ session, answer: { question: question.question, kind, answer: value } });
  }
  return <Card className={`${styles.card} bb-result-reveal`}>
    <h2>想再了解你一点</h2><Markdown text={question.summary} />
    <ClarificationHistory answers={session.clarifications} />
    <h3>{question.question}</h3>
    <div className={styles.choices}>{question.options.map(option => <Button key={option} disabled={disabled} onClick={() => answer('option', option)}>{option}</Button>)}
      <Button disabled={disabled} aria-expanded={custom} aria-controls="analysis-custom-answer" className={custom ? styles.primary : ''} onClick={() => setCustom(!custom)}>自定义</Button>
      <Button disabled={disabled} onClick={() => answer('skip')}>跳过，直接分析</Button>
    </div>
    {custom && <div id="analysis-custom-answer" className={styles.customAnswer}><label>你的想法<Textarea autoFocus rows={3} maxLength={1000} value={input} disabled={disabled} onChange={event => setInput(event.target.value)} placeholder="说说你的目标，或者更喜欢哪些内容。" /></label>
      <div className={styles.row}><small>{input.length}/1000 字；仅用于本次分析，不改写近期计划。</small><Button className={styles.primary} disabled={disabled || !input.trim()} onClick={() => answer('custom', input.trim())}>提交并继续</Button></div>
    </div>}
    <div className={styles.row}><Button disabled={busy} onClick={onEnd}>结束澄清并返回编辑</Button></div>
  </Card>;
}


export function AnalysisStreamingPreview({ value, summary }: { value: AnalysisPreview | null; summary: string }) {
  return <Card className={styles.card} aria-busy="true"><h2>正在生成分析</h2>
    <Markdown text={value?.summary || summary || '正在准备样本或等待模型输出……'} streaming />
    {value?.question && <h3>{value.question}</h3>}
    {value?.options?.length ? <div className={styles.choices}>{value.options.map((option,index) => option && <Button key={index} disabled>{option}</Button>)}</div> : null}
    <div className={styles.columns}>{(['positive', 'negative'] as const).flatMap(side => (['text', 'tags'] as const).map(field => {
      const items = value?.suggestions?.filter(item => item?.side === side && item.field === field && item.word) ?? [];
      return items.length ? <div key={`${side}:${field}`} className={styles[side]}><h3>{side === 'positive' ? '偏好内容' : '避开内容'} / {field === 'text' ? '标题词' : '视频标签'}</h3>
        {items.map((item,index) => item && <label className={styles.suggestion} key={index}><input type="checkbox" disabled /><span>
          <strong><span className={item.action === 'remove' ? styles.removeAction : styles.addAction}>{item.action === 'remove' ? '删除' : '新增'}</span> {item.word}</strong>
          {item.reason && <Markdown text={item.reason} streaming />}</span></label>)}
      </div> : null;
    }))}</div>
    <p className={styles.notice}>正在生成，完成校验后可操作。请保持设置页打开。</p>
  </Card>;
}
