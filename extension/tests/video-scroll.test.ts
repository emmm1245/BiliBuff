// 验证视频助手的临时滚动记忆、切视频清空及问答自动跟随的触发条件。
import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { VideoPanel, type VideoPanelActions, type VideoPanelState } from '../src/video-panel';
import { VideoChat } from '../src/ui/ai/VideoChat';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    return hooks.values[index] ??= { current: initial };
  },
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useImperativeHandle() {},
  useEffectEvent(callback: () => void) { return callback; },
  useEffect: effect,
  useLayoutEffect: effect,
}));
function effect(callback: () => void, deps: unknown[]) {
  const index = hooks.cursor++, previous = hooks.values[index] as unknown[] | undefined;
  if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) hooks.effects.push(callback);
  hooks.values[index] = deps;
}
type Props = {
  children?: ReactNode; ref?: { current: unknown }; role?: string; 'data-tab'?: string;
  onClick?: () => void; onScrollCapture?: (event: { target: unknown }) => void;
};
function find(tree: ReactNode, predicate: (props: Props) => boolean): Props {
  let found: Props | undefined;
  function visit(children: ReactNode) {
    Children.forEach(children, child => {
      if (!isValidElement<Props>(child)) return;
      if (predicate(child.props)) found = child.props;
      visit(child.props.children);
    });
  }
  visit(tree);
  if (!found) throw new Error('未找到目标组件');
  return found;
}
const source = { bvid: 'BVtest', aid: 1, cid: 1, page: 1, title: '', part: '', duration: 30, parts: [], tracks: [] };
let state: VideoPanelState;
const actions = {} as VideoPanelActions;
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.effects = [];
  state = { source, cache: null, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
});
function scrollNode() {
  return { scrollTop: 0, scrollTo({ top }: { top: number }) { this.scrollTop = top; } };
}
function panel() {
  const outer = scrollNode(), inner = { summary: scrollNode(), chapters: scrollNode(), chat: scrollNode() };
  let tree: ReactNode, root: Props;
  const shell = Object.assign(outer, {
    querySelectorAll: () => Object.values(inner),
    querySelector: (selector: string) => Object.entries(inner).find(([tab]) => selector.includes(`"${tab}"`))?.[1],
  });
  function render() {
    hooks.cursor = 0;
    tree = VideoPanel({ state, actions });
    root = find(tree, props => !!props.onScrollCapture);
    root.ref!.current = shell;
    hooks.effects.splice(0).forEach(callback => callback());
  }
  render();
  return {
    outer, inner, render,
    switch(tab: string) { find(tree, props => props['data-tab'] === tab).onClick!(); render(); },
    scroll(tab: keyof typeof inner, top: number) {
      inner[tab].scrollTop = top;
      root.onScrollCapture!({ target: Object.assign(inner[tab], {
        matches: () => true, closest: () => ({ getAttribute: () => tab }),
      }) });
    },
    scrollOuter(top: number) { outer.scrollTop = top; root.onScrollCapture!({ target: outer }); },
  };
}
test('总结、章节、问答各自恢复外层与内部滚动，隐藏页事件不覆盖当前页', () => {
  const view = panel();
  view.switch('summary'); view.scrollOuter(240);
  view.switch('chapters'); expect(view.outer.scrollTop).toBe(0);
  view.scrollOuter(60); view.scroll('chapters', 180);
  view.switch('chat'); view.scrollOuter(90); view.scroll('chat', 300);
  view.scroll('chapters', 0);
  view.switch('summary'); expect(view.outer.scrollTop).toBe(240);
  view.switch('chapters'); expect(view.outer.scrollTop).toBe(60); expect(view.inner.chapters.scrollTop).toBe(180);
  view.switch('chat'); expect(view.outer.scrollTop).toBe(90); expect(view.inner.chat.scrollTop).toBe(300);
});
test('同视频更新保留位置，切P清空，返回旧视频也不恢复历史位置', () => {
  const view = panel();
  view.switch('chat'); view.scrollOuter(90); view.scroll('chat', 300);
  state = { ...state, source: { ...source } }; view.render();
  expect(view.outer.scrollTop).toBe(90); expect(view.inner.chat.scrollTop).toBe(300);
  state = { ...state, source: { ...source, cid: 2, page: 2 } }; view.render();
  expect(view.outer.scrollTop).toBe(0); expect(view.inner.chat.scrollTop).toBe(0);
  state = { ...state, source }; view.render();
  expect(view.outer.scrollTop).toBe(0); expect(view.inner.chat.scrollTop).toBe(0);
});
test('问答切页不滚底，回答更新时仍能自动跟随', () => {
  const conversation = { scrollTop: 120, scrollHeight: 1000 };
  function render(active: boolean) {
    hooks.cursor = 0;
    const tree = VideoChat({ state, actions, question: '', setQuestion: vi.fn(), active });
    find(tree, props => props.role === 'log').ref!.current = conversation;
    hooks.effects.splice(0).forEach(callback => callback());
  }
  render(false); render(true);
  expect(conversation.scrollTop).toBe(120);
  state = { ...state, task: 'chat', preview: '回答内容' }; render(true);
  expect(conversation.scrollTop).toBe(1000);
});
