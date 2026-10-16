// 随播放采集并合并评论更新，保留暂停进度，协调部分速读与精简文本导出。
import { browser } from 'wxt/browser';
import { send } from './client';
import { playbackBvid } from './core';
import { commentsText, quickReadKey, selectComments } from './comment-data';
import { createCommentCard } from './comment-card';
import { jumpToComment } from './comment-navigation';
import type { CommentCardState } from './comment-card';
import type { CommentPage, CommentRecord, QuickReadProgress, QuickReadResult, VideoCommentsSource } from './comment-types';
import type { ContentSettings } from './types';
import type { Theme } from './theme';

export function startCommentReading(initial: ContentSettings, signal: AbortSignal) {
  let settings = initial, bvid = '', source: VideoCommentsSource | null = null, generation = 0, watched = 0;
  let started = false, autoAttempted = false, job: AbortController | null = null, requestId = '';
  let playbackActive = false;
  let collection: AbortController | null = null, resumeCollection: (() => void) | null = null, collectionStatus = '';
  let navigation: AbortController | null = null;
  let navigationTask: Promise<void> = Promise.resolve();
  const comments = new Map<string, CommentRecord>();
  const lengths = new Map<string, { text: string; length: number }>();
  let selectionDirty = false, lastSelection = -Infinity;
  const state: CommentCardState = { status: '播放后开始采集评论。', error: '', collecting: false, paused: false, analyzing: false, preview: '', complete: false, loadingCache: false, total: 0, expected: 0, selected: 0, result: null };
  const view = createCommentCard({ collect: () => { void collect(); }, pause: pauseCollection, analyze: () => { void analyze(); }, cancel,
    copy: all => exportText(all,false), download: all => exportText(all,true), settings: () => { void send({ type: 'open-settings' }); }, jump: id => { void navigate(id); } });
  function update(changed = false, force = false) {
    if (signal.aborted) return;
    state.total = comments.size;
    selectionDirty ||= changed;
    if (selectionDirty && (force || comments.size <= settings.quickRead.limit || Date.now()-lastSelection >= 1000)) {
      state.selected = comments.size <= settings.quickRead.limit ? comments.size : selectComments([...comments.values()],settings.quickRead.limit,lengths).length;
      selectionDirty = false; lastSelection = Date.now();
    }
    view.render(state); view.mount();
  }
  function errorText(error: unknown) { return error instanceof Error ? error.message : '评论处理失败，请手动重试。'; }
  function cancel() {
    job?.abort(); job = null;
    if (requestId) { void send({ type: 'comments-cancel', requestId }).catch(() => {}); requestId = ''; }
    state.analyzing = false; state.preview = ''; state.status = state.paused ? '已取消速读；采集仍暂停，可继续采集。' : '已取消速读，评论仍可导出。'; update();
  }
  function pauseCollection() {
    if (!collection || state.paused) return;
    state.paused = true; state.collecting = false;
    state.status = '采集已暂停，可分析已采集内容或继续采集；已发出的这一页仍会保留。'; update(false,true);
  }
  function activate(id: string) {
    navigation?.abort();
    collection?.abort(); collection = null;
    cancel(); bvid = id; generation++; source = null; comments.clear(); lengths.clear(); watched = 0; started = false; autoAttempted = false; playbackActive = false;
    Object.assign(state,{ status: '正在读取本地速读缓存……', error: '', collecting: false, paused: false, complete: false, loadingCache: !!id, expected: 0, result: null });
    if (!id) { view.remove(); return; }
    update(true,true);
    const epoch = generation;
    void send<QuickReadResult | null>({ type: 'comments-cache', bvid }).then(result => {
      if (epoch !== generation || signal.aborted || !result || result.key !== quickReadKey(settings.quickRead) || state.analyzing || state.result) return;
      state.result = result; autoAttempted = true; started = true;
      if (!state.collecting) state.status = result.complete === false ? '已恢复部分评论速读缓存；需要补齐评论或导出时，点击“检查更新”。' : '已恢复本地速读缓存；需要更新或导出评论时，点击“检查更新”。'; update();
    }).catch(error => {
      if (epoch !== generation || signal.aborted || state.result || state.analyzing || state.error) return;
      started = true; state.status = '本地缓存读取失败，可手动采集或刷新后重试。';
      state.error = `本地速读缓存读取失败：${errorText(error)}`; update();
    }).finally(() => {
      if (epoch !== generation || signal.aborted) return;
      state.loadingCache = false;
      if (!started && !state.result) state.status = '播放后开始采集评论。';
      update(); maybeCollect();
    });
  }
  function maybeCollect() {
    if (!state.loadingCache && playbackActive && !started && !signal.aborted) void collect();
  }
  async function navigate(id: string) {
    navigation?.abort();
    const controller = new AbortController(); navigation = controller;
    const epoch = generation;
    state.error = ''; state.status = '正在当前页面定位评论……'; update();
    const task = navigationTask.catch(() => {}).then(() => {
      controller.signal.throwIfAborted();
      return jumpToComment(id,AbortSignal.any([signal,controller.signal]));
    });
    navigationTask = task;
    try {
      await task;
      if (!signal.aborted && !controller.signal.aborted && epoch === generation) state.status = '已定位原评论，速读窗会保持可见。';
    } catch (error) {
      if (!signal.aborted && !controller.signal.aborted && epoch === generation) state.error = errorText(error);
    } finally {
      if (navigation === controller) { navigation = null; update(); }
    }
  }
  async function collect() {
    if (!bvid || job || signal.aborted) return;
    if (collection) {
      if (state.paused) {
        state.paused = false; state.collecting = true; state.status = collectionStatus; resumeCollection?.(); update();
      }
      return;
    }
    const id = bvid, epoch = generation, controller = new AbortController(); collection = controller; started = true;
    const active = () => { controller.signal.throwIfAborted(); if (epoch !== generation || signal.aborted) throw new DOMException('已取消','AbortError'); };
    // 等待时保留主评论游标、当前楼层、页码与去重集合；暂停不重建采集任务。
    const ready = async () => {
      active();
      while (state.paused) {
        active();
        await new Promise<void>(resolve => {
          const resume = () => { controller.signal.removeEventListener('abort',resume); if (resumeCollection === resume) resumeCollection = null; resolve(); };
          resumeCollection = resume; controller.signal.addEventListener('abort',resume,{ once: true });
        });
      }
      active();
    };
    const previous = new Set(comments.keys()), seen = new Set<string>(), roots = new Map<string,CommentRecord>();
    const previews = new Map<string,Set<string>>();
    state.collecting = true; state.paused = false; state.complete = false; state.error = '';
    collectionStatus = state.status = previous.size ? '保留已有评论，正在检查新增与变化……' : '正在读取主评论……'; update();
    const add = (page: CommentPage) => { for (const comment of page.comments) comments.set(comment.id,comment); update(true); };
    try {
      if (!source) { const resolved = await send<VideoCommentsSource>({ type: 'comments-source', bvid: id }); active(); source = resolved; }
      const oid = source.oid;
      let offset = '', noProgress = 0, selected = false;
      for (;;) {
        await ready();
        const page = await send<CommentPage>({ type: 'comments-page', oid, offset }); active();
        const before = roots.size; state.expected = page.expected; selected ||= page.selected;
        for (const comment of page.comments) {
          if (comment.root === '0') { roots.set(comment.id,comment); seen.add(comment.id); }
          else { const ids = previews.get(comment.root) || new Set<string>(); ids.add(comment.id); previews.set(comment.root,ids); }
        }
        add(page);
        noProgress = before === roots.size ? noProgress+1 : 0;
        if (page.end) break;
        if (!page.offset || noProgress >= 2) throw new Error('主评论尚未返回结束，但翻页无法继续；已保留评论，可导出或稍后检查更新。');
        offset = page.offset;
      }
      const threads = [...roots.values()].filter(comment => comment.replies > 0);
      for (const [index,root] of threads.entries()) {
        const preview = previews.get(root.id);
        if (preview?.size === root.replies) { for (const id of preview) seen.add(id); continue; }
        collectionStatus = `正在读取楼中楼 ${index+1}/${threads.length}……`;
        if (!state.paused && !state.analyzing) state.status = collectionStatus; update();
        const ids = new Set<string>(); let expected = root.replies;
        for (let pn = 1;;pn++) {
          await ready();
          const page = await send<CommentPage>({ type: 'comments-page', oid, root: root.id, pn }); active();
          expected = page.expected;
          for (const comment of page.comments) if (comment.root === root.id) ids.add(comment.id);
          add(page);
          if (page.end) break;
          if (!page.comments.length) throw new Error('回复分页提前返回空数据，采集未完成；可以导出已读取的内容。');
        }
        if (ids.size !== expected) throw new Error('楼中楼数量发生变化或存在不可见回复，暂时无法确认完整；可导出已采集内容，稍后检查更新。');
        for (const id of ids) seen.add(id);
      }
      active();
      if (selected || seen.size !== state.expected) throw new Error(selected ? '这是精选评论区，无法确认覆盖全部讨论；可以导出当前可见评论。' : `本轮核对${seen.size}条，接口显示${state.expected}条；评论可能发生变化或存在可见性限制，已有内容已保留，可检查更新或分析已采集。`);
      const added = [...seen].filter(id => !previous.has(id)).length;
      let removed = 0;
      for (const id of comments.keys()) if (!seen.has(id)) { comments.delete(id); lengths.delete(id); removed++; }
      state.complete = true;
      if (!state.analyzing) state.status = previous.size ? `检查完成，新增${added}条${removed ? `，移除${removed}条失效记录` : ''}，可${state.result ? '重新' : ''}速读或导出。` : comments.size ? '采集完成，可速读或导出。' : '这个视频暂无可见评论。';
    } catch (error) {
      if (!controller.signal.aborted && epoch === generation && !signal.aborted) { state.error = errorText(error); state.status = '采集未完成，已读取的内容仍可导出。'; }
    } finally {
      if (collection === controller) { collection = null; state.collecting = false; state.paused = false; update(true,true); maybeAuto(); }
    }
  }
  async function analyze() {
    if (!source || job || state.collecting || !comments.size || signal.aborted) return;
    const controller = new AbortController(), epoch = generation; job = controller; requestId = crypto.randomUUID(); autoAttempted = true;
    const id = requestId; state.analyzing = true; state.preview = ''; state.error = ''; state.status = '正在整理评论，最长等待4分钟……'; update(false,true);
    try {
      const selected = selectComments([...comments.values()],settings.quickRead.limit,lengths);
      const result = await send<QuickReadResult>({ type: 'comments-analyze', requestId: id, source, comments: selected, total: comments.size, complete: state.complete, expected: state.expected });
      if (controller.signal.aborted || signal.aborted || epoch !== generation) return;
      state.result = result;
      state.status = result.complete === false
        ? state.complete ? '部分速读已完成；采集也已完整，可手动重新速读。' : '部分速读已完成；可导出，或补齐采集后手动重新速读。'
        : '速读已完成，展开查看。';
    } catch (error) {
      if (!controller.signal.aborted && epoch === generation && !signal.aborted) { state.error = errorText(error); state.status = '速读未完成；评论仍可复制或下载。'; }
    } finally {
      if (job === controller) { job = null; requestId = ''; state.analyzing = false; state.preview = ''; update(); }
    }
  }
  function maybeAuto() {
    if (!settings.quickRead.auto || watched <= 300 || autoAttempted || state.result || !state.complete || !comments.size || job) return;
    autoAttempted = true; void analyze();
  }
  function exportText(all: boolean, download: boolean) {
    if (!source || !comments.size) return;
    const selected = all ? [...comments.values()].sort((a,b) => a.time-b.time) : selectComments([...comments.values()],settings.quickRead.limit,lengths);
    const text = commentsText(source,selected,comments.size,state.complete,all ? 'all' : 'selected');
    if (download) {
      const url = URL.createObjectURL(new Blob(['\uFEFF',text],{ type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `${source.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80)}-${bvid}-${all ? '全部' : '筛选'}评论.txt`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url),10000); state.status = `已导出${selected.length}条评论。`; update();
    } else {
      void navigator.clipboard.writeText(text).then(() => { state.status = `已复制${selected.length}条评论，可粘贴到网页AI。`; update(); }, () => { state.error = '浏览器未允许复制，请让页面保持前台后重试，或下载文本文件。'; update(); });
    }
  }
  const onMessage = (message: QuickReadProgress | { type: 'theme-changed'; theme: Theme }) => {
    if (message.type === 'theme-changed') { view.theme(message.theme); return; }
    if (message.type !== 'comments-progress' || !state.analyzing || !job || job.signal.aborted || signal.aborted || message.requestId !== requestId || message.bvid !== bvid) return;
    if (message.summary) { state.preview = message.summary; state.status = '正在生成总览，话题和推荐评论将在完成后显示……'; }
    else if (message.thinking && !state.preview) state.status = '模型正在思考，等待生成总览……';
    update();
  };
  browser.runtime.onMessage.addListener(onMessage);
  void send<Theme>({ type: 'theme' }).then(theme => view.theme(theme)).catch(() => {});
  const observer = new MutationObserver(() => { if (bvid) view.mount(); }); observer.observe(document.body,{ childList: true, subtree: true });
  window.addEventListener('resize',view.mount,{ signal });
  const timer = setInterval(() => {
    const id = playbackBvid(location.pathname,location.search); if (id !== bvid) activate(id);
    // 活跃分析期间用短消息读取状态，避免空闲后台丢失正在接收的流式请求。
    if (state.analyzing) void send({ type: 'comments-cache', bvid }).catch(() => {});
  },10000);
  activate(playbackBvid(location.pathname,location.search));
  signal.addEventListener('abort',() => { navigation?.abort(); collection?.abort(); cancel(); clearInterval(timer); observer.disconnect(); browser.runtime.onMessage.removeListener(onMessage); view.remove(); },{ once: true });
  return {
    watch(id: string, seconds: number, playing: boolean) { if (id !== bvid) activate(id); watched = seconds; playbackActive = playing; maybeCollect(); maybeAuto(); },
    configure(next: ContentSettings) {
      const changed = quickReadKey(settings.quickRead) !== quickReadKey(next.quickRead); settings = next;
      if (changed) { if (state.analyzing) cancel(); state.result = null; }
      update(true,true); maybeAuto();
    },
  };
}
