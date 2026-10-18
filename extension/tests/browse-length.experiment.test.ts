// 复现2026-10-18四类真实合格候选的时长对照，均衡仅在本实验内运行。
import { expect, test } from 'vitest';
import { selectBrowsePicks } from '../src/browse-ranking';
import type { BrowsePick, BrowseVideo } from '../src/browse-types';

// 每行依次是视频编号、实际入口时长、作者编号、同义主题分组；不保留字幕或个人计划。
const samples: { name: string; items: [string,number,string,number][]; baseline: number[]; balanced: number[] }[] = [
  {"name":"当前计划","items":[["BV1icaxz8EXN",3542,"3537112016095986",0],["BV1zruMzfET1",160111,"3546886866733693",1],["BV1Uu4y1h7J6",103679,"3461567645485060",2],["BV1isyhYAEEj",105322,"377718669",3],["BV1VE411A7Ak",41975,"360996402",4],["BV1Xbpy66EDW",246,"3546932618201708",5],["BV1Cchv67E5V",203,"3537112016095986",6],["BV1tZGF62Ezg",7613,"10322779",7],["BV12YpK6WE8q",584,"3546788170566037",8],["BV19q1uYBEuK",1281,"377718669",9],["BV1t9Ww67Eue",237,"360996402",10],["BV1Vk4y1m734",1665,"102003312",4],["BV12yJq6iERT",5352,"152023728",11],["BV1PCJy6nEVr",1159,"3546788170566037",12]],"baseline":[3,1,8],"balanced":[3,2,7]},
  {"name":"手机摄影","items":[["BV1MG4y1d722",2129,"353633862",0],["BV15W411c7S7",495,"294081438",1],["BV1YcPxzpETi",729,"455727",2],["BV1Qf4y1h7h7",488,"7601439",3],["BV1UBuq65EgZ",745,"455727",4],["BV1zdKHeiEEa",375,"3493080120429514",5],["BV1XPKf6KEC9",76,"9427781",6]],"baseline":[2,4,1],"balanced":[2,4,1]},
  {"name":"家常菜","items":[["BV1PW411T7YB",165,"216156027",0],["BV1gY411C7BY",908,"21950148",1],["BV11ZbZ6SEv3",292,"1376187314",2],["BV1Py4y1S7EF",503,"290526283",3],["BV1MfpwzcEKA",306,"560445045",4],["BV1SW4y1h7Jm",571,"517968580",5],["BV1SW4y1f7Tc",175,"403940805",0],["BV1xsyMB5EWv",799,"2110558507",1],["BV1ZzNwzwE5W",185,"3706941681437570",4],["BV1iL411t7SJ",205,"502299736",3],["BV1mb421B7B7",333,"514273130",0],["BV12M4m167vk",382,"578088014",1],["BV1L7bi6BE8V",393,"348475622",2]],"baseline":[8,4,0],"balanced":[8,4,0]},
  {"name":"古建筑","items":[["BV1tYQPYtEuc",3139,"543965879",0],["BV1bR4mzNE9G",11878,"87610561",1],["BV1iFVK6yEzN",930,"59085192",2],["BV1sQZNBKEit",1267,"3493269694581730",3],["BV1BarbBEErG",1422,"146909411",4],["BV1mE421w7Vg",690,"326427334",5],["BV1ZbxSe4EXm",1613,"102584256",0],["BV1jDG76LE2z",677,"26400705",0],["BV15F4m1A7k2",483,"244576403",6]],"baseline":[0,4,5],"balanced":[0,4,5]}
];
function length(video: BrowseVideo) {
  const seconds = video.entry?.duration || video.duration;
  return seconds <= 0 ? 'unknown' : seconds < 420 ? 'short' : seconds < 1200 ? 'medium' : 'long';
}
function balanced(picks: BrowsePick[]) {
  const result: BrowsePick[] = [], authors = new Map<string,number>(), topics = new Map<string,number>(), lengths = new Map<string,number>();
  const remaining = [...picks];
  while (result.length < 12 && remaining.length) {
    const penalty = (pick: BrowsePick, rank: number) => rank + (length(pick.video) === 'unknown' ? 0 : (lengths.get(length(pick.video)) ?? 0)*2);
    const index = remaining.reduce((best,pick,i) => penalty(pick,i) < penalty(remaining[best]!,best) ? i : best,0);
    const pick = remaining.splice(index,1)[0]!, author = pick.video.authorId || pick.video.author || pick.video.bvid;
    if ((authors.get(author) ?? 0) >= 2 || (topics.get(pick.topic) ?? 0) >= 3) continue;
    result.push(pick); authors.set(author,(authors.get(author) ?? 0)+1); topics.set(pick.topic,(topics.get(pick.topic) ?? 0)+1);
    lengths.set(length(pick.video),(lengths.get(length(pick.video)) ?? 0)+1);
  }
  return result;
}
function counts(picks: BrowsePick[]) {
  return ['short','medium','long'].map(bucket => picks.filter(pick => length(pick.video) === bucket).length);
}
for (const sample of samples) test(`真实合格候选时长对照：${sample.name}`, () => {
  const picks: BrowsePick[] = sample.items.map(([bvid,duration,authorId,topic]) => ({ checkedAt: 1,topic: String(topic),
    video: { bvid,title: bvid,duration,authorId,author: '',cover: '',published: 0,description: '',tags: [],sources: ['search'] } }));
  const baseline = selectBrowsePicks(picks), experiment = balanced(picks);
  expect(counts(baseline)).toEqual(sample.baseline); expect(counts(experiment)).toEqual(sample.balanced);
  expect(experiment).toHaveLength(baseline.length);
});
test('7分钟和20分钟边界；分P按实际入口时长，单一时长也不凑配额', () => {
  const video = { bvid: 'BVboundary',duration: 1 } as BrowseVideo;
  expect([419,420,1199,1200].map(duration => length({ ...video,duration }))).toEqual(['short','medium','medium','long']);
  expect(length({ ...video,duration: 50000,entry: { page: 2,title: '章节',duration: 600 } })).toBe('medium');
  const picks = Array.from({ length: 12 },(_,i) => ({ video: { bvid: String(i),authorId: String(i),duration: 1800 } as BrowseVideo,topic: String(i),checkedAt: 1 }));
  expect(balanced(picks)).toHaveLength(12);
});

