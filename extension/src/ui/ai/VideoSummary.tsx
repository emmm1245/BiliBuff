// 用受限组件目录渲染视频总结，提供本地详情展开和经过校验的字幕定位。
import { createContext, useContext, type ReactNode } from 'react';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import type { InferComponentProps } from '@json-render/core';
import { summaryCatalog, summarySpec } from '../../video-summary';
import type { SummaryPreview, SummaryUI } from '../../video-summary';
import { clock } from '../../video-data';
import type { SubtitleRow } from '../../video-types';
import { Button } from '../primitives/button';

const Sources = createContext<{ rows: SubtitleRow[]; seek: (seconds: number) => void; streaming: boolean }>({ rows: [], seek: () => {}, streaming: false });
type ListProps = InferComponentProps<typeof summaryCatalog, 'KeyPoints'>;
function Reference({ id }: { id: number }) {
  const { rows, seek, streaming } = useContext(Sources), row = rows[id];
  if (!row) return null;
  return <Button className="summary-ref" disabled={streaming} aria-label={`定位到 ${clock(row.start)}`} onClick={() => seek(row.start)}>{clock(row.start)}<span aria-hidden="true"> ↗</span></Button>;
}
function Detail({ text }: { text: string }) {
  return text ? <details className="summary-detail"><summary>查看详情</summary><p>{text}</p></details> : null;
}
function Block({ title, condition, children }: { title: string; condition: string; children: ReactNode }) {
  return <section className="summary-block"><h4>{title}</h4>{condition && <p className="summary-condition">{condition}</p>}{children}</section>;
}
function Items({ items, numbered = false }: { items: ListProps['items']; numbered?: boolean }) {
  const content = (item: ListProps['items'][number],index: number) => <div className="summary-item" key={index}>
    {numbered && <span className="summary-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>}
    <div className="summary-item-content"><strong>{item.title}</strong><Reference id={item.ref} />{item.text && <p>{item.text}</p>}<Detail text={item.detail} /></div>
  </div>;
  return <>{items.slice(0,3).map(content)}{items.length > 3 && <details className="summary-detail summary-more"><summary>其余 {items.length-3} 项</summary>{items.slice(3).map((item,index) => content(item,index+3))}</details>}</>;
}
const defined = defineRegistry(summaryCatalog, { components: {
  KeyPoints: ({ props }) => <Block {...props}><Items items={props.items} /></Block>,
  Steps: ({ props }) => <Block {...props}><Items items={props.items} numbered /></Block>,
  Timeline: ({ props }) => <Block {...props}><div className="summary-timeline"><Items items={props.items} /></div></Block>,
  Comparison: ({ props }) => <Block {...props}>
    <div className="summary-choices"><div><strong>{props.left}</strong><p>{props.leftFit}</p></div><div><strong>{props.right}</strong><p>{props.rightFit}</p></div></div>
    <div className="summary-dimensions">{props.items.map((item,index) => <div className="summary-dimension" key={index}><strong>{item.title}<Reference id={item.ref} /></strong>
      <div className="summary-comparison-values"><p><span className="summary-object">{props.left}：</span>{item.left}</p><p><span className="summary-object">{props.right}：</span>{item.right}</p></div><Detail text={item.detail} /></div>)}</div>
  </Block>,
  CausalChain: ({ props }) => <Block {...props}><div className="summary-chain">{props.items.map((item,index) => <div key={index}>
    <div className="summary-node"><strong>{item.title}</strong><Reference id={item.ref} />{item.text && <p>{item.text}</p>}<Detail text={item.detail} /></div>
    {index < props.items.length-1 && <p className="summary-relation"><span aria-hidden="true">↓ </span>{item.relation}</p>}
  </div>)}</div></Block>,
  Argument: ({ props }) => <Block {...props}><p className="summary-speaker">{props.speaker}</p><p className="summary-claim">{props.claim}</p><Items items={props.items} /></Block>,
} });
const registry = { ...defined.registry, SummaryLayout: ({ children }: { children?: ReactNode }) => <>{children}</> };
export function VideoSummary({ value, rows, seek, streaming = false, status = '' }: {
  value?: SummaryUI | SummaryPreview; rows: SubtitleRow[]; seek: (seconds: number) => void; streaming?: boolean; status?: string;
}) {
  return <div className="generative-summary" aria-busy={streaming}>
    {value?.headline && <h3 className="summary-headline">{value.headline}</h3>}
    {value?.context && <p className="summary-context">{value.context}</p>}
    {value && <Sources.Provider value={{ rows, seek, streaming }}><JSONUIProvider registry={registry}><Renderer spec={summarySpec(value)} registry={registry} loading={streaming} /></JSONUIProvider></Sources.Provider>}
    {streaming && <p className="summary-generating" role="status">{status || '正在整理重点…'}</p>}
  </div>;
}
