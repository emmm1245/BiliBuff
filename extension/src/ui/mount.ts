// 管理扩展自有React界面的隔离样式与根节点，卸载时释放React事件和组件状态。
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import libraryCSS from './library.css?inline';
export function createIsolatedView(id: string, css: string) {
  const host = document.createElement('div'); host.id = id; host.dataset.theme = 'system';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = `${libraryCSS}\n${css}`;
  const container = document.createElement('div'); shadow.append(style, container);
  let root: Root | undefined;
  return { host, render: (content: ReactNode) => { root ??= createRoot(container); root.render(content); },
    remove: () => { root?.unmount(); root = undefined; host.remove(); } };
}
