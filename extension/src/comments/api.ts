// 读取并规范化B站评论接口响应，识别站点限流而不触发模型。
import type { CommentPage, CommentRecord } from '../comment-types';
interface RawComment {
  rpid_str: string; root_str: string; parent_str: string; ctime: number; like: number; rcount: number; invisible?: boolean;
  member?: { uname?: string }; content: { message: string }; replies?: RawComment[];
}
export interface ReplyData {
  replies?: RawComment[]; top_replies?: RawComment[];
  cursor?: { all_count: number; is_end: boolean; pagination_reply?: { next_offset?: string } };
  page?: { count: number; num: number; size: number }; control?: { web_selection?: boolean };
}
const API = 'https://api.bilibili.com';
export class CommentReadLimit extends Error {
  constructor(message: string, readonly until: number) { super(message); }
}
function record(raw: RawComment): CommentRecord {
  return { id: raw.rpid_str, root: raw.root_str, parent: raw.parent_str, author: raw.member?.uname || '', text: raw.content.message,
    time: raw.ctime, likes: raw.like, replies: raw.rcount || 0 };
}
export async function commentJSON<T>(path: string) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const message = `评论读取失败（HTTP ${response.status}），请稍后手动重试。`;
    if ([429,403,412].includes(response.status)) {
      const retry = response.headers.get('Retry-After');
      const until = retry && /^\d+$/.test(retry) ? Date.now()+Number(retry)*1000 : retry ? Date.parse(retry) : 0;
      throw new CommentReadLimit(message,until > Date.now() ? until : Date.now()+60000);
    }
    throw new Error(message);
  }
  const json = await response.json() as { code: number; message?: string; data: T };
  if (json.code !== 0) {
    const message = `评论读取失败（${json.code}）：${json.message || '站点拒绝请求'}。请检查登录状态；出现访问限制时请稍后重试。`;
    if ([-412,-352].includes(json.code)) throw new CommentReadLimit(message,Date.now()+60000);
    throw new Error(message);
  }
  return json.data;
}
export function commentPage(data: ReplyData): CommentPage {
  const roots = [...(data.top_replies || []), ...(data.replies || [])].filter(raw => !raw.invisible);
  const comments = new Map<string, CommentRecord>();
  for (const raw of roots) {
    comments.set(raw.rpid_str, record(raw));
    for (const reply of raw.replies || []) if (!reply.invisible) comments.set(reply.rpid_str, record(reply));
  }
  return { comments: [...comments.values()], expected: data.cursor?.all_count ?? data.page?.count ?? 0,
    end: data.cursor?.is_end ?? Boolean(data.page && data.page.num * data.page.size >= data.page.count),
    offset: data.cursor?.pagination_reply?.next_offset || '', pageSize: data.page?.size ?? 20, selected: data.control?.web_selection === true };
}
