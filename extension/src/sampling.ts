// 按平方根候选范围、标题标签相似度和秒级聚集降权选取屏蔽样本。
import { normalize } from './core';
import type { VideoEvent } from './types';

export function blockedCandidateLimit(count: number) {
  return Math.ceil(count + 40 * Math.sqrt(count));
}

function titleTerms(title: string) {
  return (normalize(title.slice(0, 300)).match(/\p{Script=Han}+|[\p{Script=Latin}\p{N}]+/gu) ?? []).flatMap(part => {
    if (!/^\p{Script=Han}+$/u.test(part) || part.length === 1) return [part];
    return Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2));
  });
}

function vectors(documents: string[][]) {
  const frequency = new Map<string, number>();
  for (const terms of documents) for (const term of new Set(terms)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  return documents.map(terms => {
    const vector = new Map<string, number>();
    for (const term of terms) vector.set(term, (vector.get(term) ?? 0) + 1);
    let norm = 0;
    for (const [term, count] of vector) {
      const value = (1 + Math.log(count)) * Math.log(1 + documents.length / (1 + frequency.get(term)!));
      vector.set(term, value); norm += value * value;
    }
    norm = Math.sqrt(norm);
    for (const [term, value] of vector) vector.set(term, value / norm);
    return vector;
  });
}

function cosine(left: Map<string, number>, right: Map<string, number>) {
  if (left.size > right.size) [left, right] = [right, left];
  let similarity = 0;
  for (const [term, weight] of left) similarity += weight * (right.get(term) ?? 0);
  return Math.min(1, similarity);
}

function temporalOverlap(similarity: number, interval: number) {
  // 仅共享宽泛标签不足以触发聚集降权；时间影响连续衰减，避免固定分桶和链式串联。
  return Math.max(0, (similarity - .5) * 2) ** 2 * Math.exp(-Math.abs(interval) / 2000);
}

export function selectBlockedSamples(records: VideoEvent[], count: number): VideoEvent[] {
  const recent = [...records].sort((left, right) => right.at - left.at).slice(0, blockedCandidateLimit(count));
  if (recent.length <= count) return recent;
  const size = recent.length;
  const titles = vectors(recent.map(record => titleTerms(record.title)));
  const tags = vectors(recent.map(record => [...new Set((record.tags ?? []).slice(0, 40).map(tag => normalize(tag.slice(0, 80))).filter(Boolean))]));
  const similarities = Array.from({ length: size }, () => new Float32Array(size));
  const density = new Float64Array(size).fill(1);
  for (let i = 0; i < size; i++) {
    similarities[i]![i] = 1;
    for (let j = 0; j < i; j++) {
      const title = cosine(titles[i]!, titles[j]!);
      const similarity = tags[i]!.size && tags[j]!.size ? .7 * title + .3 * cosine(tags[i]!, tags[j]!) : title;
      similarities[i]![j] = similarities[j]![i] = similarity;
      const overlap = temporalOverlap(similarity, recent[i]!.at - recent[j]!.at);
      density[i] = density[i]! + overlap; density[j] = density[j]! + overlap;
    }
  }
  // 先压低短时重复记录的统计贡献，再计算代表性，避免一批推荐靠数量支配样本。
  const weights = density.map(value => 1 / value);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const quality = recent.map((_, i) => {
    let representative = 0;
    for (let j = 0; j < size; j++) representative += similarities[i]![j]! * weights[j]!;
    return .35 * representative / totalWeight + .05 * (1 - i / size);
  });
  const redundancy = new Float64Array(size);
  const bursts = new Float64Array(size);
  const selected = new Uint8Array(size);
  const result: VideoEvent[] = [];
  while (result.length < count) {
    let best = -1, highest = -Infinity;
    for (let i = 0; i < size; i++) {
      if (selected[i]) continue;
      const score = quality[i]! - .6 * redundancy[i]! - .15 * Math.log1p(bursts[i]!);
      if (score > highest) { best = i; highest = score; }
    }
    selected[best] = 1; result.push(recent[best]!);
    for (let i = 0; i < size; i++) {
      const similarity = similarities[i]![best]!;
      redundancy[i] = Math.max(redundancy[i]!, similarity);
      bursts[i] = bursts[i]! + temporalOverlap(similarity, recent[i]!.at - recent[best]!.at);
    }
  }
  return result;
}
