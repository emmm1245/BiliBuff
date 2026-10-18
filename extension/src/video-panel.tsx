// 呈现分区阅读的视频助手、统一生成与取消入口，以及结构化结果的平滑完成状态。
import { createElement, createRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import css from './video-panel.css?inline';
import { activeSubtitle, clock, videoTimeline } from './video-data';
import type { ChapterPreview } from './analysis/schemas';
import type { ChapterDensity, MediaChoice, VideoCache, VideoSource, VideoTask } from './video-types';
import type { Theme } from './theme';
import { createIsolatedView } from './ui/mount';
import { Card } from './ui/primitives/card';
import { Button } from './ui/primitives/button';
import { Input } from './ui/primitives/input';
import { Icon } from './ui/Icon';
import { Markdown } from './ui/ai/Markdown';
import { VideoChat } from './ui/ai/VideoChat';
export interface VideoPanelState {
  source: VideoSource | null; cache: VideoCache | null; media: MediaChoice[]; busy: boolean; task: VideoTask | null;
  chaptersPreview?: ChapterPreview; chapterDensity?: ChapterDensity;
  status: string; error: string; preview: string; question: string; mediaLoading: boolean; mediaError: string;
}
export interface VideoPanelActions {
  read: (refresh?: boolean) => void; language: (id: string) => void;
  density: (value: ChapterDensity) => void;
  analyze: (task: VideoTask, question?: string) => void; cancel: () => void; seek: (seconds: number) => void;
  export: (format: 'text' | 'timed' | 'srt' | 'summary', copy: boolean) => void;
  media: () => void; download: (id: string) => void; clear: () => void; settings: () => void;
}

interface PanelHandle { playback: (seconds: number) => void; clearQuestion: () => void }
const tabs = { subtitles: '字幕', summary: '总结', chapters: '章节', chat: '问答', downloads: '下载' };
type Tab = keyof typeof tabs;
function Empty({ children }: { children: string }) { return <div className="empty"><Icon name="tv" /><p>{children}</p></div>; }
export function VideoPanel({ state, actions, ref }: { state: VideoPanelState; actions: VideoPanelActions; ref?: Ref<PanelHandle> }) {
  const { source, cache, busy, task, preview } = state;
  const [tab, setTab] = useState<Tab>('subtitles');
  const [search, setSearch] = useState('');
  const [question, setQuestion] = useState('');
  const [format, setFormat] = useState<'text' | 'timed' | 'srt'>('timed');
  const cues = useRef<(HTMLButtonElement | null)[]>([]), scroller = useRef<HTMLDivElement>(null), follow = useRef<HTMLInputElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const active = useRef(-1);
  useEffect(() => { setSearch(''); setQuestion(''); }, [source]);
  useEffect(() => { active.current = -1; }, [cache]);
  useEffect(() => { if (task) setTab(task); }, [task]);
  useImperativeHandle(ref, () => ({ clearQuestion: () => setQuestion(''), playback(seconds) {
    if (!cache) return;
    const next = activeSubtitle(cache.rows, seconds);
    if (next === active.current) return;
    cues.current[active.current]?.classList.remove('active'); active.current = next;
    const cue = cues.current[next];
    if (!cue) return;
    cue.classList.add('active');
    if (follow.current?.checked && !cue.hidden && !search && scroller.current) {
      const rect = cue.getBoundingClientRect(), bounds = scroller.current.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) scroller.current.scrollTop += rect.top - bounds.top - scroller.current.clientHeight / 3;
    }
  } }), [cache,search]);
  const timeline = videoTimeline(source, cache);
  const term = search.trim().toLocaleLowerCase();
  return <details className="shell" open><summary className="heading"><span className="brand-icon"><Icon name="tv" /></span><strong><span className="brand-name">BiliBuff</span><span className="brand-title">视频助手</span></strong><span className="assistant-badge">AI</span><span className="chevron" aria-hidden="true"><Icon name="chevronDown" size={16} /></span></summary>
    <div className="tabs" role="tablist" aria-label="BiliBuff视频助手">{(Object.keys(tabs) as Tab[]).map((name,index,all) => <Button key={name} role="tab" data-tab={name}
      id={`bb-video-tab-${name}`} aria-controls={`bb-video-pane-${name}`} ref={node => { tabButtons.current[index] = node; }} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
      onClick={() => setTab(name)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index+1)%all.length : event.key === 'ArrowLeft' ? (index+all.length-1)%all.length : event.key === 'Home' ? 0 : event.key === 'End' ? all.length-1 : -1;
        if (next >= 0) { event.preventDefault(); setTab(all[next]!); tabButtons.current[next]?.focus(); }
      }}>{tabs[name]}</Button>)}</div>
    <div className="feedback"><p className="status" role="status" aria-live="polite">{task ? '' : state.status}</p><p className="error" role="alert" hidden={!state.error}>{state.error}</p></div>
    <div className="body">
      <section id="bb-video-pane-subtitles" aria-labelledby="bb-video-tab-subtitles" className="pane" data-pane="subtitles" role="tabpanel" hidden={tab !== 'subtitles'}>
        <div className="toolbar"><select className="language" aria-label="字幕语言" disabled={busy || !!task || !source} value={cache?.language ?? ''} onChange={event => actions.language(event.target.value)}>{source?.tracks.map(track => <option key={track.id} value={track.id}>{track.name}{track.ai ? ' · AI字幕' : ''}</option>)}</select><Button className="read" disabled={busy || !!task} onClick={() => actions.read(true)}>刷新</Button></div>
        <Input className="search" type="search" placeholder="搜索字幕" aria-label="搜索字幕" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="actions"><span className="subtitle-count muted">{cache?.rows.filter(row => !term || row.text.toLocaleLowerCase().includes(term)).length ?? 0} 句</span><label className="follow"><input ref={follow} type="checkbox" defaultChecked />跟随播放</label></div>
        <div ref={scroller} className="subtitles scroll">{cache ? cache.rows.map((row,index) => <Button key={index} ref={node => { cues.current[index] = node; }} className="cue" hidden={!!term && !row.text.toLocaleLowerCase().includes(term)} onClick={() => actions.seek(row.start)}><time>{clock(row.start)}</time><span>{row.text}</span></Button>) : <Empty>{source?.subtitleError ? '字幕读取失败' : '暂无字幕'}</Empty>}</div>
        <div className="exports"><select className="format" aria-label="字幕导出格式" value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="timed">带时间戳</option><option value="text">纯文本</option><option value="srt">SRT 字幕</option></select><Button className="copy" disabled={!cache} onClick={() => actions.export(format,true)}>复制</Button><Button className="export" disabled={!cache} onClick={() => actions.export(format,false)}>导出</Button></div>
      </section>
      <section id="bb-video-pane-summary" aria-labelledby="bb-video-tab-summary" className="pane" data-pane="summary" role="tabpanel" hidden={tab !== 'summary'}><div className="pane-heading"><div><h3>视频总结</h3></div></div><div className="toolbar"><Button className={`generate-summary ${task === 'summary' ? 'cancel' : 'primary'}`} disabled={task !== 'summary' && (!cache || !!task)} onClick={() => task === 'summary' ? actions.cancel() : actions.analyze('summary')}>{task === 'summary' ? '取消生成' : cache?.summary ? '重新生成总结' : '生成总结'}</Button>{task !== 'summary' && <div className="secondary-actions"><Button className="copy-summary link" disabled={!cache?.summary} onClick={() => actions.export('summary',true)}>复制</Button><Button className="export-summary link" disabled={!cache?.summary} onClick={() => actions.export('summary',false)}>导出</Button></div>}</div>
        <Card key={task === 'summary' ? 'generating' : cache?.summary?.at ?? 'empty'} className={`content-card summary-result result${cache?.summary && task !== 'summary' ? ' bb-result-reveal' : ''}`}>{task === 'summary' ? <Markdown text={preview} streaming /> : cache?.summary ? <><Markdown text={cache.summary.value.summary} />{cache.summary.value.points.length > 0 && <ul>{cache.summary.value.points.map((text,index) => <li key={index}>{text}</li>)}</ul>}</> : <Empty>一份总结，快速掌握重点</Empty>}</Card>
      </section>
      <section id="bb-video-pane-chapters" aria-labelledby="bb-video-tab-chapters" className="pane" data-pane="chapters" role="tabpanel" hidden={tab !== 'chapters'}><div className="pane-heading"><div><h3>章节导航</h3><span className="muted">{source?.nativeChapters?.length ? '此为视频自带章节' : '按话题定位，按需选择分段密度'}</span></div>{!!timeline.length && <span className="count-badge">{timeline.length} 章</span>}</div><div className="toolbar" hidden={!!source?.nativeChapters?.length}>
          <Button className={`generate-chapters ${task === 'chapters' ? 'cancel' : 'primary'}`} disabled={task !== 'chapters' && (!cache || !!task)} onClick={() => task === 'chapters' ? actions.cancel() : actions.analyze('chapters')}>{task === 'chapters' ? '取消生成' : cache?.chapters ? '重新生成章节' : '生成章节'}</Button>
          {task !== 'chapters' && <select aria-label="章节密度" className="density" disabled={!!task} value={state.chapterDensity ?? 'balanced'} onChange={event => actions.density(event.target.value as ChapterDensity)}><option value="concise">精简</option><option value="balanced">适中</option><option value="detailed">详细</option></select>}
        </div>
        <Card key={task === 'chapters' ? 'generating' : cache?.chapters?.at ?? 'native'} className={`content-card chapter-result scroll${task !== 'chapters' && timeline.length ? ' bb-result-reveal' : ''}`}>{task === 'chapters' ? <div aria-busy="true"><small>章节生成中，完成校验后可跳转。</small>{state.chaptersPreview?.map((chapter,index) => chapter && (chapter.title || chapter.summary) && <div key={index} className="chapter">
          <div className="chapter-top"><strong>{chapter.title || '正在生成章节…'}</strong></div><Markdown text={chapter.summary || ''} streaming />
        </div>)}</div> : timeline.length ? timeline.map((chapter,index) => <div key={index} className={`chapter${chapter.ad ? ' ad' : ''}`}><div className="chapter-top"><Button className="link timestamp" onClick={() => actions.seek(chapter.start)}>{clock(chapter.start)}</Button><Button className="chapter-title" onClick={() => actions.seek(chapter.start)}>{chapter.title}</Button>{chapter.ad && <span className="ad-badge">疑似广告</span>}</div>{chapter.summary && <p>{chapter.summary}</p>}{chapter.ad && <Button className="skip" onClick={() => actions.seek(chapter.end)}>跳过至 {clock(chapter.end)}</Button>}</div>) : <Empty>用章节找到你想看的内容</Empty>}</Card>
      </section>
      <section id="bb-video-pane-chat" aria-labelledby="bb-video-tab-chat" className="pane" data-pane="chat" role="tabpanel" hidden={tab !== 'chat'}><VideoChat state={state} actions={actions} question={question} setQuestion={setQuestion} active={tab === 'chat'} /></section>
      <section id="bb-video-pane-downloads" aria-labelledby="bb-video-tab-downloads" className="pane" data-pane="downloads" role="tabpanel" hidden={tab !== 'downloads'}><p className="media-status" role="status">{state.mediaLoading ? '正在读取格式…' : state.mediaError || (!state.media.length ? '暂无下载格式' : '')}</p><div className="media-result">{state.media.map(item => <div className="media" key={item.id}><div><strong>{item.label}</strong>{item.size && <small>{(item.size/1024/1024).toFixed(1)} MB</small>}</div><Button disabled={busy} onClick={() => actions.download(item.id)}>下载</Button></div>)}</div><Button className="retry-media" hidden={!state.mediaError} disabled={state.mediaLoading} onClick={actions.media}>重试</Button></section>
    </div><div className="footer"><Button className="manage link" onClick={actions.settings}>AI 设置</Button><Button className="clear link" disabled={busy || !!task || !source} onClick={actions.clear}>清除缓存</Button></div>
  </details>;
}
export function createVideoPanel(actions: VideoPanelActions) {
  const view = createIsolatedView('bf-video-workbench',css), { host } = view;
  const ref = createRef<PanelHandle>();
  function mount() {
    host.hidden = !!document.fullscreenElement || !!document.querySelector('.bpx-player-container[data-screen="web"], .bpx-player-container.bpx-state-web');
    if (host.hidden) return;
    const sidebar = document.querySelector('.right-container-inner, .right-container');
    const parent = sidebar && sidebar.getBoundingClientRect().width >= 260 ? sidebar : document.body;
    host.dataset.floating = String(parent === document.body);
    if (host.parentElement !== parent) { if (parent === document.body) parent.append(host); else {
      const author = parent.querySelector('.up-panel-container'); if (author?.parentElement === parent) author.after(host); else parent.prepend(host);
    } }
    host.style.setProperty('--panel-height',`${Math.max(260,window.innerHeight-Math.max(16,host.getBoundingClientRect().top)-16)}px`);
  }
  return { host, render: (state: VideoPanelState) => view.render(createElement(VideoPanel,{ state, actions, ref })),
    playback: (seconds: number) => ref.current?.playback(seconds), clearQuestion: () => ref.current?.clearQuestion(),
    mount, theme: (theme: Theme) => { host.dataset.theme = theme; }, remove: view.remove };
}
