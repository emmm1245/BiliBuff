// 在可信后台按近期计划复核偏好视频，统一控制两种模型的缓存、去重、并发和失效。
import { buildReviewRequest, type Candidate } from './review/prompt';
import { parseGeneralReview, parseDecisionResponse } from './review/results';
import { reviewOutputSchema } from './analysis/schemas';
import { classify, validatePlan, validWorkspaceId } from './core';
import { cachedReview, saveReview } from './database';
import { aiConnection } from './ai-providers';
import { requestAI } from './ai-request';
import { traceAIRequest } from './ai-debug';
import type { Preferences, ReviewVerdict } from './types';

interface Job {
  candidate: Candidate; context: string; cacheKey: string; epoch: number;
  resolve: (verdict: ReviewVerdict) => void; reject: (error: Error) => void;
}
// 仅整理调用实现，输入与判定策略保持不变，继续复用现有v2缓存。
const REVIEW_VERSION = 2;
export function createReviewer(readPreferences: () => Promise<Preferences>, requestTags: (bvid: string) => Promise<string[]>) {
  const pending = new Map<string, Promise<ReviewVerdict>>();
  const queue: Job[] = [];
  const controllers = new Set<AbortController>();
  let epoch = 0, active = 0, lastError = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const selection = (prefs: Preferences) => ({ providerId: prefs.settings.review.providerId ?? 'deepseek', model: prefs.settings.review.model ?? 'deepseek-flash' });
  const context = (prefs: Preferences) => JSON.stringify([REVIEW_VERSION, prefs.plan, prefs.settings.review, prefs.settings.planMaxLength,
    prefs.settings.review.mode === 'general' ? prefs.settings.providers.find(provider => provider.id === selection(prefs).providerId) : null]);
  function credentials(prefs: Preferences) {
    validatePlan(prefs.plan, prefs.settings.planMaxLength);
    if (prefs.settings.review.mode === 'decision') {
      if (!prefs.decisionApiKey || !validWorkspaceId(prefs.settings.review.workspaceId)) throw new Error('请在“内容过滤 → AI 复核 → 复核设置”中填写阿里云密钥和业务空间标识。');
    } else aiConnection(prefs, selection(prefs));
  }
  async function process(jobs: Job[]) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const prefs = await readPreferences();
      if (jobs[0]!.epoch !== epoch || !prefs.settings.review.enabled || context(prefs) !== jobs[0]!.context) {
        jobs.forEach(job => job.resolve('stale')); return;
      }
      credentials(prefs);
      const mode = prefs.settings.review.mode;
      const ids = jobs.map((_, index) => `v${index}`);
      const connection = mode === 'general' ? aiConnection(prefs, selection(prefs)) : null;
      const body = buildReviewRequest(mode, prefs.plan, jobs.map(job => job.candidate), connection?.model, connection?.provider.type === 'deepseek');
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const consume = async (response: Response) => {
        if (!response.ok) throw new Error(`AI 复核请求失败（${response.status}），本次沿用原规则，不自动重试。`);
        return parseDecisionResponse(await response.json(), ids);
      };
      const url = `https://${prefs.settings.review.workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone`;
      const decisions = mode === 'general' ? await requestAI(prefs, selection(prefs), body, signal, value => parseGeneralReview(value, ids), 'AI 通用复核', { schema: reviewOutputSchema }) :
        await traceAIRequest('AI 决策复核', { service: '阿里云', url, input: body }, signal, () => fetch(url, {
        method: 'POST', credentials: 'omit', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prefs.decisionApiKey}` },
        body: JSON.stringify(body),
      }), consume);
      if (jobs[0]!.epoch !== epoch) { jobs.forEach(job => job.resolve('stale')); return; }
      await Promise.all(jobs.map((job, index) => saveReview(job.cacheKey, decisions[index]!)));
      if (jobs[0]!.epoch !== epoch) { jobs.forEach(job => job.resolve('stale')); return; }
      lastError = '';
      jobs.forEach((job, index) => job.resolve(decisions[index]!));
    } catch (error) {
      if (jobs[0]!.epoch !== epoch) jobs.forEach(job => job.resolve('stale'));
      else {
        lastError = error instanceof Error ? error.message : 'AI 复核失败，本次沿用原规则。';
        jobs.forEach(job => job.reject(new Error(lastError)));
      }
    } finally { controllers.delete(controller); }
  }
  function pump() {
    clearTimeout(timer); timer = undefined;
    while (active < 2 && queue.length) {
      const first = queue[0]!;
      const jobs: Job[] = [];
      for (let index = 0; index < queue.length && jobs.length < 8;) {
        if (queue[index]!.context === first.context) jobs.push(queue.splice(index, 1)[0]!);
        else index++;
      }
      active++;
      void process(jobs).finally(() => { active--; pump(); });
    }
  }
  async function request(bvid: string, title: string, durationSeconds: number | null = null): Promise<ReviewVerdict> {
    const started = epoch;
    const prefs = await readPreferences();
    if (started !== epoch) return 'stale';
    if (!prefs.settings.review.enabled) return 'skipped';
    credentials(prefs);
    if (typeof bvid !== 'string' || !/^BV\w+$/.test(bvid) || typeof title !== 'string' || !title.trim() || title.length > 300) throw new Error('AI 复核视频信息无效。');
    if (durationSeconds !== null && (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0)) throw new Error('AI 复核视频时长无效。');
    const signature = context(prefs);
    const key = JSON.stringify([signature, bvid, title, durationSeconds]);
    const existing = pending.get(key);
    if (existing) return existing;
    const task = (async (): Promise<ReviewVerdict> => {
      const tags = await requestTags(bvid);
      if (started !== epoch) return 'stale';
      if (classify(title, tags, prefs.settings).kind !== 'highlight') return 'skipped';
      const candidate = { title, tags: tags.slice(0, 20).map(tag => tag.slice(0, 80)), durationSeconds };
      const cacheKey = JSON.stringify([signature, bvid, candidate]);
      const cached = await cachedReview(cacheKey);
      if (started !== epoch) return 'stale';
      if (cached) return cached;
      return new Promise<ReviewVerdict>((resolve, reject) => {
        queue.push({ candidate, context: signature, cacheKey, epoch: started, resolve, reject });
        if (!timer) timer = setTimeout(() => { timer = undefined; pump(); }, 40);
      });
    })().catch(error => {
      if (started !== epoch) return 'stale' as const;
      lastError = error instanceof Error ? error.message : 'AI 复核失败，本次沿用原规则。';
      throw new Error(lastError);
    }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    pending.set(key, task);
    return task;
  }
  return {
    request,
    error: () => lastError,
    invalidate() {
      epoch++; lastError = ''; clearTimeout(timer); timer = undefined;
      pending.clear(); queue.splice(0).forEach(job => job.resolve('stale'));
      controllers.forEach(controller => controller.abort());
    },
  };
}
