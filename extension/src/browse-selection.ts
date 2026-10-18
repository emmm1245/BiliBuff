// 按通用计划融合来源、分批核验并补充小型待推荐池，成功时隐藏内部来源故障。
import type { ZodType } from 'zod';
import { requestAI } from './ai-request';
import { modelParameters } from './core';
import { matchGroup } from './filter/rules';
import { samples } from './database';
import { browseEvidence, browseHome, browseRelated, browseSearch } from './browse-api';
import { browseContext, browseFactsSchema, browseFactsTask, browseInstructions, browsePicks, browseProfileSchema, browseProfileTask,
  browseQueriesSchema, browseShortlistSchema, mergeBrowseCandidates, resolveBrowseIds, selectBrowsePicks } from './browse-ranking';
import { BROWSE_POOL_AGE, readBrowseMemory, updateBrowseMemory } from './browse-store';
import { createBrowseSources } from './browse-sources';
import type { BrowseEvidence, BrowsePick, BrowseRoundLog, BrowseVideo } from './browse-types';
import type { Preferences } from './types';

export async function selectBrowseBatch(prefs: Preferences, readPreferences: () => Promise<Preferences>, signal: AbortSignal,
  status: (text: string) => void, cooldowns: Map<string,number>) {
  const started = Date.now(), context = browseContext(prefs);
  const log: BrowseRoundLog = { at: started,durationMs: 0,sources: [],candidates: 0,checked: 0,accepted: 0,published: 0,cached: 0 };
  const allowed = (video: BrowseVideo) => !matchGroup(video.title,video.tags,prefs.settings.negative,prefs.settings.exactTags) ||
    (prefs.settings.positiveWins && Boolean(matchGroup(video.title,video.tags,prefs.settings.positive,prefs.settings.exactTags)));
  const ai = <T>(task: string, input: unknown, schema: ZodType, consume: (value: unknown) => T) =>
    requestAI(prefs,prefs.settings.browse,{ ...modelParameters(prefs.settings.browse),stream: true,
      messages: [{ role: 'system',content: `${browseInstructions}\n${task}` },{ role: 'user',content: JSON.stringify(input) }] },
      AbortSignal.any([signal,AbortSignal.timeout(180000)]),consume,'AI帮你刷',{ schema });
  const ensureContext = async () => { if (browseContext(await readPreferences()) !== context) throw new Error('计划或推荐设置已改变，请重新选片。'); };
  let accepted: BrowsePick[] = [];
  try {
    let memory = await readBrowseMemory();
    const watched = new Set((await samples('watched',300)).map(item => item.bvid));
    const eligible = new Set(mergeBrowseCandidates([(memory.context === context ? memory.pool ?? [] : []).map(pick => pick.video)],memory,watched).filter(allowed).map(video => video.bvid));
    accepted = (memory.context === context ? memory.pool ?? [] : []).filter(pick => eligible.has(pick.video.bvid) && started-pick.checkedAt < BROWSE_POOL_AGE);
    log.cached = accepted.length;
    const user = { plan: prefs.plan,preferences: prefs.settings.positive,avoid: prefs.settings.negative,
      feedback: memory.feedback.slice(0,40).map(item => ({ title: item.video.title,tags: item.video.tags,vote: item.vote })),
      recentRecommendations: memory.seen.slice(-40).map(item => item.title).filter(Boolean) };
    try {
      status('正在为你挑选视频…');
      const profile = memory.context === context && memory.profile ? memory.profile :
        await ai(browseProfileTask,{ plan: prefs.plan },browseProfileSchema,value => browseProfileSchema.parse(value));
      signal.throwIfAborted(); await ensureContext();
      memory = await updateBrowseMemory(latest => {
        signal.throwIfAborted();
        const same = latest.context === context;
        return { ...latest,context,profile,items: same ? latest.items : [],updatedAt: same ? latest.updatedAt : 0,
          pool: same ? latest.pool : [],round: (same ? latest.round : 0)+1,queries: same ? latest.queries : [] };
      });
      const sources = createBrowseSources(signal,log.sources,cooldowns), considered = new Set(accepted.map(pick => pick.video.bvid));
      const backlog: BrowseVideo[] = [];
      const liked = memory.feedback.filter(item => item.vote === 1);
      for (let cycle = 0; cycle < 3 && selectBrowsePicks(accepted).length < 12; cycle++) {
        signal.throwIfAborted();
        const search = await ai(`生成最多4个不同的B站搜索词，紧扣计划边界与偏好。参考近期方向、已推荐标题、本轮供给结果轮换角度；不要为补数量越出计划。只输出 {"queries":["搜索词"]}。`,
          { ...user,profile,recentQueries: memory.queries,cycle,supply: { accepted: accepted.length,checked: log.checked,sourceFailures: log.sources.filter(item => item.error).length } },
          browseQueriesSchema,value => browseQueriesSchema.parse(value));
        const queries = [...new Set(search.queries)];
        await updateBrowseMemory(latest => { signal.throwIfAborted(); return { ...latest,queries: [...latest.queries,...queries] }; });
        memory.queries = [...memory.queries,...queries].slice(-40);
        status('正在为你挑选视频…');
        const groups: BrowseVideo[][] = [backlog];
        groups.push(await sources.collect('B站推荐','home',() => browseHome(signal)));
        const page = ((memory.round-1)*3+cycle)%5+1;
        for (const query of queries) groups.push(await sources.collect(`搜索：${query}`,'search',() => browseSearch(query,'totalrank',page,signal)));
        groups.push(await sources.collect(`最新投稿：${queries[cycle%queries.length]}`,'search',() => browseSearch(queries[cycle%queries.length]!,'pubdate',1,signal)));
        if (liked.length) groups.push(await sources.collect('点赞关联','related',() => browseRelated(liked[(memory.round+cycle-1)%liked.length]!.video.bvid,signal)));
        const latest = await readBrowseMemory();
        const candidates = mergeBrowseCandidates(groups,latest,watched).filter(video => !considered.has(video.bvid) && allowed(video)).slice(0,100);
        log.candidates += candidates.length;
        if (!candidates.length) { if (!sources.remaining) break; continue; }
        status('正在为你挑选视频…');
        const shortlist = await ai('从真实候选中选择最多18条值得核验的内容，按价值排序。结合时长和标题保留不同形式与角度，不规定长短比例。只输出 {"ids":["v0"]}，允许为空。',
          { ...user,profile,candidates: candidates.map((video,i) => ({ id: `v${i}`,...video })) },browseShortlistSchema,value => browseShortlistSchema.parse(value));
        const selected = resolveBrowseIds(shortlist.ids,candidates), selectedIds = new Set(selected.map(video => video.bvid));
        backlog.splice(0,backlog.length,...candidates.filter(video => !selectedIds.has(video.bvid)));
        const evidence: BrowseEvidence[] = [];
        await Promise.all([0,1].map(async worker => {
          for (let i = worker; i < selected.length; i += 2) {
            signal.throwIfAborted();
            const video = selected[i]!; considered.add(video.bvid);
            status('正在为你挑选视频…');
            try { const detail = await browseEvidence(video,signal); if (allowed(detail)) evidence[i] = detail; }
            catch (error) { signal.throwIfAborted(); log.sources.push({ source: `详情：${video.bvid}`,attempt: 1,count: 0,error: (error as Error).message.slice(0,240) }); }
            log.checked++;
          }
        }));
        const detailed = evidence.filter(Boolean);
        // 完整目录按视频分组发送；字幕始终仅来自第一P，不额外遍历分P。
        for (let offset = 0; offset < detailed.length; offset += 6) {
          const batch = detailed.slice(offset,offset+6);
          status('正在为你挑选视频…');
          accepted.push(...await ai(browseFactsTask,{ ...user,profile,topics: [...new Set(accepted.map(pick => pick.topic))],
            candidates: batch.map((video,i) => ({ id: `v${i}`,...video,parts: video.chapters ? undefined : video.parts,
              chapters: video.chapters?.map(({ page,title,duration }) => ({ page,title,duration })) })) },browseFactsSchema,value => browsePicks(value,batch)));
        }
      }
    } catch (error) {
      log.error = (error as Error).message;
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw error;
      // 后续来源或模型故障不覆盖本轮已经取得的合格新内容。
      if (!selectBrowsePicks(accepted).length) throw error;
    }
    await ensureContext();
    if (signal.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
    const saved = await updateBrowseMemory(latest => {
      if (signal.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
      const rejected = new Set(latest.feedback.filter(item => item.vote === -1).map(item => item.video.bvid));
      accepted = accepted.filter(pick => !rejected.has(pick.video.bvid));
      const picks = selectBrowsePicks(accepted), ids = new Set(picks.map(pick => pick.video.bvid)), now = Date.now();
      log.accepted = accepted.length; log.published = picks.length;
      return { ...latest,context,items: picks.length ? picks.map(pick => pick.video) : latest.items,updatedAt: picks.length ? now : latest.updatedAt,
        pool: accepted.filter(pick => !ids.has(pick.video.bvid)),seen: [...latest.seen,...picks.map(pick => ({ bvid: pick.video.bvid,title: pick.video.title,at: now }))] };
    });
    return log.published ? '' : saved.items.length ? '暂时没有选出合适的新内容，可以稍后换一批。' : '暂时没有选出合适的内容，可以稍后再试。';
  } catch (error) {
    log.error = (error as Error).message;
    throw error;
  } finally {
    log.durationMs = Date.now()-started;
    await updateBrowseMemory(memory => ({ ...memory,logs: [...(memory.logs ?? []),log] }));
    console.info('AI帮你刷选片',log);
  }
}
