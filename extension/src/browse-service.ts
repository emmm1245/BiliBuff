// 管理独立选片任务、取消与首页状态，具体推荐流程由选片模块执行。
import { aiConnection } from './ai-providers';
import { validatePlan } from './core';
import { browseContext } from './browse-ranking';
import { readBrowseMemory, updateBrowseMemory } from './browse-store';
import { selectBrowseBatch } from './browse-selection';
import type { BrowseMessage, BrowseState } from './browse-types';
import type { Preferences } from './types';

export function createBrowseService(readPreferences: () => Promise<Preferences>) {
  let job: { id: string; controller: AbortController; context: string; status: string; promise: Promise<void> } | undefined;
  let lastError = '', errorContext = '';
  const cooldowns = new Map<string,number>();
  async function state(): Promise<BrowseState> {
    const [prefs,memory] = await Promise.all([readPreferences(),readBrowseMemory()]);
    const context = browseContext(prefs), enabled = prefs.settings.browse.enabled;
    let configurationError = '';
    if (enabled) {
      try { validatePlan(prefs.plan,prefs.settings.planMaxLength); aiConnection(prefs,prefs.settings.browse); }
      catch (error) { configurationError = (error as Error).message; }
    }
    const busy = Boolean(job);
    return { items: enabled && memory.context === context ? memory.items.map(video => ({ ...video, vote: memory.feedback.find(item => item.video.bvid === video.bvid)?.vote ?? 0 })) : [],
      updatedAt: memory.context === context ? memory.updatedAt : 0, busy, ready: enabled && !configurationError,
      status: busy ? !job!.context || job!.context === context ? job!.status : '正在为你挑选视频…' : '', error: configurationError || (errorContext === context ? lastError : '') ||
        (!job && memory.pending?.context === context ? '上次选片已中断，可以重新找一批。' : '') };
  }
  async function generate(current: NonNullable<typeof job>) {
    const signal = AbortSignal.any([current.controller.signal,AbortSignal.timeout(6*60000)]);
    const prefs = await readPreferences(), context = browseContext(prefs);
    current.context = context;
    try {
      if (!prefs.settings.browse.enabled) throw new Error('请先开启 AI帮你刷。');
      validatePlan(prefs.plan,prefs.settings.planMaxLength); aiConnection(prefs,prefs.settings.browse);
      lastError = ''; errorContext = context;
      await updateBrowseMemory(latest => ({ ...latest,pending: { id: current.id,context } }));
      lastError = await selectBrowseBatch(prefs,readPreferences,signal,text => { current.status = text; },cooldowns);
    } catch (error) {
      errorContext = context;
      console.warn('AI帮你刷选片未完成',error);
      lastError = current.controller.signal.aborted ? '已停止选片。' : signal.aborted || (error as Error).name === 'TimeoutError' ?
        '本次选片用时较长，可以稍后再试。' : '本次暂未选出新内容，可以稍后再试。';
    }
  }
  async function refresh(): Promise<BrowseState> {
    if (job) {
      if (!job.controller.signal.aborted) return state();
      await job.promise;
      return refresh();
    }
    const current = { id: crypto.randomUUID(),controller: new AbortController(),context: '',status: '正在为你挑选视频…',promise: undefined as unknown as Promise<void> };
    job = current;
    // 请求立即返回；首页只在选片期间查询进度，让慢模型不占住单次消息事件。
    current.promise = generate(current).catch(error => { errorContext = current.context; lastError = (error as Error).message; }).finally(async () => {
      try { await updateBrowseMemory(memory => memory.pending?.id === current.id ? { ...memory,pending: undefined } : memory); }
      catch { errorContext = current.context; lastError = '推荐记录未能保存，请稍后重试。'; }
      finally { if (job === current) job = undefined; }
    });
    return state();
  }
  async function feedback(bvid: string, vote: 1 | -1 | 0) {
    await updateBrowseMemory(memory => {
      const video = memory.items.find(item => item.bvid === bvid) ?? memory.feedback.find(item => item.video.bvid === bvid)?.video;
      if (!video) throw new Error('这条推荐已更新，请刷新后再反馈。');
      return { ...memory, feedback: [...memory.feedback.filter(item => item.video.bvid !== bvid),...(vote ? [{ video, vote, at: Date.now() }] : [])] };
    });
    return state();
  }
  return {
    invalidate(prefs: Preferences) { if (job && job.context && job.context !== browseContext(prefs)) job.controller.abort(); },
    async handle(message: BrowseMessage) {
      switch (message.type) {
        case 'browse-state': return state();
        case 'browse-refresh': return refresh();
        case 'browse-feedback': return feedback(message.bvid,message.vote);
        case 'browse-cancel': job?.controller.abort(); return;
      }
    },
  };
}
