// 校验速读引用与去重推荐，将模型短编号恢复为真实评论编号。
import type { CommentRecord } from '../comment-types';
export function parseQuickRead(value: unknown, comments: CommentRecord[], count: number, references: ReadonlyMap<string,string> = new Map(comments.map(comment => [comment.id,comment.id]))) {
  const data = value as { summary?: unknown; topics?: { title?: unknown; summary?: unknown; refs?: unknown }[]; valuable?: { id?: unknown; reason?: unknown }[] };
  if (!data || typeof data.summary !== 'string' || !data.summary.trim() || !Array.isArray(data.topics) || data.topics.length > 6 || !Array.isArray(data.valuable)) throw new Error('速读结果格式不完整，请手动重试。');
  const ids = new Set(comments.map(comment => comment.id));
  const resolve = (ref: unknown) => {
    const id = typeof ref === 'string' ? references.get(ref) : undefined;
    return id && ids.has(id) ? id : undefined;
  };
  const topics = data.topics.map(topic => {
    if (typeof topic.title !== 'string' || typeof topic.summary !== 'string' || !Array.isArray(topic.refs) || !topic.refs.length) throw new Error('模型引用了未参与分析的评论，未保存结果。');
    const refs = topic.refs.map(resolve);
    if (refs.some(id => id === undefined)) throw new Error('模型引用了未参与分析的评论，未保存结果。');
    return { title: topic.title, summary: topic.summary, refs: [...new Set(refs as string[])] };
  });
  const seen = new Set<string>();
  const valuable = data.valuable.map(item => {
    const id = resolve(item.id);
    if (!id || typeof item.reason !== 'string') throw new Error('模型推荐了不存在的评论，未保存结果。');
    return { id, reason: item.reason };
  }).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0,count);
  const referenced = new Set([...valuable.map(item => item.id), ...topics.flatMap(topic => topic.refs)]);
  return { summary: data.summary, topics, valuable, sources: comments.filter(comment => referenced.has(comment.id)) };
}
