// 按AI Elements的Message组合模式显示问答，来源跳转由业务组件提供。
import type { ReactNode } from 'react';
import { Message, MessageContent } from '../primitives/message';
import { Markdown } from './Markdown';
export function AIMessage({ text, user = false, streaming = false, children }: { text: string; user?: boolean; streaming?: boolean; children?: ReactNode }) {
  return <Message align={user ? 'end' : 'start'}><MessageContent className="min-w-0 flex-1">
    {user ? <p className="question">{text}</p> : <Markdown text={text} streaming={streaming} />}{children}
  </MessageContent></Message>;
}
