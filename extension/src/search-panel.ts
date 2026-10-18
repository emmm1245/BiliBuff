// 协调留白搜索区的展开收起、原站历史联想、键盘输入和历史同步。
import { closeIcon, chevronRightIcon } from './ui/static-icons';
import { createSearchHistory } from './search-history';
import type { SearchHistoryEntry } from './search';

export function attachSearchPanel(root: ShadowRoot, suggest: (term: string) => Promise<string[]>) {
  const home = root.querySelector<HTMLElement>('.home')!;
  const area = root.querySelector<HTMLElement>('.search-area')!;
  const box = root.querySelector<HTMLElement>('.search-box')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const panel = root.querySelector<HTMLElement>('.search-panel')!;
  const header = root.querySelector<HTMLElement>('.search-panel-header')!;
  const title = root.querySelector<HTMLElement>('#bf-search-title')!;
  const list = root.querySelector<HTMLElement>('#bf-search-options')!;
  const clear = root.querySelector<HTMLButtonElement>('.clear-history')!;
  const notice = root.querySelector<HTMLElement>('.search-notice')!;
  const submit = root.querySelector<HTMLButtonElement>('.submit')!;
  let mounted = false, composing = false, busy = false, selected = -1, epoch = 0, skipFocus = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let history: ReturnType<typeof createSearchHistory> | undefined;
  let opening: Promise<unknown> = Promise.resolve();
  let histories: SearchHistoryEntry[] = [], words: string[] = [];
  function expand() {
    if (!home.classList.contains('search-active')) {
      home.classList.add('search-active');
      opening = Promise.allSettled(area.getAnimations({ subtree: true }).map(animation => animation.finished));
    }
    return opening;
  }
  function showNotice(message: string) { notice.textContent = message; notice.hidden = !message; }
  function close(collapse = true) {
    epoch++; clearTimeout(timer); selected = -1; panel.hidden = true;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    if (collapse) {
      home.classList.remove('search-active');
      if (!home.classList.contains('has-browse')) home.scrollTop = 0;
    }
  }
  function select(index: number) {
    selected = index;
    if (!list.classList.contains('history-list')) input.value = words[index]!;
    for (const [i, el] of [...list.querySelectorAll<HTMLElement>('[role=option]')].entries()) {
      el.setAttribute('aria-selected', String(i === selected));
      if (i === selected) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    }
  }
  function getHistory() {
    return history ??= createSearchHistory(box, entries => {
      histories = entries;
      if (mounted && !input.value.trim() && !panel.hidden) { epoch++; render(entries.map(item => item.value), true); }
    });
  }
  function render(values: string[], isHistory: boolean) {
    words = values; selected = -1; list.replaceChildren(); input.removeAttribute('aria-activedescendant');
    title.textContent = isHistory ? '搜索历史' : '搜索联想';
    header.hidden = !isHistory;
    clear.hidden = !isHistory || !values.length;
    list.classList.toggle('history-list', isHistory);
    for (const [index, word] of values.entries()) {
      const button = document.createElement('button');
      button.type = 'button'; button.id = `bf-search-option-${index}`;
      button.className = isHistory ? 'history-word' : 'suggest-word';
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false');
      button.textContent = word; button.addEventListener('click', () => { void search(word); });
      if (isHistory) {
        const item = document.createElement('span'); item.className = 'history-item';
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'history-remove'; remove.innerHTML = closeIcon;
        remove.setAttribute('aria-label', `删除搜索历史 ${word}`);
        remove.addEventListener('click', () => { void getHistory().remove(word).catch(() => showNotice('没能删除，请稍后重试。')); });
        item.append(button, remove); list.append(item);
      } else {
        button.insertAdjacentHTML('beforeend', chevronRightIcon);
        list.append(button);
      }
    }
    showNotice(values.length ? '' : isHistory ? '还没有搜索历史' : '没有相关联想，回车直接搜索');
    panel.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  async function update() {
    if (!mounted || composing || !box.contains(root.activeElement)) return;
    const current = ++epoch, term = input.value.trim();
    const animation = expand();
    if (!term) {
      try {
        const [entries] = await Promise.all([getHistory().read(), animation]);
        if (!mounted || current !== epoch) return;
        histories = entries; render(entries.map(item => item.value), true);
      } catch {
        await animation;
        if (mounted && current === epoch) { history?.destroy(); history = undefined; render(histories.map(item => item.value), true); showNotice('暂时无法读取原搜索历史，仍可直接搜索。'); }
      }
    } else {
      panel.hidden = true; input.setAttribute('aria-expanded', 'false');
      try {
        const [values] = await Promise.all([suggest(term), animation]);
        if (mounted && current === epoch && input.value.trim() === term) render(values, false);
      } catch {
        await animation;
        if (mounted && current === epoch) { render([], false); showNotice('联想暂不可用，回车直接搜索'); }
      }
    }
  }
  function queue() {
    epoch++; clearTimeout(timer); selected = -1; input.removeAttribute('aria-activedescendant');
    panel.hidden = true; input.setAttribute('aria-expanded', 'false');
    if (!composing) timer = setTimeout(() => { void update(); }, 200);
  }
  async function search(word: string) {
    const value = word.trim();
    if (!value || busy || composing) return;
    busy = true; submit.disabled = true; input.value = value; close();
    const focused = root.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
    const url = new URL(form.action); url.searchParams.set('keyword', value);
    window.open(url.href, '_blank', 'noopener');
    try { await getHistory().add(value); } catch { /* 历史存储异常不能阻止用户主动搜索。 */ }
    finally { busy = false; submit.disabled = false; }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const word = !panel.hidden && selected >= 0 ? words[selected]! : input.value;
    if (!word.trim()) { input.focus(); return; }
    void search(word);
  });
  input.addEventListener('focus', () => { if (!skipFocus) void update(); });
  input.addEventListener('pointerdown', () => { if (root.activeElement === input && !home.classList.contains('search-active')) void update(); });
  input.addEventListener('input', queue);
  input.addEventListener('compositionstart', () => { composing = true; close(false); });
  input.addEventListener('compositionend', () => { composing = false; queue(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing) { if (event.key === 'Enter') event.preventDefault(); return; }
    if (event.key === 'Enter' && !panel.hidden && selected >= 0) { event.preventDefault(); void search(words[selected]!); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!panel.hidden && words.length) { event.preventDefault(); select(selected < 0 ? event.key === 'ArrowDown' ? 0 : words.length - 1 : (selected + (event.key === 'ArrowDown' ? 1 : -1) + words.length) % words.length); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); void update(); }
    }
  });
  box.addEventListener('keydown', event => { if (event.key === 'Escape' && !composing) { event.preventDefault(); close(); skipFocus = true; input.focus(); skipFocus = false; } });
  box.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof HTMLElement && box.contains(event.relatedTarget)) return;
    queueMicrotask(() => { if (!box.contains(root.activeElement)) close(); });
  });
  panel.addEventListener('pointerdown', event => { if ((event.target as Element).closest('button')) event.preventDefault(); });
  clear.addEventListener('click', () => { void getHistory().clear().catch(() => showNotice('没能清空，请稍后重试。')); });
  const outside = (event: Event) => { if (!event.composedPath().includes(box)) close(); };
  return {
    mount() { mounted = true; document.addEventListener('pointerdown', outside); },
    unmount() { mounted = false; close(); document.removeEventListener('pointerdown', outside); history?.destroy(); history = undefined; histories = []; words = []; },
  };
}
