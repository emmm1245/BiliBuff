// 用现有消息、卡片和输入组件组合视频问答，提供建议问题、流式状态与字幕来源。
import { useEffect, useEffectEvent, useRef } from 'react';
import { ArrowRight, ArrowUp, Sparkles } from 'lucide-react';
import type { VideoPanelActions, VideoPanelState } from '../../video-panel';
import { clock, videoAnswer, videoAnswerText } from '../../video-data';
import { Button } from '../primitives/button';
import { Card } from '../primitives/card';
import { MessageGroup, MessageHeader } from '../primitives/message';
import { Textarea } from '../primitives/textarea';
import { AIMessage } from './AIMessage';

const suggestions = ['这个视频的核心观点是什么？', '有哪些值得记住的细节？', '用简单的话解释视频里的关键概念'];

export function VideoChat({ state, actions, question, setQuestion, active }: {
  state: VideoPanelState; actions: VideoPanelActions; question: string; setQuestion: (value: string) => void; active: boolean;
}) {
  const { cache, task, preview } = state;
  const conversation = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const generating = task === 'chat', available = !!cache?.rows.length;
  const sendable = available && !state.busy && !task && !!question.trim();
  useEffect(() => { follow.current = true; }, [state.question, state.source]);
  const followAnswer = useEffectEvent(() => {
    if (active && follow.current && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  });
  useEffect(() => { followAnswer(); }, [cache?.answers.length, generating, preview]);
  const ask = () => { if (sendable) actions.analyze('chat',question.trim()); };
  return <div className="video-chat">
    <div className="chat-heading"><span className="chat-context"><span className={available ? 'context-dot ready' : 'context-dot'} />{available ? '已连接视频内容' : '该视频无法使用'}</span><span className="muted">回答附原文定位</span></div>
    <div ref={conversation} className="chat-result scroll" role="log" aria-label="视频问答记录" aria-live="polite" onScroll={event => {
      const node = event.currentTarget; follow.current = node.scrollHeight-node.scrollTop-node.clientHeight < 48;
    }}>
      {!cache?.answers.length && !generating && <div className="chat-empty">
        <span className="chat-spark"><Sparkles size={24} aria-hidden="true" /></span>
        <h3>聊聊这支视频</h3><p>{available ? '从一个问题开始，把感兴趣的内容问明白。' : '视频有可用字幕后，就可以在这里提问。'}</p>
        <div className="chat-suggestions" aria-label="建议问题">{suggestions.map(text => <Button key={text} disabled={!available || !!task || state.busy} onClick={() => { setQuestion(text); input.current?.focus(); }}>{text}<ArrowUp size={14} aria-hidden="true" /></Button>)}</div>
      </div>}
      <MessageGroup className="chat-messages">
        {cache?.answers.map((answer,index) => {
          const refs = [...new Set([...answer.refs, ...videoAnswer(answer.answer,0,cache.rows.length-1).refs])]
            .filter(id => Number.isInteger(id) && id >= 0 && id < cache.rows.length).slice(0,6);
          return <div key={answer.at+':'+index} className="chat-item bb-result-reveal">
          <AIMessage text={answer.question} user />
          <MessageHeader className="chat-author"><Sparkles size={13} aria-hidden="true" />BiliBuff</MessageHeader>
          <AIMessage text={videoAnswerText(answer.answer)}>{!!refs.length && <div className="refs" aria-label="回答的字幕来源">{refs.map(id => <Button key={id} onClick={() => actions.seek(cache.rows[id]!.start)}>{clock(cache.rows[id]!.start)} 原文<ArrowRight size={12} aria-hidden="true" /></Button>)}</div>}</AIMessage>
        </div>; })}
        {generating && <div className="chat-item pending-answer">
          <AIMessage text={state.question} user />
          <MessageHeader className="chat-author"><Sparkles size={13} aria-hidden="true" />BiliBuff<span className="chat-generating">正在回答</span></MessageHeader>
          {preview ? <AIMessage text={videoAnswerText(preview,true)} streaming /> : <div className="chat-thinking" role="status">正在阅读相关字幕<span aria-hidden="true">···</span></div>}
        </div>}
      </MessageGroup>
    </div>
    <Card className="composer">
      <form onSubmit={event => { event.preventDefault(); ask(); }}>
        <Textarea ref={input} disabled={!available || !!task || state.busy} maxLength={2000} placeholder={available ? '有什么想问的？' : '暂无可用字幕'} aria-label="向视频提问" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); }
        }} />
        <div className="composer-footer"><span className="composer-hint">Ctrl / ⌘ + Enter 发送</span><span className="composer-count">{question.length} / 2000</span>
          {generating ? <Button className="ask cancel" onClick={actions.cancel}>取消生成</Button> : <Button type="submit" className="ask primary" aria-label="发送问题" title="发送问题" disabled={!sendable}><ArrowUp size={18} aria-hidden="true" /></Button>}
        </div>
      </form>
    </Card>
  </div>;
}
