// 验证搜索区内部焦点切换不会提前归位，提交后返回标签页不会再次展开。
import { afterEach, expect, test, vi } from 'vitest';

const history = vi.hoisted(() => ({ add: vi.fn(), destroy: vi.fn() }));
vi.mock('../src/search-history', () => ({ createSearchHistory: () => history }));
import { attachSearchPanel } from '../src/search-panel';

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
  const state: { active: Element | null } = { active: null };
  class Element extends EventTarget {
    value = '摄影'; action = 'https://search.bilibili.com/all';
    hidden = true; disabled = false; scrollTop = 0;
    private classes = new Set<string>();
    classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name), contains: (name: string) => this.classes.has(name) };
    setAttribute() {}
    removeAttribute() {}
    getAnimations() { return []; }
    contains(element: Element) { return element === input || element === submit; }
    focus() { if (state.active !== this) { state.active = this; this.dispatchEvent(new Event('focus')); } }
    blur() { if (state.active === this) { state.active = null; this.dispatchEvent(new Event('blur')); } }
  }
  const home = new Element(), input = new Element(), submit = new Element(), form = new Element();
  const selectors = new Map([
    ['.home', home], ['.search-area', new Element()], ['.search-box', new Element()], ['form', form], ['input', input],
    ['.search-panel', new Element()], ['.search-panel-header', new Element()], ['#bf-search-title', new Element()],
    ['#bf-search-options', new Element()], ['.clear-history', new Element()], ['.search-notice', new Element()], ['.submit', submit],
  ]);
  const root = { get activeElement() { return state.active; }, querySelector: (selector: string) => selectors.get(selector) };
  const open = vi.fn(() => {
    const retained = state.active;
    retained?.blur(); retained?.focus();
  });
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('window', { open });
  let finishHistory = () => {};
  history.add.mockReturnValue(new Promise<void>(resolve => { finishHistory = resolve; }));
  const suggest = vi.fn(() => new Promise<string[]>(() => {}));
  const panel = attachSearchPanel(root as unknown as ShadowRoot, suggest);
  panel.mount(); cleanup = panel.unmount;
  return { state, home, input, submit, form, box: selectors.get('.search-box')!, list: selectors.get('.search-panel')!, open, suggest, finishHistory };
}

test('搜索打开前解除焦点，恢复标签页不重开，用户再次聚焦仍能搜索', async () => {
  const { state, home, input, form, list, open, suggest, finishHistory } = setup();
  input.focus();
  expect(home.classList.contains('search-active')).toBe(true);

  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(open).toHaveBeenCalledWith('https://search.bilibili.com/all?keyword=%E6%91%84%E5%BD%B1', '_blank', 'noopener');
  expect(state.active).toBeNull();
  expect(home.classList.contains('search-active')).toBe(false);
  expect(list.hidden).toBe(true);
  expect(suggest).toHaveBeenCalledOnce();
  expect(history.add).toHaveBeenCalledWith('摄影');

  finishHistory(); await Promise.resolve();
  input.focus();
  expect(home.classList.contains('search-active')).toBe(true);
  expect(suggest).toHaveBeenCalledTimes(2);
});

test('搜索后保留原词，再点搜索按钮时焦点转移不提前归位，第二次搜索成功', async () => {
  const { state, home, input, submit, form, box, open, finishHistory } = setup();
  input.focus();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  finishHistory(); await Promise.resolve();
  expect(open).toHaveBeenCalledOnce();

  input.focus();
  state.active = null;
  box.dispatchEvent(Object.assign(new Event('focusout'), { relatedTarget: submit }));
  await Promise.resolve();
  expect(home.classList.contains('search-active')).toBe(true);
  submit.focus();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(input.value).toBe('摄影');
  expect(home.classList.contains('search-active')).toBe(false);
  expect(state.active).toBeNull();
});

test('焦点移出整个搜索区时仍会收起', async () => {
  const { state, home, input, box } = setup();
  input.focus();
  state.active = null;
  box.dispatchEvent(Object.assign(new Event('focusout'), { relatedTarget: null }));
  await Promise.resolve();
  expect(home.classList.contains('search-active')).toBe(false);
});

test('点击下方推荐时搜索已收起，不重置滚动位置或移动视频链接', () => {
  const { home } = setup();
  home.classList.add('has-browse'); home.scrollTop = 450;
  document.dispatchEvent(new Event('pointerdown',{ bubbles: true }));
  expect(home.scrollTop).toBe(450);
});

test('有推荐时收起搜索仍保留滚动位置，纯搜索首页保持原有归位行为', () => {
  const { home,input } = setup();
  home.classList.add('has-browse'); input.focus(); home.scrollTop = 450;
  document.dispatchEvent(new Event('pointerdown',{ bubbles: true }));
  expect(home.classList.contains('search-active')).toBe(false);
  expect(home.scrollTop).toBe(450);
  home.classList.remove('has-browse'); home.scrollTop = 450;
  document.dispatchEvent(new Event('pointerdown',{ bubbles: true }));
  expect(home.scrollTop).toBe(0);
});
