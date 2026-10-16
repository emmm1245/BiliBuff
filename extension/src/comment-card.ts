// 在可拖动的速读悬浮窗中呈现分析、原页评论定位与无需密钥的文本导出入口。
import css from './comment-card.css?inline';
import { commentLink } from './comment-data';
import type { QuickReadResult } from './comment-types';
import type { Theme } from './theme';

export interface CommentCardState {
  status: string; error: string; collecting: boolean; paused: boolean; analyzing: boolean; preview: string; complete: boolean; loadingCache: boolean;
  total: number; expected: number; selected: number; result: QuickReadResult | null;
}
export function createCommentCard(actions: { collect: () => void; pause: () => void; analyze: () => void; cancel: () => void; copy: (all: boolean) => void; download: (all: boolean) => void; settings: () => void; jump: (id: string) => void }) {
  const host = document.createElement('div'); host.id = 'bf-comment-read';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><details><summary title="拖动标题栏移动，点击展开或收起"><span class="grip" aria-hidden="true">⠿</span><strong>评论区速读</strong><span class="badge">等待播放</span><span class="chevron" aria-hidden="true">⌄</span></summary>
    <div class="body"><p class="status muted" role="status" aria-live="polite"></p><p class="counts muted"></p><p class="error" role="alert" hidden></p>
      <div class="actions"><button class="analyze primary">开始速读</button><button class="collect">采集评论</button><button class="pause" hidden>暂停采集</button><button class="cancel" hidden>取消速读</button><button class="settings">设置</button></div>
      <div class="preview" hidden><h3>总览 · 生成中</h3><p></p></div><div class="result"></div><div class="export"><label>导出评论 <select aria-label="导出范围"><option value="selected">按分析上限筛选</option><option value="all">全部已采集评论</option></select></label>
      <div class="actions"><button class="copy">复制文本</button><button class="download">下载文本</button></div></div>
    </div></details>`;
  const el = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  const all = () => el<HTMLSelectElement>('select').value === 'all';
  el('.analyze').addEventListener('click', actions.analyze);
  el('.collect').addEventListener('click', actions.collect);
  el('.pause').addEventListener('click', actions.pause);
  el('.cancel').addEventListener('click', actions.cancel);
  el('.copy').addEventListener('click', () => actions.copy(all()));
  el('.download').addEventListener('click', () => actions.download(all()));
  el('.settings').addEventListener('click', actions.settings);
  function sourceLink(id: string, bvid: string, comment: QuickReadResult['sources'][number]) {
    const link = document.createElement('a'); link.href = commentLink(bvid,comment);
    link.addEventListener('click',event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); actions.jump(id);
    });
    return link;
  }
  const header = el<HTMLElement>('summary');
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null, ignoreClick = false;
  function place(left: number, top: number) {
    const rect = host.getBoundingClientRect();
    host.style.left = `${Math.max(16,Math.min(left,window.innerWidth-rect.width-16))}px`;
    host.style.top = `${Math.max(16,Math.min(top,window.innerHeight-rect.height-16))}px`;
    host.style.right = 'auto';
  }
  header.addEventListener('pointerdown',event => {
    if (event.button !== 0) return;
    ignoreClick = false;
    const rect = host.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener('pointermove',event => {
    if (!drag) return;
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)<5) return;
    drag.moved = true; place(drag.left+dx,drag.top+dy);
  });
  header.addEventListener('pointerup',() => { ignoreClick = drag?.moved === true; drag = null; });
  header.addEventListener('pointercancel',() => { drag = null; ignoreClick = false; });
  header.addEventListener('click',event => { if (ignoreClick && event.detail>0) event.preventDefault(); ignoreClick = false; });
  el('details').addEventListener('toggle',() => mount());
  let previous: QuickReadResult | null | undefined;
  function render(state: CommentCardState) {
    el('.status').textContent = state.status;
    el('.counts').textContent = state.total ? `已采集 ${state.total} 条${state.expected ? ` / 接口显示 ${state.expected} 条` : ''}，保留 ${state.selected} 条，过滤 ${state.total-state.selected} 条。` : state.result ? `缓存基于 ${state.result.selected} / ${state.result.total} 条评论；更新或导出前请点击“检查更新”。` : state.loadingCache ? '先读取本地速读缓存。' : '播放后开始采集；也可以手动采集，稍后复制或下载。';
    el<HTMLElement>('.error').hidden = !state.error; el('.error').textContent = state.error;
    el('.badge').textContent = state.analyzing ? (state.preview ? '生成中' : '整理中') : state.collecting ? `采集中 · ${state.total}` : state.paused ? '采集已暂停' : state.loadingCache ? '读取缓存' : state.error ? '需处理' : state.result ? (state.result.complete === false ? '部分速读' : '已完成') : state.complete ? '可速读 / 导出' : '待采集';
    el<HTMLButtonElement>('.analyze').disabled = !state.total || state.analyzing || state.collecting;
    el('.analyze').textContent = state.result ? '重新速读' : !state.complete ? '分析已采集' : '开始速读';
    el('.analyze').setAttribute('title',!state.total && state.result ? '先检查更新，采集本次评论后可重新速读' : '');
    el<HTMLButtonElement>('.collect').disabled = state.collecting || state.analyzing;
    el<HTMLElement>('.collect').hidden = state.collecting;
    el('.collect').textContent = state.paused ? '继续采集' : state.total || state.result ? '检查更新' : '采集评论';
    el('.collect').setAttribute('title',state.paused ? '从暂停处继续' : '保留已有评论，检查新增和变化；仍需核对分页');
    el<HTMLElement>('.pause').hidden = !state.collecting;
    el<HTMLElement>('.cancel').hidden = !state.analyzing;
    for (const selector of ['.copy','.download']) el<HTMLButtonElement>(selector).disabled = !state.total;
    el<HTMLElement>('.preview').hidden = !state.analyzing || !state.preview;
    el('.preview p').textContent = state.preview;
    el<HTMLElement>('.result').hidden = state.analyzing;
    if (previous === state.result) return;
    previous = state.result;
    const target = el('.result'); target.replaceChildren();
    if (!state.result) return;
    const result = state.result;
    const paragraph = (text: string, tag = 'p') => { const node = document.createElement(tag); node.textContent = text; target.append(node); return node; };
    paragraph(`基于 ${result.selected} / ${result.total} 条评论 · ${new Date(result.at).toLocaleString()}`, 'small');
    if (result.complete === false) paragraph(`部分采集结果：分析启动时已采集 ${result.total} 条${result.expected ? `，接口显示 ${result.expected} 条` : ''}；未覆盖完整评论区。`,'small');
    paragraph(result.summary);
    for (const topic of result.topics) {
      paragraph(topic.title, 'h3'); paragraph(topic.summary);
      topic.refs.forEach((id,index) => {
        const comment = result.sources.find(item => item.id === id);
        if (!comment) return;
        const link = sourceLink(id,result.bvid,comment); link.className = 'reference'; link.textContent = `原评论 ${index+1} →`;
        target.append(link);
      });
    }
    if (result.valuable.length) paragraph('可能值得一看', 'h3');
    for (const item of result.valuable) {
      const comment = result.sources.find(source => source.id === item.id);
      if (!comment) continue;
      const link = sourceLink(comment.id,result.bvid,comment); link.className = 'valuable';
      const excerpt = document.createElement('p'); excerpt.className = 'excerpt'; excerpt.textContent = comment.text;
      const reason = document.createElement('p'); reason.className = 'reason'; reason.textContent = item.reason;
      const source = document.createElement('small'); source.className = 'source'; source.textContent = `${comment.author || '评论者'} · ${comment.likes} 赞 · 定位原楼层 →`;
      link.append(reason,excerpt,source); target.append(link);
    }
    paragraph('基于筛选后的评论整理，观点不代表全区共识。点击来源可在当前页面定位原评论。','small');
  }
  function mount() {
    if (host.parentElement !== document.body) document.body.append(host);
    const rect = host.getBoundingClientRect();
    if (rect.left<16 || rect.top<16 || rect.right>window.innerWidth-16 || rect.bottom>window.innerHeight-16) place(rect.left,rect.top);
  }
  return { host, render, mount, theme: (theme: Theme) => { host.dataset.theme = theme; }, remove: () => host.remove() };
}
