// 用隔离React界面呈现可拖动评论速读、采集状态、原评论来源与文本导出。
import { createElement, memo, useRef, useState } from 'react';
import css from './comment-card.css?inline';
import { Icon } from './ui/Icon';
import { commentLink } from './comment-data';
import type { QuickReadPreview } from './analysis/schemas';
import type { QuickReadResult } from './comment-types';
import type { Theme } from './theme';
import { createIsolatedView } from './ui/mount';
import { Button } from './ui/primitives/button';
import { Markdown } from './ui/ai/Markdown';
export interface CommentCardState {
  status: string; error: string; collecting: boolean; paused: boolean; analyzing: boolean; preview: string; complete: boolean; loadingCache: boolean;
  partial?: QuickReadPreview;
  total: number; expected: number; selected: number; result: QuickReadResult | null;
  useVideoSummary: boolean; contextSaving?: boolean;
}

export interface CommentCardActions { collect: () => void; pause: () => void; analyze: () => void; cancel: () => void; copy: (all: boolean) => void; download: (all: boolean) => void; settings: () => void; jump: (id: string) => void; context: (enabled: boolean) => void }
const CommentResult = memo(function CommentResult({ result, jump }: { result: QuickReadResult; jump: (id: string) => void }) {
  const click = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); jump(id);
  };
  return <div className="bb-result-reveal"><small>基于 {result.selected} / {result.total} 条评论 · {new Date(result.at).toLocaleString()}</small>
    {result.complete === false && <small>部分采集结果：分析启动时已采集 {result.total} 条{result.expected ? `，接口显示 ${result.expected} 条` : ''}；未覆盖完整评论区。</small>}
    <Markdown text={result.summary} />{result.topics.map((topic,index) => <div key={index}><h3>{topic.title}</h3><Markdown text={topic.summary} />{topic.refs.map((id,i) => {
      const comment = result.sources.find(item => item.id === id);
      return comment && <a key={id} href={commentLink(result.bvid,comment)} className="reference" onClick={event => click(event,id)}>原评论 {i+1} <Icon name="arrowRight" size={12} /></a>;
    })}</div>)}
    {result.valuable.length > 0 && <h3>可能值得一看</h3>}{result.valuable.map(item => {
      const comment = result.sources.find(source => source.id === item.id);
      return comment && <a key={item.id} href={commentLink(result.bvid,comment)} className="valuable" onClick={event => click(event,item.id)}><p className="reason">{item.reason}</p><p className="excerpt">{comment.text}</p><small className="source">{comment.author || '评论者'} · {comment.likes} 赞 · 定位原楼层 <Icon name="arrowRight" size={12} /></small></a>;
    })}<small>基于筛选后的评论整理，观点不代表全区共识。点击来源可在当前页面定位原评论。</small></div>;
});
export function CommentCard({ state, actions, position, place, mount }: { state: CommentCardState; actions: CommentCardActions; position: () => DOMRect; place: (left: number, top: number) => void; mount: () => void }) {
  const [all, setAll] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null), ignoreClick = useRef(false);
  const counts = state.total ? `已采集 ${state.total} 条${state.expected ? ` / 接口显示 ${state.expected} 条` : ''}，保留 ${state.selected} 条，过滤 ${state.total-state.selected} 条。` : state.result ? `缓存基于 ${state.result.selected} / ${state.result.total} 条评论；更新或导出前请点击“检查更新”。` : state.loadingCache ? '先读取本地速读缓存。' : '播放后开始采集；也可以手动采集，稍后复制或下载。';
  const badge = state.analyzing ? (state.preview ? '生成中' : '整理中') : state.collecting ? `采集中 · ${state.total}` : state.paused ? '采集已暂停' : state.loadingCache ? '读取缓存' : state.error ? '需处理' : state.result ? (state.result.complete === false ? '部分速读' : '已完成') : state.complete ? '可速读 / 导出' : '待采集';
  return <details onToggle={mount}><summary title="拖动标题栏移动，点击展开或收起" onPointerDown={event => {
    if (event.button !== 0) return;
    ignoreClick.current = false;
    const rect = position(); drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const current = drag.current; if (!current) return;
    const dx = event.clientX-current.x, dy = event.clientY-current.y;
    if (!current.moved && Math.hypot(dx,dy)<5) return;
    current.moved = true; place(current.left+dx,current.top+dy);
  }} onPointerUp={() => { ignoreClick.current = drag.current?.moved === true; drag.current = null; }} onPointerCancel={() => { drag.current = null; ignoreClick.current = false; }} onClick={event => { if (ignoreClick.current && event.detail>0) event.preventDefault(); ignoreClick.current = false; }}>
    <span className="grip" aria-hidden="true"><Icon name="grip" size={16} /></span><strong>评论区速读</strong><span className="badge">{badge}</span><span className="chevron" aria-hidden="true"><Icon name="chevronDown" size={16} /></span></summary>
    <div className="body"><p className="status muted" role="status" aria-live="polite">{state.status}</p><p className="counts muted">{counts}</p><p className="error" role="alert" hidden={!state.error}>{state.error}</p>
      <label className="summary-context"><input type="checkbox" checked={state.useVideoSummary} disabled={state.analyzing || state.contextSaving} onChange={event => actions.context(event.target.checked)} />加入已有视频总结作为背景</label>
      <small>没有可用总结时该选项不生效。</small>
      <div className="actions"><Button className="analyze primary" disabled={!state.analyzing && (!state.total || state.collecting)} title={!state.total && state.result ? '先检查更新，采集本次评论后可重新速读' : ''} onClick={state.analyzing ? actions.cancel : actions.analyze}>{state.analyzing ? '取消速读' : state.result ? '重新速读' : !state.complete ? '分析已采集' : '开始速读'}</Button><Button className="collect" disabled={state.collecting || state.analyzing} hidden={state.collecting || state.analyzing} title={state.paused ? '从暂停处继续' : '保留已有评论，检查新增和变化；仍需核对分页'} onClick={actions.collect}>{state.paused ? '继续采集' : state.total || state.result ? '检查更新' : '采集评论'}</Button><Button className="pause" hidden={!state.collecting} onClick={actions.pause}>暂停采集</Button><Button className="settings" hidden={state.analyzing} onClick={actions.settings}>设置</Button></div>
      <div className="preview" hidden={!state.analyzing || (!state.preview && !state.partial)} aria-busy={state.analyzing}><h3>速读 · 生成中</h3><Markdown text={state.partial?.summary || state.preview} streaming />
        {state.partial?.topics?.map((topic,index) => topic && (topic.title || topic.summary) && <div key={index}><h3>{topic.title}</h3><Markdown text={topic.summary || ''} streaming /></div>)}
        {!!state.partial?.valuable?.length && <h3>可能值得一看</h3>}{state.partial?.valuable?.map((item,index) => item?.reason && <div key={index} className="valuable"><Markdown text={item.reason} streaming /></div>)}
        <small>正在生成，完成校验后可查看原评论。</small>
      </div><div className="result" hidden={state.analyzing}>{state.result && <CommentResult key={state.result.at} result={state.result} jump={actions.jump} />}</div>
      <div className="export" hidden={state.analyzing}><label>导出评论 <select aria-label="导出范围" value={all ? 'all' : 'selected'} onChange={event => setAll(event.target.value === 'all')}><option value="selected">按分析上限筛选</option><option value="all">全部已采集评论</option></select></label><div className="actions"><Button className="copy" disabled={!state.total} onClick={() => actions.copy(all)}>复制文本</Button><Button className="download" disabled={!state.total} onClick={() => actions.download(all)}>下载文本</Button></div></div>
    </div></details>;
}
export function createCommentCard(actions: CommentCardActions) {
  const view = createIsolatedView('bf-comment-read',css), { host } = view;
  let dragged = false;
  function clamp(left: number, top: number) {
    const rect = host.getBoundingClientRect();
    host.style.left = `${Math.max(16,Math.min(left,window.innerWidth-rect.width-16))}px`;
    host.style.top = `${Math.max(16,Math.min(top,window.innerHeight-rect.height-16))}px`; host.style.right = 'auto';
  }
  function place(left: number, top: number) {
    dragged = true; host.style.position = 'fixed'; clamp(left,top);
  }
  function mount() {
    if (host.parentElement !== document.body) document.body.append(host);
    if (!dragged) {
      const title = document.querySelector('.video-info-container h1, h1.video-title, .video-info-title, .video h1');
      if (title) {
        const bounds = title.getBoundingClientRect(), assistant = document.getElementById('bf-video-workbench');
        const edge = assistant && !assistant.hidden ? Math.min(bounds.right,assistant.getBoundingClientRect().left-12) : bounds.right;
        host.style.position = 'fixed';
        // 以页面初始布局定位，滚动到原评论后仍保持悬浮可见。
        clamp(edge-host.getBoundingClientRect().width+window.scrollX,bounds.bottom+8+window.scrollY);
        return;
      }
      host.style.position = 'fixed'; host.style.left = 'auto'; host.style.right = '16px'; host.style.top = '88px';
    }
    const rect = host.getBoundingClientRect();
    if (rect.left<16 || rect.top<16 || rect.right>window.innerWidth-16 || rect.bottom>window.innerHeight-16) clamp(rect.left,rect.top);
  }
  return { host, render: (state: CommentCardState) => view.render(createElement(CommentCard,{ state, actions, position: () => host.getBoundingClientRect(), place, mount })),
    mount, theme: (theme: Theme) => { host.dataset.theme = theme; }, remove: view.remove };
}
