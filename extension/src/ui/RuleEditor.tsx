// 优先编辑内容词条，再设置筛选方式、匹配规则和广告遮挡。
import type { Dispatch, SetStateAction } from 'react';
import { parseWords } from '../core';
import type { Settings, Side, WordField } from '../types';
import styles from './App.module.css';

export type Inputs = Record<`${Side}:${WordField}`, string>;
export const emptyInputs: Inputs = { 'positive:text': '', 'positive:tags': '', 'negative:text': '', 'negative:tags': '' };
export function collectInputs(draft: Settings, inputs: Inputs) {
  const settings = structuredClone(draft);
  for (const side of ['positive', 'negative'] as const) for (const field of ['text', 'tags'] as const) {
    settings[side][field] = [...new Set([...settings[side][field], ...parseWords(inputs[`${side}:${field}`])])];
  }
  return settings;
}
interface Props {
  draft: Settings;
  setDraft: Dispatch<SetStateAction<Settings | null>>;
  inputs: Inputs;
  setInputs: Dispatch<SetStateAction<Inputs>>;
  undo: { side: Side; field: WordField; word: string; index: number } | null;
  setUndo: Dispatch<SetStateAction<Props['undo']>>;
}
export function RuleEditor({ draft, setDraft, inputs, setInputs, undo, setUndo }: Props) {
  function add(side: Side, field: WordField) {
    const key = `${side}:${field}` as const;
    const words = parseWords(inputs[key]);
    if (!words.length) return;
    setDraft(previous => previous && { ...previous, [side]: { ...previous[side], [field]: [...new Set([...previous[side][field], ...words])] } });
    setInputs(previous => ({ ...previous, [key]: '' }));
  }
  function remove(side: Side, field: WordField, index: number, word: string) {
    setUndo({ side, field, index, word });
    setDraft(previous => previous && { ...previous, [side]: { ...previous[side], [field]: previous[side][field].filter((_, i) => i !== index) } });
  }
  return <>
    <div className={styles.columns}>
      {(['positive', 'negative'] as const).map(side => <section key={side} className={`${styles.card} ${styles[side]}`}>
        <div className={styles.cardTitle}><h2>{side === 'positive' ? '想多看' : '想少看'}</h2><span className={styles.count}>{draft[side].text.length + draft[side].tags.length} 个词条</span></div>
        <p>{side === 'positive' ? '高亮匹配的视频' : '遮住匹配的视频'}</p>
        {(['text', 'tags'] as const).map(field => {
          const key = `${side}:${field}` as const;
          return <div key={field} className={styles.words}>
            <h3>{field === 'text' ? '标题词' : '视频标签'}</h3>
            <div className={styles.chips}>{draft[side][field].length ? draft[side][field].map((word, index) => <button type="button" key={word} className={styles.chip} aria-label={`删除词条 ${word}`} onClick={() => remove(side, field, index, word)}>{word} ×</button>) : <small>尚未添加词条</small>}</div>
            <textarea aria-label={`${side === 'positive' ? '偏好' : '避开'}${field === 'text' ? '标题词' : '视频标签'}`} value={inputs[key]} placeholder={side === 'positive' ? field === 'text' ? '比如：数学，编程，摄影' : '比如：知识，科学科普' : field === 'text' ? '比如：抽奖，剧透' : '比如：娱乐八卦'} onChange={event => setInputs({ ...inputs, [key]: event.target.value })} onBlur={() => add(side, field)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); add(side, field); } }} />
            <div className={styles.row}><button type="button" onClick={() => add(side, field)}>添加</button></div>
          </div>;
        })}
        <label className={styles.switch}><input type="checkbox" checked={draft[side].textTags} onChange={event => setDraft({ ...draft, [side]: { ...draft[side], textTags: event.target.checked } })} />标题词也匹配视频标签</label>
      </section>)}
    </div>
    <p className={styles.notice}>多个词条用逗号分隔，回车或离开输入框即可添加。</p>
    {undo && <button type="button" className={styles.undoAction} onClick={() => {
      const { side, field, word, index } = undo;
      setDraft(previous => {
        if (!previous || previous[side][field].includes(word)) return previous;
        const words = [...previous[side][field]]; words.splice(index, 0, word);
        return { ...previous, [side]: { ...previous[side], [field]: words } };
      });
      setUndo(null);
    }}>撤销删除「{undo.word}」</button>}
    <section className={styles.card}><h2>筛选方式</h2>
      <label className={styles.switch}><input type="checkbox" checked={draft.strict} onChange={event => setDraft({ ...draft, strict: event.target.checked })} />只显示匹配“想多看”的视频</label>
      <label className={styles.switch}><input type="checkbox" checked={draft.positiveWins} onChange={event => setDraft({ ...draft, positiveWins: event.target.checked })} />同时匹配时，优先保留“想多看”的内容</label>
      <label className={styles.switch}>视频标签匹配方式<select value={draft.exactTags ? 'exact' : 'includes'} onChange={event => setDraft({ ...draft, exactTags: event.target.value === 'exact' })}><option value="includes">包含词条即可</option><option value="exact">与词条完全一致</option></select></label>
    </section>
    <section className={styles.card}><h2>广告与遮罩</h2>
      <label className={styles.switch}><input type="checkbox" checked={draft.blockAds} onChange={event => setDraft({ ...draft, blockAds: event.target.checked })} />遮住首页和视频页的广告推广</label>
      <label className={styles.switch}><input type="checkbox" checked={draft.showMaskReasons} onChange={event => setDraft({ ...draft, showMaskReasons: event.target.checked })} />显示遮罩原因</label>
    </section>
  </>;
}
