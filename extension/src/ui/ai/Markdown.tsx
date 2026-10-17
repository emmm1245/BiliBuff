// 为所有AI正文统一中文流式排版与资源限制，不将模型原文作为可执行HTML。
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <Streamdown className="bb-markdown" plugins={{ cjk }} mode={streaming ? 'streaming' : 'static'} isAnimating={streaming}
    animated={{ animation: 'fadeIn', sep: 'char', duration: 150, maxBacklogMs: 240 }} controls={false} skipHtml
    disallowedElements={['img','iframe','script','style','video','audio','source','input']}
    linkSafety={{ enabled: false }} urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}>{text}</Streamdown>;
}
