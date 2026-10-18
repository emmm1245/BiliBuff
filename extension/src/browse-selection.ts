// 按通用计划规划查询、追踪真实供给并全局精选，所有B站请求共享有限预算。
import type { ZodType } from 'zod';
import { requestAI } from './ai-request';
import { modelParameters } from './core';
import { matchGroup } from './filter/rules';
import { samples } from './database';
import { browseEvidence, browseHome, browseRelated, browseSearch } from './browse-api';
import { browseContext, browseFactsSchema, browseFactsTask, browseGlobalSchema, browseGlobalTask, browseInstructions, inspectBrowseFacts, browseProfileSchema, browseProfileTask,
  browseShortlistSchema, fallbackBrowseRanking, mergeBrowseCandidates, rankBrowsePicks, resolveBrowseIds, selectBrowsePicks } from './browse-ranking';
import { browseQueryKey, browseQueryPage, browseSearchPlanSchema, browseSearchSummary, browseSearchTask, prepareBrowseSearches } from './browse-search';
import { BROWSE_POOL_AGE, browseLogEpoch, readBrowseMemory, updateBrowseMemory } from './browse-store';
import { createBrowseSources } from './browse-sources';
import { createBrowseNetwork } from './browse-network';
import type { BrowseEvidence, BrowsePick, BrowseQueryResult, BrowseRoundLog, BrowseVideo } from './browse-types';
import type { Preferences } from './types';
import { bindTraceSignal, recordTraceStep, traceForSignal } from './platform/diagnostics';

