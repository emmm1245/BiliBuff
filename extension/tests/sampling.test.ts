// 验证动态候选范围、秒级聚集抑制、内容覆盖及缺标签时的屏蔽采样行为。
import { expect, test } from 'vitest';
import { blockedCandidateLimit, selectBlockedSamples } from '../src/sampling';
import type { VideoEvent } from '../src/types';

function video(bvid: string, title: string, at: number, tags: string[] | null = null): VideoEvent {
  return { kind: 'blocked', bvid, title, at, tags, reason: '' };
}

test('候选范围随数量增长而边际递减，超过500后仍增长', () => {
  expect([25, 100, 400, 900].map(blockedCandidateLimit)).toEqual([225, 500, 1200, 2100]);
  const increments = [25, 100, 400].map(count => blockedCandidateLimit(count + 25) - blockedCandidateLimit(count));
  expect(increments[0]).toBeGreaterThan(increments[1]!);
  expect(increments[1]).toBeGreaterThan(increments[2]!);
  expect(blockedCandidateLimit(1000)).toBe(2265);
});

test('仅使用动态范围内最近记录，不扩到更早历史，数量不足时返回全部', () => {
  const records = Array.from({ length: 42 }, (_, i) => video(`BV${i}`, '矩阵计算基础', i * 1000));
  records[0] = video('BVoutside', '英语听力练习', 0);
  expect(selectBlockedSamples(records, 1)).not.toContain(records[0]);
  expect(selectBlockedSamples(records.slice(0, 3), 5)).toHaveLength(3);
  expect(selectBlockedSamples([], 5)).toEqual([]);
});

test('一批近似游戏内容不能挤掉候选中其他有代表性的主题，缺标签也能选取', () => {
  const records = Array.from({ length: 60 }, (_, i) => video(`BVgame${i}`, '游戏高能操作片段', 100000 + i * 20));
  const titles = ['英语单词记忆方法', '线性代数矩阵课程', '厨房炒菜做法', '摄影器材选购教程'];
  titles.forEach((title, group) => {
    for (let i = 0; i < 3; i++) records.push(video(`BVtopic${group}${i}`, title, 50000 - group * 10000 - i * 5000));
  });
  const selected = selectBlockedSamples(records, 5);
  expect(new Set(selected.map(record => record.title))).toEqual(new Set(['游戏高能操作片段', ...titles]));
});

test('相同内容优先保留时间分散的代表，懒加载间隔不需要固定分桶', () => {
  const records = [video('BVlatest', '矩阵计算基础', 101000), video('BVnear', '矩阵计算基础', 100000), video('BVearlier', '矩阵计算基础', 0)];
  expect(selectBlockedSamples(records, 2).map(record => record.bvid)).toEqual(['BVlatest', 'BVearlier']);
});

test('内容不同而仅共享宽泛标签时，时间接近不会触发聚集降权', () => {
  const titles = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  const close = titles.map((title, i) => video(`BV${i}`, title, 1000 - i, ['热门']));
  const distant = close.map((record, i) => ({ ...record, at: 100000 - i * 10000 }));
  expect(selectBlockedSamples(close, 3).map(record => record.bvid)).toEqual(selectBlockedSamples(distant, 3).map(record => record.bvid));
});

test('已有标签辅助区分标题相同但主题不同的视频', () => {
  const records = Array.from({ length: 5 }, (_, i) => video(`BVmath${i}`, '跨领域学习路线', 1000, ['数学']));
  records.push(video('BVenglish', '跨领域学习路线', 1000, ['英语']));
  expect(new Set(selectBlockedSamples(records, 2).flatMap(record => record.tags!))).toEqual(new Set(['数学', '英语']));
});

test('代表性防止最新的孤立噪声成为唯一样本', () => {
  const records = Array.from({ length: 12 }, (_, i) => video(`BVmath${i}`, '矩阵计算基础', i * 10000));
  records.push(video('BVnoise', 'xyz', 200000));
  expect(selectBlockedSamples(records, 1)[0]!.title).toBe('矩阵计算基础');
});

test('选样数量准确、可重复，不修改原始记录或时间', () => {
  const records = Array.from({ length: 80 }, (_, i) => video(`BV${i}`, `矩阵运算练习 ${i}`, i * 1000, ['数学']));
  const before = structuredClone(records);
  const selected = selectBlockedSamples(records, 20);
  expect(selected).toHaveLength(20); expect(new Set(selected.map(record => record.bvid)).size).toBe(20);
  expect(selectBlockedSamples(records, 20)).toEqual(selected);
  expect(records).toEqual(before);
});

test('最大设置可从2265条候选选出1000条，不受旧500条范围限制', () => {
  const records = Array.from({ length: 2265 }, (_, i) => video(`BVlarge${i}`, `topic${i % 20} lesson${i}`, 100000 + i * 10, [`主题${i % 20}`]));
  const selected = selectBlockedSamples(records, 1000);
  expect(selected).toHaveLength(1000);
  expect(new Set(selected.map(record => record.bvid)).size).toBe(1000);
  expect(selected.some(record => record.at < records[1765]!.at)).toBe(true);
});
