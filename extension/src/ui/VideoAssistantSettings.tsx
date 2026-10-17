// 在日常功能中分别配置视频总结、章节、问答和自动行为。
import { Input } from './primitives/input';
import { Button } from './primitives/button';
import { Card } from './primitives/card';
import type { Dispatch, SetStateAction } from 'react';
import type { Settings } from '../types';
import type { VideoSelection, VideoTask } from '../video-types';
import { videoContext, videoEfforts, videoModel } from '../video-ai';
import { ModelSelection } from './AIServiceSettings';
import styles from './App.module.css';

export function VideoAssistantSettings({ draft, setDraft, onServices }: {
  draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>>; onServices: () => void;
}) {
  const options = draft.videoAssistant;
  function update(task: VideoTask, change: Partial<VideoSelection>, reset = false) {
    const selection = { ...options[task], ...change };
    if (reset) { selection.effort = videoEfforts(selection)[0]!; selection.maxTokens = Math.min(selection.maxTokens ?? 8192,videoModel(selection).output); selection.contextTokens = 0; }
    setDraft({ ...draft, videoAssistant: { ...options, [task]: selection } });
  }
  return <>
    <Card className={styles.card}><h2>常用功能</h2>
      {([['autoSummary','自动生成总结'],['autoChapters','自动生成章节'],['autoSkipAds','广告自动跳过']] as const).map(([key,label]) => <label key={key} className={styles.switch}>
        <input type="checkbox" checked={options[key]} onChange={event => setDraft({ ...draft, videoAssistant: { ...options, [key]: event.target.checked } })} />{label}
      </label>)}
    </Card>
    <Card className={styles.card}><h2>章节密度</h2>
      <div className={styles.choices} role="radiogroup" aria-label="默认章节密度">{([['concise','精简'],['balanced','适中'],['detailed','详细']] as const).map(([density,label]) =>
        <label key={density} className={styles.densityOption}><input type="radio" name="chapter-density" value={density} checked={options.chapterDensity === density}
          onChange={() => setDraft({ ...draft, videoAssistant: { ...options, chapterDensity: density } })} />{label}</label>)}</div>
      <p className={styles.notice}>数量范围只计算整段视频的内容章节，广告另算。</p>
      {([['concise','精简'],['balanced','适中'],['detailed','详细']] as const).map(([density,label]) => <div key={density} className={styles.settingsGroup}><h3>{label}</h3><div className={styles.formGrid}>
        {(['min','max'] as const).map(bound => <label key={bound}>{label}{bound === 'min' ? '下限' : '上限'}<Input type="number" min="1" step="1" value={options.chapterRanges[density][bound]}
          onChange={event => setDraft({ ...draft, videoAssistant: { ...options, chapterRanges: { ...options.chapterRanges, [density]: { ...options.chapterRanges[density], [bound]: Number(event.target.value) } } } })} /></label>)}
      </div></div>)}
    </Card>
    <div className={styles.sectionHeading}><h2>AI 配置</h2><Button className={styles.textButton} onClick={onServices}>管理 AI 服务</Button></div>
    {([['summary','视频总结'],['chapters','视频章节'],['chat','视频问答']] as const).map(([task,title]) => {
      const selection = options[task], names = { default: '服务默认', off: '关', low: '低', medium: '中', high: '高', max: '最高' };
      return <Card key={task} className={styles.card}><h2>{title}</h2><div className={styles.formGrid}>
        <ModelSelection providers={draft.providers} providerId={selection.providerId} model={selection.model} onChange={value => update(task,value,true)} />
        <label>思考强度<select value={selection.effort ?? videoEfforts(selection)[0]} onChange={event => update(task,{ effort: event.target.value as VideoSelection['effort'] })}>
          {videoEfforts(selection).map(effort => <option key={effort} value={effort}>{names[effort]}</option>)}
        </select></label>
        <label>输出上限（词元）<Input type="number" min="1024" max={videoModel(selection).output} step="1" value={selection.maxTokens ?? 8192} onChange={event => update(task,{ maxTokens: Number(event.target.value) })} /></label>
        <label>上下文容量（词元）<Input type="number" min="16000" max="4000000" step="1" value={selection.contextTokens || ''} placeholder={`自动 · ${videoContext({ ...selection, contextTokens: 0 }).toLocaleString()}`} onChange={event => update(task,{ contextTokens: Number(event.target.value) })} /></label>
      </div></Card>;
    })}
  </>;
}
