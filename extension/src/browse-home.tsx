// 在留白首页展示精选视频与赞踩，恢复缓存并跟踪后台选片进度。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { RefreshCw, Settings2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { send } from './client';
import type { BrowseState } from './browse-types';

interface Actions { refresh: () => void; cancel: () => void; settings: () => void; vote: (bvid: string, vote: 1 | -1 | 0) => void }
const loadingMessages = ['正在为你挑选视频…', '正在片海里捞点好东西…', '给你的兴趣雷达充个电…', '翻翻收藏级好片，马上回来…', '让好内容和你碰个面…'];
function duration(seconds: number) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds/60), rest = String(seconds%60).padStart(2,'0');
  return minutes >= 60 ? `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${rest}` : `${minutes}:${rest}`;
}
function videoURL(video: BrowseState['items'][number]) {
  return `https://www.bilibili.com/video/${video.bvid}${video.entry ? `?p=${video.entry.page}` : ''}`;
}
function publishedDate(seconds: number) {
  if (!seconds) return '';
  const date = new Date(seconds*1000);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function BrowseHomeView({ state, actions, voting = '' }: { state: BrowseState; actions: Actions; voting?: string }) {
  const [loadingIndex,setLoadingIndex] = useState(0);
  useEffect(() => {
    if (!state.busy) { setLoadingIndex(0); return; }
    const timer = window.setInterval(() => setLoadingIndex(index => (index+1)%loadingMessages.length),4000);
    return () => clearInterval(timer);
  },[state.busy]);
  return <section className="browse" aria-label="AI帮你刷" aria-busy={state.busy}>
    <div className="browse-heading"><h2>AI帮你刷</h2><div className="browse-tools">
      <button type="button" disabled={!state.ready && !state.busy} onClick={state.busy ? actions.cancel : actions.refresh}><RefreshCw className={state.busy ? 'browse-spinning' : undefined} size={15} aria-hidden="true" />{state.busy ? '取消' : state.items.length ? '换一批' : '开始选片'}</button>
      <button type="button" onClick={actions.settings} aria-label="AI帮你刷设置" title="AI帮你刷设置"><Settings2 size={17} aria-hidden="true" /></button>
    </div></div>
    {state.busy && <p className="browse-status" role="status">{loadingMessages[loadingIndex]}</p>}
    {state.error && <p className="browse-error" role="status">{state.error}</p>}
    {!state.busy && !state.error && !state.items.length && <p className="browse-status">准备好后，来找点感兴趣的。</p>}
    <div className="browse-grid">{state.items.map(video => <article className={`browse-card${video.vote === -1 ? ' browse-disliked' : ''}`} key={video.bvid}>
      <a className="browse-cover" href={videoURL(video)} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        {video.cover && <img src={video.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        {video.duration > 0 && <span>{duration(video.entry?.duration || video.duration)}</span>}
      </a>
      <a className="browse-title" href={videoURL(video)} target="_blank" rel="noopener noreferrer" title={video.title}>{video.title}{video.entry && ` · P${video.entry.page} ${video.entry.title}`}</a>
      <div className="browse-footer"><div className="browse-meta">
        <span className="browse-author" title={video.author}>{video.author}</span>
        {video.published > 0 && <time className="browse-date" dateTime={publishedDate(video.published)} title="发布日期">{publishedDate(video.published)}</time>}
      </div>
        <div className="browse-votes">{([1,-1] as const).map(vote => {
          const Thumb = vote === 1 ? ThumbsUp : ThumbsDown, label = vote === 1 ? '喜欢' : '不喜欢';
          return <button key={vote} type="button" className={vote === 1 ? 'browse-like' : 'browse-dislike'} aria-label={`${label}：${video.title}`} title={video.vote === vote ? `取消${label}` : label}
            aria-pressed={video.vote === vote} disabled={voting === video.bvid} onClick={() => actions.vote(video.bvid,video.vote === vote ? 0 : vote)}><Thumb size={16} aria-hidden="true" /></button>;
        })}</div>
      </div>
    </article>)}</div>
  </section>;
}
const initial: BrowseState = { items: [], busy: false, ready: false, error: '', status: '正在读取推荐…', updatedAt: 0 };
function BrowseHome() {
  const [state,setState] = useState(initial), [voting,setVoting] = useState('');
  const alive = useRef(true), request = useRef(0), autoAttempted = useRef(false);
  function report(error: unknown) { if (alive.current) setState(previous => ({ ...previous, busy: false, error: error instanceof Error ? error.message : '暂时无法读取推荐。' })); }
  async function read() {
    const epoch = ++request.current;
    try { const next = await send({ type: 'browse-state' }); if (alive.current && epoch === request.current) setState(next); }
    catch (error) { if (epoch === request.current) report(error); }
  }
  async function refresh() {
    autoAttempted.current = true;
    const epoch = ++request.current;
    setState(previous => ({ ...previous, busy: true, status: '正在为你挑选视频…', error: '' }));
    try { const next = await send({ type: 'browse-refresh' }); if (alive.current && epoch === request.current) setState(next); }
    catch (error) { if (epoch === request.current) report(error); }
  }
  useEffect(() => {
    alive.current = true;
    void read();
    const changed = (message: { type?: string }) => { if (message.type === 'rules-changed') { autoAttempted.current = false; void read(); } };
    browser.runtime.onMessage.addListener(changed);
    const focused = () => { void read(); };
    window.addEventListener('focus',focused);
    return () => { alive.current = false; request.current++; browser.runtime.onMessage.removeListener(changed); window.removeEventListener('focus',focused); };
  },[]);
  useEffect(() => {
    if (!state.busy) return;
    const timer = window.setInterval(() => { void read(); },2000);
    return () => clearInterval(timer);
  },[state.busy]);
  useEffect(() => {
    if (!autoAttempted.current && state.ready && !state.busy && !state.error && (!state.updatedAt || Date.now()-state.updatedAt > 12*3600000)) void refresh();
  },[state]);
  const actions: Actions = {
    refresh: () => { void refresh(); },
    cancel: () => { void send({ type: 'browse-cancel' }).then(read).catch(report); },
    settings: () => { void send({ type: 'open-settings', section: 'browse' }).catch(report); },
    vote: async (bvid,vote) => {
      setVoting(bvid); request.current++;
      try { const next = await send({ type: 'browse-feedback', bvid,vote }); if (alive.current) { request.current++; setState(next); } }
      catch (error) { report(error); }
      finally { if (alive.current) setVoting(''); }
    },
  };
  return <BrowseHomeView state={state} actions={actions} voting={voting} />;
}
export function mountBrowseHome(container: HTMLElement) {
  const root = createRoot(container); root.render(<BrowseHome />);
  return () => root.unmount();
}
