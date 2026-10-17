// 验证侧栏拖动预览、换位动画、松手保存及取消恢复。
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { Children, isValidElement, type DragEvent, type ReactNode, type RefCallback } from 'react';
import { NAVIGATION_ORDER_KEY, type Tab } from '../src/settings/navigation';
import { SettingsNavigation } from '../src/ui/SettingsNavigation';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useLayoutEffect(effect: () => void) { hooks.effects.push(effect); },
}));

type ItemProps = {
  ref?: RefCallback<HTMLDivElement>;
  children?: ReactNode;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
};
const nodes = new Map<string, HTMLDivElement>();
const setItem = vi.fn();
let reducedMotion = false;

beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.effects = [];
  nodes.clear(); setItem.mockClear(); reducedMotion = false;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) });
});
afterEach(() => vi.unstubAllGlobals());

function render() {
  hooks.cursor = 0;
  const rows = new Map<string, ItemProps>();
  let index = 0;
  function visit(children: ReactNode) {
    Children.forEach(children, child => {
      if (!isValidElement<ItemProps>(child)) return;
      if (child.props.onDrop) {
        const key = child.key as string;
        const top = index++ * 50;
        if (!nodes.has(key)) nodes.set(key, {
          getAnimations: () => [], animate: vi.fn(),
        } as unknown as HTMLDivElement);
        const node = nodes.get(key)!;
        Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
        node.getBoundingClientRect = () => ({ left: 0, top, width: 190, height: 44 }) as DOMRect;
        child.props.ref?.(node);
        rows.set(key, child.props);
      }
      visit(child.props.children);
    });
  }
  visit(SettingsNavigation({ tab: 'rules', onChange: vi.fn() }));
  hooks.effects.splice(0).forEach(effect => effect());
  return rows;
}

function start(rows: Map<string, ItemProps>, source: Tab) {
  const button = Children.toArray(rows.get(source)!.children)[0];
  if (!isValidElement<ItemProps>(button)) throw new Error('缺少导航按钮');
  button.props.onDragStart!({ dataTransfer: { setData: vi.fn() } } as unknown as DragEvent<HTMLButtonElement>);
  return button.props.onDragEnd!;
}
function hover(rows: Map<string, ItemProps>, target: Tab) {
  const node = nodes.get(target)!;
  rows.get(target)!.onDragOver!({ currentTarget: node, clientX: 100, clientY: node.offsetTop + 40,
    preventDefault: vi.fn(), dataTransfer: {},
  } as unknown as DragEvent<HTMLDivElement>);
}

test('拖过栏目时预览换位并播放移动动画，松手后保存顺序', () => {
  let rows = render();
  start(rows, 'rules');
  hover(rows, 'home');
  rows = render();
  expect([...rows.keys()].slice(0, 2)).toEqual(['home', 'rules']);
  expect(nodes.get('home')!.animate).toHaveBeenCalledWith([
    { transform: 'translate(0px, 50px)' }, { transform: 'translate(0, 0)' },
  ], { duration: 180, easing: 'ease-out' });
  expect(setItem).not.toHaveBeenCalled();
  rows.get('rules')!.onDrop!({ preventDefault: vi.fn() } as unknown as DragEvent<HTMLDivElement>);
  expect(setItem).toHaveBeenCalledWith(NAVIGATION_ORDER_KEY, JSON.stringify(['home', 'rules', 'quickRead', 'videoAssistant', 'analysis', 'services', 'data']));
});

test('取消拖动恢复原顺序，跨组拖动不换位', () => {
  let rows = render();
  const end = start(rows, 'rules');
  hover(rows, 'data');
  expect([...render().keys()][0]).toBe('rules');
  hover(rows, 'home');
  rows = render();
  expect([...rows.keys()][0]).toBe('home');
  end();
  expect([...render().keys()][0]).toBe('rules');
  expect(setItem).not.toHaveBeenCalled();
});

test('系统偏好减少动态效果时仍可排序，但不播放位移动画', () => {
  reducedMotion = true;
  const rows = render();
  start(rows, 'rules');
  hover(rows, 'home');
  expect([...render().keys()][0]).toBe('home');
  expect(nodes.get('home')!.animate).not.toHaveBeenCalled();
});
