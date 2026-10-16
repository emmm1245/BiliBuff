// 跟随当前播放内容协调工作台，阻止旧任务覆盖新页面并连接字幕、问答和下载操作。
import { browser } from 'wxt/browser';
import { send } from './client';
import { safeFilename, subtitleText, videoRoute } from './video-data';
import { createVideoPanel } from './video-panel';
import type { VideoPanelState } from './video-panel';
import type { ContentSettings } from './types';
import type { MediaChoice, VideoCache, VideoProgress, VideoSelection, VideoSource, VideoTask } from './video-types';
import type { Theme } from './theme';

export function startVideoReading(initial: ContentSettings, signal: AbortSignal) {
  let settings = initial, currentRoute = '', generation = 0, requestId = '', language = '', selectionEdited = false;
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task: null, preview: '', error: '', status: '',
    selection: { providerId: initial.ai.providerId ?? 'deepseek', model: initial.ai.model }, providers: initial.providers };
  const view = createVideoPanel({ read: refresh => { void read(refresh); }, language: id => { cancel(); language = id; generation++; state.cache = null; void read(); },
    analyze: (task,question) => { void analyze(task,question); }, cancel,
    seek: seconds => {
      if (!state.source || !isCurrent()) return;
      const player = document.querySelector<HTMLVideoElement>('#bilibili-player video, .bpx-player-container video');
      if (player) { player.currentTime = Math.max(0,Math.min(seconds,player.duration || state.source.duration)); view.playback(player.currentTime); }
    }, export: (format,copy) => { void exportContent(format,copy); }, media: () => { void media(); }, download: id => { void download(id); },
    clear: () => { void clear(); }, settings: () => { void send({ type: 'open-settings' }).catch(fail); },
    selection: selection => { selectionEdited = true; state.selection = selection; update(); },
  });
  function routeKey() { return JSON.stringify(videoRoute(location.pathname,location.search)); }
  function isCurrent(epoch = generation) { return !signal.aborted && epoch === generation && currentRoute === routeKey(); }
  function update() { if (signal.aborted) return; view.render(state); if (videoRoute(location.pathname,location.search).bvid) view.mount(); }
  function fail(error: unknown) { state.error = error instanceof Error ? error.message : '视频助手操作失败，请重试。'; update(); }
  function cancel() {
    if (requestId) { void send({ type: 'video-cancel', requestId }).catch(() => {}); requestId = ''; }
    state.task = null; state.preview = ''; state.status = '已取消'; update();
  }
  async function activate() {
    const route = videoRoute(location.pathname,location.search);
    cancel(); currentRoute = routeKey(); generation++; const epoch = generation;
    state.source = null; state.cache = null; state.media = []; state.error = ''; state.busy = !!route.bvid; state.status = '正在读取视频…';
    if (!route.bvid) { view.remove(); return; }
    update();
    try {
      const source = await send<VideoSource>({ type: 'video-source', ...route });
      if (!isCurrent(epoch)) return;
      state.source = source;
      language = source.tracks.find(t => t.id === 'zh-CN' || t.id === 'zh-Hans' || t.id === 'zh')?.id || source.tracks.find(t => t.id.includes('zh'))?.id || source.tracks[0]?.id || '';
      state.busy = false;
      if (language) await read();
      else { state.status = '暂无字幕，可登录后刷新。'; state.error = source.subtitleError ?? ''; update(); }
    } catch (error) { if (isCurrent(epoch)) { state.busy = false; fail(error); } }
  }
  async function read(refresh = false) {
    if (!state.source) { void activate(); return; }
    if (!isCurrent()) return;
    if (!language) { void activate(); return; }
    cancel(); const epoch = ++generation, source = state.source;
    state.busy = true; state.error = ''; state.status = refresh ? '正在刷新字幕…' : '正在读取字幕…'; update();
    try {
      const cache = await send<VideoCache>({ type: 'video-subtitles', bvid: source.bvid, cid: source.cid, language, refresh });
      if (!isCurrent(epoch)) return;
      state.cache = cache; state.status = '';
    } catch (error) { if (isCurrent(epoch)) fail(error); }
    finally { if (isCurrent(epoch)) { state.busy = false; update(); } }
  }
  async function analyze(task: VideoTask, question?: string) {
    if (!state.cache || state.task || !isCurrent()) return;
    const cache = state.cache, epoch = generation, id = crypto.randomUUID(); requestId = id;
    state.task = task; state.error = ''; state.preview = ''; state.status = task === 'chapters' ? '正在生成章节…' : task === 'chat' ? '正在回答…' : '正在生成总结…'; update();
    try {
      const next = await send<VideoCache>({ type: 'video-analyze', task, requestId: id, bvid: cache.source.bvid, cid: cache.source.cid, language: cache.language,
        fingerprint: cache.fingerprint, selection: { ...state.selection }, question });
      if (!isCurrent(epoch) || requestId !== id) return;
      state.cache = next; state.status = '已完成'; if (task === 'chat') view.clearQuestion();
    } catch (error) { if (isCurrent(epoch) && requestId === id) fail(error); }
    finally { if (isCurrent(epoch) && requestId === id) { requestId = ''; state.task = null; state.preview = ''; update(); } }
  }
  async function media() {
    if (!state.source || state.busy || !isCurrent()) return;
    const source = state.source, epoch = generation; state.busy = true; state.error = ''; state.status = '正在读取格式…'; update();
    try { const result = await send<MediaChoice[]>({ type: 'video-media', bvid: source.bvid, cid: source.cid }); if (isCurrent(epoch)) { state.media = result; state.status = ''; } }
    catch (error) { if (isCurrent(epoch)) fail(error); }
    finally { if (isCurrent(epoch)) { state.busy = false; update(); } }
  }
  async function download(choice: string) {
    if (!state.source || state.busy || !isCurrent()) return;
    const source = state.source, epoch = generation; state.busy = true; state.error = ''; state.status = '正在检查下载地址……'; update();
    try { await send({ type: 'video-download', bvid: source.bvid, cid: source.cid, choice }); if (isCurrent(epoch)) state.status = '已开始下载'; }
    catch (error) { if (isCurrent(epoch)) fail(error); }
    finally { if (isCurrent(epoch)) { state.busy = false; update(); } }
  }
  async function clear() {
    if (!state.source || state.busy || !isCurrent()) return;
    cancel(); const source = state.source, epoch = ++generation;
    state.busy = true; state.error = ''; update();
    try { await send({ type: 'video-cache-clear', bvid: source.bvid, cid: source.cid }); if (isCurrent(epoch)) { state.cache = null; state.status = '已清除缓存'; } }
    catch (error) { if (isCurrent(epoch)) fail(error); }
    finally { if (isCurrent(epoch)) { state.busy = false; update(); } }
  }
  async function exportContent(format: 'text' | 'timed' | 'srt' | 'summary', copy: boolean) {
    if (!state.cache || !isCurrent()) return;
    const cache = state.cache;
    const summary = cache.summary?.value;
    if (format === 'summary' && !summary) return;
    const text = format === 'summary' ? [cache.source.title,`https://www.bilibili.com/video/${cache.source.bvid}/?p=${cache.source.page}`,'',summary!.summary,'',...summary!.points.map(p => `• ${p}`)].join('\n') : subtitleText(cache,format);
    try {
      if (copy) await navigator.clipboard.writeText(text);
      else {
        const url = URL.createObjectURL(new Blob(['\uFEFF',text],{ type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `${safeFilename(cache.source.title)}-${format === 'summary' ? '总结' : '字幕'}.${format === 'srt' ? 'srt' : 'txt'}`; link.click();
        setTimeout(() => URL.revokeObjectURL(url),10000);
      }
      state.status = copy ? '已复制' : '已导出'; state.error = ''; update();
    } catch (error) { fail(error); }
  }
  const onMessage = (message: VideoProgress | { type: 'theme-changed'; theme: Theme }) => {
    if (message.type === 'theme-changed') { view.theme(message.theme); return; }
    if (message.type !== 'video-progress' || message.requestId !== requestId || !state.task || !isCurrent()) return;
    if (message.summary) state.preview = message.summary;
    if (message.thinking && !state.preview) state.status = '正在思考…'; update();
  };
  browser.runtime.onMessage.addListener(onMessage);
  const observer = new MutationObserver(() => { if (state.source && isCurrent()) view.mount(); }); observer.observe(document.body,{ childList: true, subtree: true });
  const timer = setInterval(() => {
    if (currentRoute !== routeKey()) void activate();
    // 活跃任务通过轻量消息保持现有流式后台的活动，不触发模型或字幕请求。
    if (requestId) void send({ type: 'video-selection' }).catch(() => {});
  },1000);
  document.addEventListener('timeupdate',event => { const video = event.target; if (video instanceof HTMLVideoElement && video.closest('#bilibili-player, .bpx-player-container') && isCurrent()) view.playback(video.currentTime); },{ capture: true, signal });
  document.addEventListener('fullscreenchange',() => { if (state.source && isCurrent()) view.mount(); },{ signal });
  void send<Theme>({ type: 'theme' }).then(theme => { if (!signal.aborted) view.theme(theme); }).catch(() => {});
  void send<VideoSelection>({ type: 'video-selection' }).then(selection => { if (!signal.aborted && !selectionEdited) { state.selection = selection; update(); } }).catch(fail);
  void activate();
  signal.addEventListener('abort',() => { cancel(); clearInterval(timer); observer.disconnect(); browser.runtime.onMessage.removeListener(onMessage); view.remove(); },{ once: true });
  return { configure(next: ContentSettings) {
    settings = next; state.providers = settings.providers;
    if (!state.providers.some(provider => provider.id === state.selection.providerId)) state.selection = { providerId: settings.ai.providerId ?? 'deepseek', model: settings.ai.model };
    update();
  } };
}
