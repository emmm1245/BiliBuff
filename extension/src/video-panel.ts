// 用隔离样式的B站原生卡片呈现字幕、总结、章节、视频问答和媒体下载。
import css from './video-panel.css?inline';
import { activeSubtitle, clock } from './video-data';
import type { AIProvider } from './types';
import type { MediaChoice, VideoCache, VideoSelection, VideoSource, VideoTask } from './video-types';
import type { Theme } from './theme';
import { videoContext, videoEfforts, videoModel } from './video-ai';

export interface VideoPanelState {
  source: VideoSource | null; cache: VideoCache | null; media: MediaChoice[]; busy: boolean; task: VideoTask | null;
  status: string; error: string; preview: string; selection: VideoSelection; providers: AIProvider[];
}
export interface VideoPanelActions {
  read: (refresh?: boolean) => void; language: (id: string) => void;
  analyze: (task: VideoTask, question?: string) => void; cancel: () => void; seek: (seconds: number) => void;
  export: (format: 'text' | 'timed' | 'srt' | 'summary', copy: boolean) => void;
  media: () => void; download: (id: string) => void; clear: () => void; settings: () => void;
  selection: (selection: VideoSelection) => void;
}
const icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" stroke-width="1.7"/><path d="m8 2 3 3m5-3-3 3M8 11v3m8-3v3m-6 3h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
export function createVideoPanel(actions: VideoPanelActions) {
  const host = document.createElement('div'); host.id = 'bf-video-workbench'; host.dataset.theme = 'system';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><details class="shell" open><summary class="heading"><span class="brand-icon">${icon}</span><strong><span class="brand-name">BiliBuff</span><span class="brand-title">视频助手</span></strong><span class="chevron">⌄</span></summary>
    <div class="tabs" role="tablist" aria-label="BiliBuff视频助手"><button role="tab" data-tab="subtitles" aria-selected="true">字幕</button><button role="tab" data-tab="summary" aria-selected="false">总结</button><button role="tab" data-tab="chapters" aria-selected="false">章节</button><button role="tab" data-tab="chat" aria-selected="false">问答</button><button role="tab" data-tab="downloads" aria-selected="false">下载</button></div>
    <div class="context"><span class="video-title"></span><span class="duration"></span></div>
    <div class="feedback"><p class="status" role="status" aria-live="polite"></p><p class="error" role="alert" hidden></p><button class="cancel link" hidden>取消生成</button></div>
    <div class="body"><section class="pane" data-pane="subtitles" role="tabpanel"><div class="toolbar"><select class="language" aria-label="字幕语言"></select><button class="read">刷新</button></div><input class="search" type="search" placeholder="搜索字幕" aria-label="搜索字幕"><div class="actions"><span class="subtitle-count muted"></span><label class="follow"><input type="checkbox">跟随播放</label></div><div class="subtitles scroll"></div><div class="exports"><select class="format" aria-label="字幕导出格式"><option value="timed">带时间戳</option><option value="text">纯文本</option><option value="srt">SRT 字幕</option></select><button class="copy">复制</button><button class="export">导出</button></div></section>
    <section class="pane" data-pane="summary" role="tabpanel" hidden><div class="toolbar"><button class="generate-summary primary">生成总结</button><button class="copy-summary link">复制总结</button><button class="export-summary link">导出</button></div><div class="summary-result result"></div></section>
    <section class="pane" data-pane="chapters" role="tabpanel" hidden><div class="toolbar"><button class="generate-chapters primary">生成章节</button></div><div class="chapter-result scroll"></div></section>
    <section class="pane" data-pane="chat" role="tabpanel" hidden><div class="chat-result scroll"></div><div class="composer"><textarea maxlength="2000" placeholder="向视频提问…" aria-label="向视频提问"></textarea><div class="actions"><button class="ask primary">发送</button></div></div></section>
    <section class="pane" data-pane="downloads" role="tabpanel" hidden><div class="toolbar"><button class="load-media">读取下载格式</button></div><div class="media-result"></div></section>
    <div class="preview" hidden></div></div>
    <details class="settings"><summary><span>AI 设置</span><span class="model-label"></span><span class="chevron">⌄</span></summary><div class="settings-fields"><label>服务<select class="provider"></select></label><label>模型<input class="model" placeholder="模型名称"></label><div class="parameter-grid"><label>思考强度<select class="effort"></select></label><label>输出上限（词元）<input class="max-tokens" type="number" min="1024" step="1" aria-label="输出上限（词元）"></label></div><label>上下文容量（词元）<input class="context-tokens" type="number" min="16000" max="4000000" step="1" aria-label="上下文容量（词元），留空自动识别"></label><div class="actions"><button class="manage link">管理服务</button><button class="clear link">清除缓存</button></div></div></details>
  </details>`;
  const el = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  let state: VideoPanelState | null = null, renderedCache: VideoCache | null | undefined, renderedSource: VideoSource | null = null, renderedMedia: MediaChoice[] | null = null;
  let cues: HTMLButtonElement[] = [], active = -1, selectionKey = '', providersKey = '';
  function button(label: string, click: () => void, className = '') { const node = document.createElement('button'); node.textContent = label; node.className = className; node.addEventListener('click',click); return node; }
  function paragraph(target: Element, text: string, className = '') { const node = document.createElement('p'); node.textContent = text; node.className = className; target.append(node); return node; }
  function empty(target: Element, title: string) { const box = document.createElement('div'); box.className = 'empty'; box.innerHTML = icon; paragraph(box,title); target.append(box); }
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  function selectTab(name: string) {
    for (const tab of tabButtons) { const selected = tab.dataset.tab === name; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1; }
    root.querySelectorAll<HTMLElement>('[data-pane]').forEach(pane => { pane.hidden = pane.dataset.pane !== name; });
  }
  tabButtons.forEach((tab,i) => {
    tab.addEventListener('click',() => selectTab(tab.dataset.tab!));
    tab.addEventListener('keydown',event => {
      const n = event.key === 'ArrowRight' ? (i+1)%tabButtons.length : event.key === 'ArrowLeft' ? (i+tabButtons.length-1)%tabButtons.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length-1 : -1;
      if (n >= 0) { event.preventDefault(); tabButtons[n]!.focus(); selectTab(tabButtons[n]!.dataset.tab!); }
    });
  });
  selectTab('subtitles');
  el('.read').addEventListener('click',() => actions.read(true));
  el('.language').addEventListener('change',() => actions.language(el<HTMLSelectElement>('.language').value));
  el('.cancel').addEventListener('click',actions.cancel);
  el('.generate-summary').addEventListener('click',() => actions.analyze('summary'));
  el('.generate-chapters').addEventListener('click',() => actions.analyze('chapters'));
  el('.ask').addEventListener('click',() => { const input = el<HTMLTextAreaElement>('textarea'); if (input.value.trim()) actions.analyze('chat',input.value.trim()); });
  el('textarea').addEventListener('keydown',event => { const e = event as KeyboardEvent; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); el<HTMLButtonElement>('.ask').click(); } });
  const format = () => el<HTMLSelectElement>('.format').value as 'text' | 'timed' | 'srt';
  el('.copy').addEventListener('click',() => actions.export(format(),true));
  el('.export').addEventListener('click',() => actions.export(format(),false));
  el('.copy-summary').addEventListener('click',() => actions.export('summary',true));
  el('.export-summary').addEventListener('click',() => actions.export('summary',false));
  el('.load-media').addEventListener('click',actions.media); el('.clear').addEventListener('click',actions.clear); el('.manage').addEventListener('click',actions.settings);
  const changeSelection = (reset = false) => {
    const selection: VideoSelection = { providerId: el<HTMLSelectElement>('.provider').value, model: el<HTMLInputElement>('.model').value.trim(),
      effort: el<HTMLSelectElement>('.effort').value as VideoSelection['effort'], maxTokens: Number(el<HTMLInputElement>('.max-tokens').value), contextTokens: Number(el<HTMLInputElement>('.context-tokens').value) };
    if (reset) { selection.effort = videoEfforts(selection)[0]!; selection.maxTokens = Math.min(selection.maxTokens!,videoModel(selection).output); selection.contextTokens = 0; }
    actions.selection(selection);
  };
  el('.provider').addEventListener('change',() => changeSelection(true)); el('.model').addEventListener('change',() => changeSelection(true));
  for (const selector of ['.effort','.max-tokens','.context-tokens']) el(selector).addEventListener('change',() => changeSelection());
  function filter() {
    const search = el<HTMLInputElement>('.search').value.trim().toLocaleLowerCase();
    cues.forEach((cue,i) => { cue.hidden = !!search && !state?.cache?.rows[i]?.text.toLocaleLowerCase().includes(search); });
    el('.subtitle-count').textContent = `${cues.filter(c => !c.hidden).length} 句`;
  }
  el('.search').addEventListener('input',filter);
  function render(next: VideoPanelState) {
    state = next;
    el('.status').textContent = next.status; el('.error').textContent = next.error; el<HTMLElement>('.error').hidden = !next.error;
    el<HTMLElement>('.cancel').hidden = !next.task; el<HTMLElement>('.preview').hidden = !next.task || !next.preview; el('.preview').textContent = next.preview;
    el('.duration').textContent = next.source ? clock(next.source.duration) : '';
    el('.video-title').textContent = next.source?.part || next.source?.title || '读取当前视频…';
    el('.video-title').setAttribute('title',next.source?.part || next.source?.title || '');
    for (const selector of ['.generate-summary','.generate-chapters','.ask','.copy','.export']) el<HTMLButtonElement>(selector).disabled = !next.cache || (!!next.task && selector.startsWith('.generate')) || (!!next.task && selector === '.ask');
    for (const selector of ['.language','.load-media','.clear']) el<HTMLButtonElement>(selector).disabled = next.busy || !next.source;
    el<HTMLButtonElement>('.read').disabled = next.busy;
    el<HTMLButtonElement>('.copy-summary').disabled = !next.cache?.summary; el<HTMLButtonElement>('.export-summary').disabled = !next.cache?.summary;
    const pk = JSON.stringify(next.providers.map(p => [p.id,p.name]));
    if (pk !== providersKey) { providersKey = pk; el('.provider').replaceChildren(...next.providers.map(p => new Option(p.name,p.id))); }
    const sk = JSON.stringify(next.selection);
    if (sk !== selectionKey) {
      selectionKey = sk; el<HTMLSelectElement>('.provider').value = next.selection.providerId; el<HTMLInputElement>('.model').value = next.selection.model;
      const labels = { default: '服务默认', off: '关闭', low: '低', medium: '中', high: '高', max: '最高' };
      el('.effort').replaceChildren(...videoEfforts(next.selection).map(effort => new Option(labels[effort],effort)));
      el<HTMLSelectElement>('.effort').value = next.selection.effort ?? videoEfforts(next.selection)[0]!;
      el<HTMLInputElement>('.max-tokens').value = String(next.selection.maxTokens ?? 8192);
      el<HTMLInputElement>('.max-tokens').max = String(videoModel(next.selection).output);
      const context = el<HTMLInputElement>('.context-tokens'); context.value = next.selection.contextTokens ? String(next.selection.contextTokens) : '';
      context.placeholder = `${videoModel(next.selection).reasoning === 'compatible' ? '默认' : '自动'} · ${videoContext({ ...next.selection, contextTokens: 0 }).toLocaleString()}`;
      el('.model-label').textContent = next.selection.model;
    }
    if (renderedSource !== next.source) {
      renderedSource = next.source;
      el('.language').replaceChildren(...(next.source?.tracks.map(t => new Option(`${t.name}${t.ai ? ' · AI字幕' : ''}`,t.id)) ?? []));
      el<HTMLInputElement>('.search').value = ''; el<HTMLTextAreaElement>('textarea').value = '';
    }
    if (next.cache) el<HTMLSelectElement>('.language').value = next.cache.language;
    if (renderedCache !== next.cache) {
      renderedCache = next.cache; cues = []; active = -1;
      const subtitles = el('.subtitles'); subtitles.replaceChildren();
      if (!next.cache) empty(subtitles,next.source?.subtitleError ? '字幕读取失败' : '暂无字幕');
      else next.cache.rows.forEach(row => {
        const cue = button('',() => actions.seek(row.start),'cue');
        const time = document.createElement('time'); time.textContent = clock(row.start); const text = document.createElement('span'); text.textContent = row.text;
        cue.append(time,text); cues.push(cue); subtitles.append(cue);
      });
      filter();
      const summary = el('.summary-result'); summary.replaceChildren();
      if (next.cache?.summary) {
        const result = next.cache.summary; paragraph(summary,result.value.summary);
        const list = document.createElement('ul'); result.value.points.forEach(text => { const li = document.createElement('li'); li.textContent = text; list.append(li); }); summary.append(list);
      } else empty(summary,'生成一份视频总结');
      const chapters = el('.chapter-result'); chapters.replaceChildren();
      if (next.cache?.chapters) for (const chapter of next.cache.chapters.value) {
        const first = next.cache.rows[chapter.first]!, last = next.cache.rows[chapter.last]!;
        const card = document.createElement('div'); card.className = `chapter${chapter.ad ? ' ad' : ''}`;
        const top = document.createElement('div'); top.className = 'chapter-top';
        top.append(button(clock(first.start),() => actions.seek(first.start),'link timestamp'),button(chapter.title,() => actions.seek(first.start),'chapter-title'));
        if (chapter.ad) { const badge = document.createElement('span'); badge.className = 'ad-badge'; badge.textContent = '疑似广告'; top.append(badge); }
        card.append(top); paragraph(card,chapter.summary);
        if (chapter.ad) card.append(button(`跳过至 ${clock(last.end)}`,() => actions.seek(last.end),'skip'));
        chapters.append(card);
      } else empty(chapters,'生成章节与广告标记');
      const chat = el('.chat-result'); chat.replaceChildren();
      if (next.cache?.answers.length) for (const item of next.cache.answers) {
        const card = document.createElement('div'); card.className = 'chat-item'; paragraph(card,item.question,'question'); paragraph(card,item.answer);
        const refs = document.createElement('div'); refs.className = 'refs';
        item.refs.forEach(id => { const row = next.cache!.rows[id]; if (row) refs.append(button(`${clock(row.start)} 原文`,() => actions.seek(row.start))); });
        card.append(refs); chat.append(card);
      } else empty(chat,'你想了解什么？');
    }
    if (renderedMedia !== next.media) {
      renderedMedia = next.media; const target = el('.media-result'); target.replaceChildren();
      if (!next.media.length) empty(target,'选择视频或音频');
      for (const item of next.media) {
        const row = document.createElement('div'); row.className = 'media'; const body = document.createElement('div'), title = document.createElement('strong'); title.textContent = item.label; body.append(title);
        if (item.size) { const size = document.createElement('small'); size.textContent = `${(item.size/1024/1024).toFixed(1)} MB`; body.append(size); }
        row.append(body,button('下载',() => actions.download(item.id))); target.append(row);
      }
    }
    root.querySelectorAll<HTMLButtonElement>('.media button').forEach(button => { button.disabled = next.busy; });
    el<HTMLButtonElement>('.generate-summary').textContent = next.cache?.summary ? '重新生成总结' : '生成总结';
    el<HTMLButtonElement>('.generate-chapters').textContent = next.cache?.chapters ? '重新生成章节' : '生成章节';
  }
  function playback(seconds: number) {
    if (!state?.cache) return;
    const next = activeSubtitle(state.cache.rows,seconds); if (next === active) return;
    if (active >= 0) cues[active]?.classList.remove('active'); active = next;
    if (active >= 0) { const cue = cues[active]!; cue.classList.add('active'); if (el<HTMLInputElement>('.follow input').checked && !cue.hidden && !el<HTMLInputElement>('.search').value) {
      const scroller = el<HTMLElement>('.subtitles'), rect = cue.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) scroller.scrollTop += rect.top-bounds.top-scroller.clientHeight/3;
    } }
  }
  function mount() {
    const fullscreen = document.fullscreenElement;
    const sidebar = document.querySelector('.right-container-inner, .right-container');
    const parent = fullscreen || (sidebar && sidebar.getBoundingClientRect().width >= 260 ? sidebar : document.body);
    host.dataset.floating = String(!fullscreen && parent === document.body); host.dataset.fullscreen = String(!!fullscreen);
    if (host.parentElement !== parent) { if (parent === document.body || fullscreen) parent.append(host); else {
      const author = parent.querySelector('.up-panel-container'); if (author?.parentElement === parent) author.after(host); else parent.prepend(host);
    } }
  }
  return { host, render, playback, mount, theme: (theme: Theme) => { host.dataset.theme = theme; }, remove: () => host.remove(), clearQuestion: () => { el<HTMLTextAreaElement>('textarea').value = ''; } };
}
