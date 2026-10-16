// 展示分析澄清问题，让模型选项、自定义和跳过并列供用户选择。
import { useState } from 'react';
import type { AnalysisFollowup, AnalysisTurn } from '../analysis';
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
  return <section className={styles.card}>
    <h2>想再了解你一点</h2><p className={styles.summary}>{question.summary}</p>
    <ClarificationHistory answers={session.clarifications} />
    <h3>{question.question}</h3>
    <div className={styles.choices}>{question.options.map(option => <button key={option} disabled={disabled} onClick={() => answer('option', option)}>{option}</button>)}
      <button disabled={disabled} aria-expanded={custom} aria-controls="analysis-custom-answer" className={custom ? styles.primary : ''} onClick={() => setCustom(!custom)}>自定义</button>
      <button disabled={disabled} onClick={() => answer('skip')}>跳过，直接分析</button>
    </div>
    {custom && <div id="analysis-custom-answer" className={styles.customAnswer}><label>你的想法<textarea autoFocus rows={3} maxLength={1000} value={input} disabled={disabled} onChange={event => setInput(event.target.value)} placeholder="说说你的目标，或者更喜欢哪些内容。" /></label>
      <div className={styles.row}><small>{input.length}/1000 字；仅用于本次分析，不改写近期计划。</small><button className={styles.primary} disabled={disabled || !input.trim()} onClick={() => answer('custom', input.trim())}>提交并继续</button></div>
    </div>}
    <div className={styles.row}><button disabled={busy} onClick={onEnd}>结束澄清并返回编辑</button></div>
  </section>;
}