export async function selectBrowseBatch(prefs: Preferences, readPreferences: () => Promise<Preferences>, signal: AbortSignal,
  status: (text: string) => void, cooldowns: Map<string,number>) {
  const started = Date.now(), context = browseContext(prefs);
  const logEpoch = browseLogEpoch();
  const log: BrowseRoundLog = { operationId: traceForSignal(signal),at: started,durationMs: 0,sources: [],candidates: 0,checked: 0,accepted: 0,published: 0,cached: 0,
    contextVersion: 2,revision: prefs.revision,requests: [],queries: [],scopes: {},evidence: {},detailed: 0,subtitles: 0,modelCalls: 0,inputTokens: 0,outputTokens: 0,stages: {},plannedQueries: 0,skippedQueries: [],
    candidateEvaluations: 0,skippedEvaluated: 0,discovered: 0,sourceAdded: {},rawChoices: 0,validChoices: 0,disputedCandidates: 0,repairCalls: 0,repairDropped: 0,searchPlanningSkipped: 0 };
  const network = createBrowseNetwork(signal,log.requests!,cooldowns);
  let usageCalls = 0;
  const allowed = (video: BrowseVideo) => !matchGroup(video.title,video.tags,prefs.settings.negative,prefs.settings.exactTags) ||
    (prefs.settings.positiveWins && Boolean(matchGroup(video.title,video.tags,prefs.settings.positive,prefs.settings.exactTags)));
  const ai = async <T>(stage: string, task: string, input: unknown, schema: ZodType, consume: (value: unknown) => T) => {
    const start = Date.now(); log.modelCalls!++;
    const parameters = modelParameters(prefs.settings.browse);
    // 关闭思考时结构化小任务保留充足输出空间，不沿用几十万词元的异常配置。
    const output = prefs.settings.browse.thinking ? parameters : Object.fromEntries(Object.entries(parameters).map(([key,value]) =>
      [key,['max_tokens','max_completion_tokens'].includes(key) ? Math.min(Number(value),8192) : value]));
    try {
      return await requestAI(prefs,prefs.settings.browse,{ ...output,stream: true,
        messages: [{ role: 'system',content: `${browseInstructions}\n${task}` },{ role: 'user',content: JSON.stringify(input) }] },
        bindTraceSignal(AbortSignal.any([signal,AbortSignal.timeout(180000)]),traceForSignal(signal)),consume,'AI帮你刷',{ schema,usage: value => {
          log.inputTokens! += value.inputTokens ?? 0; log.outputTokens! += value.outputTokens ?? 0;
          if (value.inputTokens !== undefined && value.outputTokens !== undefined) usageCalls++;
        } });
    } finally { log.stages![stage] = (log.stages![stage] ?? 0)+Date.now()-start; }
  };
  const ensureContext = async () => { if (browseContext(await readPreferences()) !== context) throw new Error('计划或推荐设置已改变，请重新选片。'); };
  const mark = (videos: BrowseVideo[], field: 'shortlisted' | 'qualified' | 'pooled' | 'published') => {
    for (const video of videos) for (const id of video.queryKeys ?? []) {
      const query = log.queries!.find(item => item.id === id) ?? history.find(item => item.id === id); if (query) query[field]++;
    }
  };
  let accepted: BrowsePick[] = [], history: BrowseQueryResult[] = [], factBatches = 0;
  const cachedIds = new Set<string>();
  try {
    let memory = await readBrowseMemory();
    for (const [family,until] of Object.entries(memory.sourceCooldowns ?? {})) if (until > Date.now()) cooldowns.set(family,Math.max(until,cooldowns.get(family) ?? 0));
    history = memory.context === context ? memory.searches ?? [] : [];
    const watched = new Set((await samples('watched',300)).map(item => item.bvid));
    const eligible = new Set(mergeBrowseCandidates([(memory.context === context ? memory.pool ?? [] : []).map(pick => pick.video)],memory,watched).filter(allowed).map(video => video.bvid));
    accepted = (memory.context === context ? memory.pool ?? [] : []).filter(pick => eligible.has(pick.video.bvid) && started-pick.checkedAt < BROWSE_POOL_AGE);
    for (const pick of accepted) cachedIds.add(pick.video.bvid);
    log.cached = accepted.length;
    const user = { plan: prefs.plan,...(prefs.settings.browse.scopeNote ? { scopeNote: prefs.settings.browse.scopeNote } : {}),
      preferences: prefs.settings.positive,avoid: prefs.settings.negative,
      feedback: memory.feedback.slice(0,40).map(item => ({ title: item.video.title,tags: item.video.tags,vote: item.vote })),
      recentRecommendations: memory.seen.slice(-40).map(item => item.title).filter(Boolean) };
    let profile = memory.context === context ? memory.profile : undefined;
    try {
      status('正在为你挑选视频…');
      profile ??= await ai('profile',browseProfileTask,{ plan: prefs.plan,...(user.scopeNote ? { scopeNote: user.scopeNote } : {}) },browseProfileSchema,value => browseProfileSchema.parse(value));
      signal.throwIfAborted(); await ensureContext();
      memory = await updateBrowseMemory(latest => {
        signal.throwIfAborted();
        const same = latest.context === context;
        return { ...latest,context,profile,items: same ? latest.items : [],updatedAt: same ? latest.updatedAt : 0,
          pool: same ? latest.pool : [],round: (same ? latest.round : 0)+1,queries: same ? latest.queries : [],searches: same ? latest.searches : [] };
      });
      const sources = createBrowseSources(signal,log.sources,cooldowns), considered = new Set(accepted.map(pick => pick.video.bvid));
      const discovered = new Set(considered), evaluated = new Set<string>();
      const available = (family: string) => sources.available(family) && network.available(family);
      const discover = (videos: BrowseVideo[], source: string) => {
        const added = mergeBrowseCandidates([videos],memory,watched).filter(video => allowed(video) && !discovered.has(video.bvid)).length;
        log.discovered! += added; log.sourceAdded![source] = (log.sourceAdded![source] ?? 0)+added;
        for (const video of videos) discovered.add(video.bvid);
        return added;
      };
      const factsInput = (batch: BrowseEvidence[]) => ({ plan: user.plan,scopeNote: user.scopeNote,profile,topics: [...new Set(accepted.map(pick => pick.topic))],
        candidates: batch.map((video,i) => ({ id: `v${i}`,title: video.title,description: video.description,tags: video.tags,duration: video.duration,
          partCount: video.partCount,coverage: video.coverage,checkedPage: video.checkedPage,excerpt: video.excerpt,
          ...(video.chapters ? { chapters: video.chapters.map(({ page,title,duration }) => ({ page,title,duration })) } : { parts: video.parts }) })) });
      const consumeFacts = (value: unknown, batch: BrowseEvidence[]) => {
        const facts = inspectBrowseFacts(value,batch);
        log.rawChoices! += facts.rawCount; log.validChoices! += facts.valid.length;
        for (const choice of facts.valid) {
          log.scopes![choice.scope] = (log.scopes![choice.scope] ?? 0)+1;
          log.evidence![choice.evidence] = (log.evidence![choice.evidence] ?? 0)+1;
        }
        mark(facts.picks.map(pick => pick.video),'qualified'); accepted.push(...facts.picks);
        return facts;
      };
      const liked = memory.feedback.filter(item => item.vote === 1);
      for (let cycle = 0; cycle < 3 && network.remaining && selectBrowsePicks(accepted).length < 12; cycle++) {
        signal.throwIfAborted();
        if (!['home','search',...(liked.length ? ['related'] : [])].some(available)) { log.stopReason = 'sources-unavailable'; break; }
        const acceptedBefore = accepted.length;
        let tasks = [] as ReturnType<typeof prepareBrowseSearches>;
        if (available('search')) {
          const results = browseSearchSummary([...history,...log.queries!]);
          const search = await ai('search',browseSearchTask,{ ...user,profile,cycle,coverage: accepted.map(pick => ({ scope: pick.scopeKey,topic: pick.topic })),
            recentQueries: results.map(item => item.query),results },browseSearchPlanSchema,value => browseSearchPlanSchema.parse(value));
          log.plannedQueries! += search.searches.length;
          tasks = prepareBrowseSearches(search.searches,[...history,...log.queries!],log.skippedQueries!);
        } else log.searchPlanningSkipped!++;
        const firstQuery = log.queries!.length;
        const groups: BrowseVideo[][] = [];
        if (available('home')) {
          const home = await sources.collect('B站推荐','home',() => browseHome(signal,network)); groups.push(home); discover(home,'home');
        }
        for (const [taskIndex,task] of tasks.entries()) {
          if (!available('search')) {
            log.skippedQueries!.push(...tasks.slice(taskIndex).map(item => ({ query: item.query,reason: (cooldowns.get('search') ?? 0) > Date.now() ? 'cooldown' : 'budget' }))); break;
          }
          const start = Date.now(), sourceIndex = log.sources.length, requestIndex = log.requests!.length;
          const page = browseQueryPage([...history,...log.queries!],task);
          const query: BrowseQueryResult = { ...task,id: crypto.randomUUID(),key: browseQueryKey(task),page,at: start,ok: false,errorKind: 'pending',durationMs: 0,
            returned: 0,rawReturned: 0,added: 0,filtered: 0,shortlisted: 0,qualified: 0,pooled: 0,published: 0 };
          log.queries!.push(query);
          let videos: BrowseVideo[];
          try { videos = await sources.collect(`搜索：${task.query}`,'search',() => browseSearch(task.query,task.order,page,signal,network)); }
          catch (error) { query.sent = log.requests!.slice(requestIndex).some(item => item.kind === 'search' && item.sent); query.durationMs = Date.now()-start; query.errorKind = signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled'; throw error; }
          const outcome = log.sources.slice(sourceIndex).at(-1);
          const response = log.requests!.slice(requestIndex).findLast(item => item.kind === 'search' && !item.error);
          const valid = mergeBrowseCandidates([videos],memory,watched), permitted = valid.filter(allowed);
          Object.assign(query,{
            sent: log.requests!.slice(requestIndex).some(item => item.kind === 'search' && item.sent),
            ok: outcome?.kind === 'success' || outcome?.kind === 'empty',errorKind: ['success','empty'].includes(outcome?.kind ?? '') ? undefined : outcome?.kind,
            durationMs: Date.now()-start,returned: videos.length,rawReturned: response?.count ?? videos.length,
            added: discover(videos,'search'),
            filtered: (response?.count ?? videos.length)-videos.length+valid.length-permitted.length });
          groups.push(videos.map(video => ({ ...video,queryKeys: [query.id] })));
        }
        const attempted = log.queries!.slice(firstQuery).filter(query => query.sent || query.ok).map(query => query.query);
        if (attempted.length) await updateBrowseMemory(latest => { signal.throwIfAborted(); return { ...latest,queries: [...latest.queries,...attempted] }; });
        if (liked.length && available('related')) {
          const related = await sources.collect('点赞关联','related',() => browseRelated(liked[(memory.round+cycle-1)%liked.length]!.video.bvid,signal,network));
          groups.push(related); discover(related,'related');
        }
        const latest = await readBrowseMemory();
        const merged = mergeBrowseCandidates(groups,latest,watched).filter(allowed);
        log.skippedEvaluated! += merged.filter(video => evaluated.has(video.bvid)).length;
        const candidates = merged.filter(video => !considered.has(video.bvid) && !evaluated.has(video.bvid)).slice(0,100);
        log.candidates += candidates.length;
        if (!candidates.length) { if (!available('search')) { log.stopReason = 'no-new-candidates'; break; } continue; }
        if (!network.remaining) break;
        for (const video of candidates) evaluated.add(video.bvid);
        log.candidateEvaluations! += candidates.length;
        const shortlist = await ai('shortlist','从真实候选中选择最多18条值得核验的内容，按价值排序。保留不同主题与互补角度，不规定长短比例。只输出 {"ids":["v0"]}，允许为空。',
          { plan: user.plan,scopeNote: user.scopeNote,profile,preferences: user.preferences,feedback: user.feedback,
            candidates: candidates.map((video,i) => ({ id: `v${i}`,title: video.title,tags: video.tags,description: video.description.slice(0,500),
            duration: video.duration,sources: video.sources })) },browseShortlistSchema,value => browseShortlistSchema.parse(value));
        const selected = resolveBrowseIds(shortlist.ids,candidates);
        mark(selected,'shortlisted');
        const evidence: BrowseEvidence[] = [];
        await Promise.all([0,1].map(async worker => {
          for (let i = worker; i < selected.length && network.remaining; i += 2) {
            signal.throwIfAborted();
            const video = selected[i]!; considered.add(video.bvid);
            try { const detail = await browseEvidence(video,signal,network); if (allowed(detail)) evidence[i] = detail; }
            catch (error) { signal.throwIfAborted(); log.sources.push({ source: `详情：${video.bvid}`,attempt: 1,count: 0,error: (error as Error).message.slice(0,240) }); }
            log.checked++;
          }
        }));
        const detailed = evidence.filter(Boolean); log.detailed! += detailed.length; log.subtitles! += detailed.filter(video => video.excerpt).length;
        for (let offset = 0; offset < detailed.length; offset += 6) {
          const batch = detailed.slice(offset,offset+6);
          const facts = await ai('facts',browseFactsTask,factsInput(batch),browseFactsSchema,value => consumeFacts(value,batch));
          factBatches++;
          if (facts.disputed.length) {
            const disputed = facts.disputed.map(index => batch[index]!);
            log.disputedCandidates! += disputed.length; log.repairCalls!++;
            try {
              const repaired = await ai('facts-repair',`${browseFactsTask}\n本次仅修正之前编号缺失、重复或分P不存在的候选。每个候选必须恰好一个判断，只能选择一个入口；无法确认时标unknown或insufficient，不能同时推荐多个分P。`,
                factsInput(disputed),browseFactsSchema,value => consumeFacts(value,disputed));
              log.repairDropped! += repaired.disputed.length;
            } catch (error) {
              if (signal.aborted) throw error;
              log.repairDropped! += disputed.length;
              log.error = [log.error,`核验修正：${(error as Error).message}`].filter(Boolean).join('；');
            }
          }
        }
        if (!available('search') && accepted.length === acceptedBefore) { log.stopReason = 'no-qualified-progress'; break; }
      }
    } catch (error) {
      log.error = (error as Error).message;
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw error;
      if (!selectBrowsePicks(accepted).length) throw error;
    }
    await ensureContext();
    if (signal.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
    if (accepted.length > 1 && (accepted.length > 12 || factBatches > 1) && factBatches && !signal.aborted) {
      accepted = fallbackBrowseRanking(accepted);
      try {
        accepted = await ai('ranking',browseGlobalTask,{ ...user,profile,candidates: accepted.map((pick,i) => ({
          id: `v${i}`,title: pick.video.title,description: pick.video.description.slice(0,300),author: pick.video.author,
          duration: pick.video.entry?.duration || pick.video.duration,entry: pick.video.entry,topic: pick.topic,scopeKey: pick.scopeKey,
          contentType: pick.contentType,evidence: pick.evidence ?? 'legacy',partCount: pick.video.partCount })) },
        browseGlobalSchema,value => rankBrowsePicks(value,accepted));
      } catch (error) {
        if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw error;
        log.error = [log.error,`全局排序：${(error as Error).message}`].filter(Boolean).join('；');
      }
    }
    await ensureContext();
    const saved = await updateBrowseMemory(latest => {
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
      const rejected = new Set(latest.feedback.filter(item => item.vote === -1).map(item => item.video.bvid));
      accepted = accepted.filter(pick => !rejected.has(pick.video.bvid));
      const picks = selectBrowsePicks(accepted), ids = new Set(picks.map(pick => pick.video.bvid)), now = Date.now();
      log.accepted = accepted.length; log.published = picks.length; log.unselected = accepted.length-picks.length;
      mark(picks.map(pick => pick.video),'published'); mark(accepted.filter(pick => !ids.has(pick.video.bvid) && !cachedIds.has(pick.video.bvid)).map(pick => pick.video),'pooled');
      return { ...latest,context,items: picks.length ? picks.map(pick => pick.video) : latest.items,updatedAt: picks.length ? now : latest.updatedAt,
        pool: accepted.filter(pick => !ids.has(pick.video.bvid)),seen: [...latest.seen,...picks.map(pick => ({ bvid: pick.video.bvid,title: pick.video.title,at: now }))] };
    });
    return log.published ? '' : saved.items.length ? '暂时没有选出合适的新内容，可以稍后换一批。' : '暂时没有选出合适的内容，可以稍后再试。';
  } catch (error) {
    log.error = (error as Error).message; throw error;
  } finally {
    log.durationMs = Date.now()-started;
    log.sourceCooldowns = Object.fromEntries([...cooldowns].filter(([,until]) => until > Date.now()));
    log.usageComplete = usageCalls === log.modelCalls;
    await updateBrowseMemory(memory => ({ ...memory,sourceCooldowns: log.sourceCooldowns,logs: logEpoch === browseLogEpoch() ? [...(memory.logs ?? []),log] : memory.logs,
      searches: memory.context === context ? [...history,...log.queries!] : memory.searches }));
    await recordTraceStep(signal, `选片汇总：发布${log.published}条，候选${log.candidates}条，核验${log.checked}条`, log.error || !log.published ? 'warn' : 'info', {
      published: log.published, candidates: log.candidates, checked: log.checked, modelCalls: log.modelCalls ?? 0,
      cached: log.cached, inputTokens: log.inputTokens ?? 0, outputTokens: log.outputTokens ?? 0,
    });
  }
}
