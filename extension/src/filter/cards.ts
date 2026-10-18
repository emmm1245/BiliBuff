// 协调推荐卡片可见性、标签与复核调度和遮罩恢复，不改写播放器节点。
import { browser } from 'wxt/browser';
import { send } from '../client';
import { classify, requiresTags } from './rules';
import { parseDuration } from '../watching/logic';
import { homeSkeleton } from './home-skeleton';
import type { ContentSettings, EventKind, ReviewVerdict, VideoEvent } from '../types';
interface CardData { title: string; bvid: string; durationSeconds: number | null; ad: boolean; special: boolean; specialName: string; key: string }
interface CardState extends CardData {
  element: HTMLElement; near: boolean; visible: boolean; seen: boolean; revealed: boolean;
  mask: HTMLElement | null; inertChildren: Map<HTMLElement, boolean>;
}

export function startCards(initialSettings: ContentSettings, signal: AbortSignal, services: {
  openSettings: () => void; showError: (error: unknown) => void; requestTags: (bvid: string) => Promise<string[]>;
  recordEvent: (kind: EventKind, video: Pick<VideoEvent,'bvid' | 'title'>, tags?: string[] | null, reason?: string) => void;
  configure: (settings: ContentSettings) => void;
}) {
  let settings = initialSettings;
  const { openSettings, showError, requestTags, recordEvent } = services;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const cache = new Map<string, { tags: string[]; time: number }>();
  const cards = new Map<HTMLElement, CardState>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  const queue: string[] = [];
  const counted = new Set<string>();
  const reviews = new Map<string, ReviewVerdict | 'pending'>();
  let reviewEpoch = 0;
  let refreshEpoch = 0;
  let active = 0;
  let cooldown = 0;
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let queueTimer: ReturnType<typeof setTimeout> | undefined;

  const style = document.createElement('style');
  style.textContent = `
    html.bf-hide-carousel .recommended-swipe { display: none !important; }
    .bf-card, .bf-blocked { position: relative !important; }
    .bf-highlight { outline: 3px solid rgb(251 114 153 / 80%) !important; outline-offset: 3px; border-radius: 6px;
      box-shadow: 0 0 0 2px rgb(251 114 153 / 28%), 0 0 12px 2px rgb(251 114 153 / 40%), 0 0 24px 3px rgb(251 114 153 / 26%) !important; }
    .bf-blocked > :not(.bf-mask) { visibility: hidden !important; pointer-events: none !important; }
    .bf-blocked > :not(.bf-mask) * { visibility: hidden !important; }
    .bf-mask { position: absolute; inset: 0; z-index: 20; overflow: hidden; border-radius: 6px;
      display: flex; flex-direction: column; gap: 8px; background: var(--bg1, #18191c); }
    .bf-home-skeleton { display: none; }
    .bf-home-loading { display: block; }
    .bf-home-loading > :not(.bf-home-skeleton) { display: none !important; }
    .bf-home-loading > .bf-home-skeleton { display: block; }
    .bf-cover { flex: 1; min-height: 24px; background: #777b82; border-radius: 6px; }
    .bf-ai-blocked .bf-cover, .bf-special-blocked .bf-cover { display: flex; align-items: center; justify-content: center; color: white; font: 12px/1.5 sans-serif; }
    .bf-lines { display: flex; flex-direction: column; gap: 7px; padding: 2px 0; }
    .bf-lines i { display: block; height: 12px; width: 94%; border-radius: 3px; background: #f4f4f5; }
    .bf-lines i:last-child { width: 60%; }
    .bf-details, .bf-actions { display: contents; }
    .bf-peek, .bf-retry { position: absolute; border: 0; border-radius: 5px; background: #25272be6;
      color: white; cursor: pointer; font: 12px/1.5 sans-serif; white-space: nowrap; }
    .bf-peek { inset: 6px 6px auto auto; padding: 4px 8px; }
    .bf-retry { left: 6px; bottom: 5px; padding: 3px 6px; border-radius: 4px; background: #25272b; }
    .bf-reason { color: var(--text1, #e4e5e7); font: 12px/1.35 sans-serif; overflow: hidden;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .bf-retry[hidden], .bf-reason[hidden] { display: none !important; }
    .bf-related .bf-mask { flex-direction: row; }
    .bf-related .bf-cover { flex: 0 0 42%; }
    .bf-related .bf-lines { flex: 1; padding: 8px 0; }
    .bf-mask.bf-show-reasons { gap: 0; }
    .bf-show-reasons .bf-lines { display: none; }
    .bf-show-reasons .bf-details { min-width: 0; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
    .bf-show-reasons .bf-actions { display: flex; justify-content: flex-end; gap: 4px; }
    .bf-show-reasons .bf-peek, .bf-show-reasons .bf-retry { position: static; inset: auto; padding: 3px 6px; }
    .bf-related .bf-show-reasons .bf-details { flex: 1; justify-content: center; }
    #bf-launcher { position: fixed; right: 16px; bottom: 100px; z-index: 99999; border: 1px solid #22b89a;
      border-radius: 20px; padding: 9px 14px; background: #20282c; color: #fff; cursor: pointer; font: 14px sans-serif; }
  `;
  document.head.append(style);
  const launcher = document.createElement('button');
  launcher.id = 'bf-launcher';
  launcher.textContent = settings.strict ? 'BiliBuff · 严格' : 'BiliBuff 设置';
  document.body.append(launcher);
  launcher.addEventListener('click', openSettings);
  async function applySettings() {
    const epoch = ++refreshEpoch;
    const latest = await send({ type: 'rules' });
    if (signal.aborted || epoch !== refreshEpoch) return;
    if (JSON.stringify(latest) === JSON.stringify(settings)) return;
    settings = latest;
    services.configure(latest);
    reviewEpoch++; reviews.clear();
    launcher.textContent = settings.strict ? 'BiliBuff · 严格' : 'BiliBuff 设置';
    for (const state of cards.values()) { state.revealed = false; state.seen = state.visible; }
    scan();
  }
  const refreshRules = () => { void applySettings().catch(showError); };
  const onMessage = (message: { type?: string }) => { if (message?.type === 'rules-changed') refreshRules(); };
  browser.runtime.onMessage.addListener(onMessage);
  window.addEventListener('focus', refreshRules, { signal });

  function readCard(element: HTMLElement): CardData | null {
    const special = element.matches('.floor-card.single-card');
    const specialName = special ? element.querySelector('.floor-title')?.textContent?.trim() || '特殊业务' : '';
    const promotion = element.matches('.video-card-ad-small-inner');
    const heading = element.querySelector('.bili-video-card__info--tit, .info .title, .info-container .title');
    const link = heading?.closest<HTMLAnchorElement>('a') || heading?.querySelector<HTMLAnchorElement>('a') || element.querySelector<HTMLAnchorElement>('a[href*="/video/BV"]');
    const title = heading?.getAttribute('title')?.trim() || heading?.textContent?.trim() || (promotion ? '推广内容' : '');
    if (!title) return null;
    const bvid = link?.href.match(/\/video\/(BV[\w]+)/)?.[1] || '';
    const ad = promotion || [...element.querySelectorAll('.bili-video-card__stats--text')].some(label => label.textContent?.trim() === '广告') ||
      [...element.querySelectorAll<HTMLAnchorElement>('a[href]')].some(link => { try { return new URL(link.href).hostname === 'cm.bilibili.com'; } catch { return false; } });
    const durationSeconds = parseDuration(element.querySelector('.bili-video-card__stats__duration, .duration')?.textContent || '');
    return { title, bvid, durationSeconds, ad, special, specialName, key: `${bvid || link?.href}:${title}:${durationSeconds}:${ad}:${special}:${specialName}` };
  }

  function restore(state: CardState) {
    state.element.classList.remove('bf-blocked', 'bf-highlight');
    state.mask?.remove();
    state.mask = null;
    for (const [child, inert] of state.inertChildren) child.inert = inert;
    state.inertChildren.clear();
  }

  function requestReview(state: CardState) {
    const key = state.key, epoch = reviewEpoch;
    reviews.set(key, 'pending');
    void send({ type: 'review', bvid: state.bvid, title: state.title.slice(0, 300), durationSeconds: state.durationSeconds }).then(verdict => {
      if (signal.aborted || epoch !== reviewEpoch) return;
      reviews.set(key, verdict);
      for (const card of cards.values()) if (card.key === key) render(card);
      if (verdict === 'stale') refreshRules();
    }).catch(error => {
      if (signal.aborted || epoch !== reviewEpoch) return;
      reviews.set(key, 'unknown'); showError(error);
      for (const card of cards.values()) if (card.key === key) render(card);
    });
  }

  function render(state: CardState) {
    const { element, title, bvid } = state;
    const entry = cache.get(bvid);
    const cached = entry && Date.now() - entry.time < TTL;
    const tagState = cached ? 'ready' : !bvid ? 'unavailable' : failed.has(bvid) ? 'failed' : 'loading';
    let result = state.ad && settings.blockAds ? { kind: 'blocked' as const, reason: '广告屏蔽：已开启“遮蔽明确广告”' } :
      state.special && settings.blockSpecialCards ? { kind: 'blocked' as const, reason: `特殊业务屏蔽：${state.specialName}；已开启“遮住首页特殊业务卡片”` } :
      element.matches('.video-card-ad-small-inner') ? { kind: 'normal' as const, reason: '' } :
      classify(title, cached ? entry.tags : [], settings, state.special ? 'ready' : tagState);
    if (location.pathname === '/' && !state.ad && !state.special && bvid && tagState === 'loading' && requiresTags(title, settings)) {
      result = { kind: 'pending', reason: '正在等待视频标签' };
    }
    if (settings.review.enabled && result.kind === 'highlight' && !state.ad && !state.special && bvid && !state.revealed) {
      if (!reviews.has(state.key) && state.visible) requestReview(state);
      const verdict = reviews.get(state.key);
      if (!verdict || verdict === 'pending') result = { kind: 'pending', reason: 'AI 正在复核与近期计划的相关性' };
      else if (verdict === 'unrelated') result = { kind: 'blocked', reason: 'AI屏蔽' };
    }
    if (!state.ad && !state.special && state.seen && !state.revealed && (result.kind === 'highlight' || result.kind === 'blocked') &&
        (cached || !requiresTags(title, settings) || tagState === 'failed')) {
      const key = `${result.kind}:${bvid}`;
      if (bvid && !counted.has(key)) {
        counted.add(key); recordEvent(result.kind, state, cached ? entry.tags : null, result.reason);
      }
    }
    if (!['blocked', 'pending'].includes(result.kind) || state.revealed) {
      if (state.mask) restore(state);
      element.classList.toggle('bf-highlight', result.kind === 'highlight');
      return;
    }
    element.classList.remove('bf-highlight');
    element.classList.add('bf-blocked');
    if (!state.mask) {
      const mask = document.createElement('div');
      mask.className = 'bf-mask';
      mask.innerHTML = homeSkeleton + '<div class="bf-cover"></div><div class="bf-lines" aria-hidden="true"><i></i><i></i></div><div class="bf-details"><div class="bf-actions"><button class="bf-peek" type="button">临时查看</button><button class="bf-retry" type="button" hidden>重试标签</button></div><span class="bf-reason"></span></div>';
      mask.querySelector('button')!.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        state.revealed = true;
        restore(state);
      });
      mask.querySelector('.bf-retry')!.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        failed.delete(state.bvid);
        for (const card of cards.values()) if (card.bvid === state.bvid) render(card);
        enqueue(state);
      });
      state.mask = mask;
      element.append(mask);
    }
    const tagFailed = tagState === 'failed' && requiresTags(title, settings) && !state.ad && !state.special;
    const reason = tagFailed ? result.kind === 'pending' ? `${result.reason}；可重试标签或临时查看` :
      `标签查询失败，本次按标题判断；${result.reason}` : result.reason;
    const aiBlocked = result.reason === 'AI屏蔽';
    state.mask.classList.toggle('bf-home-loading', location.pathname === '/' && result.kind === 'pending' &&
      (result.reason === 'AI 正在复核与近期计划的相关性' || tagState === 'loading'));
    state.mask.classList.toggle('bf-ai-blocked', aiBlocked);
    state.mask.classList.toggle('bf-special-blocked', state.special);
    state.mask.querySelector<HTMLElement>('.bf-cover')!.textContent = aiBlocked ? 'AI屏蔽' : state.specialName;
    state.mask.classList.toggle('bf-show-reasons', settings.showMaskReasons);
    state.mask.querySelector<HTMLElement>('.bf-peek')!.title = `${settings.showMaskReasons ? `${reason}；` : ''}本卡片临时显示，保存设置后重新检查`;
    const label = state.mask.querySelector<HTMLElement>('.bf-reason')!;
    label.hidden = !settings.showMaskReasons || aiBlocked;
    label.textContent = settings.showMaskReasons && !aiBlocked ? reason : '';
    label.title = settings.showMaskReasons ? reason : '';
    state.mask.querySelector<HTMLElement>('.bf-retry')!.hidden = !tagFailed;
    // 保留布局，同时阻断原卡片键盘访问与悬停预览。
    for (const child of element.children) {
      if (!(child instanceof HTMLElement) || child === state.mask) continue;
      if (!state.inertChildren.has(child)) state.inertChildren.set(child, child.inert);
      child.inert = true;
    }
    element.querySelectorAll('video').forEach(video => video.pause());
  }

  function needsTags(state: CardState) {
    const entry = cache.get(state.bvid);
    return !state.special && !state.element.matches('.video-card-ad-small-inner') && !(state.ad && settings.blockAds) && requiresTags(state.title, settings) && state.bvid && state.near &&
      state.element.isConnected && !state.revealed && !failed.has(state.bvid) &&
      (!entry || Date.now() - entry.time >= TTL);
  }

  function enqueue(state: CardState) {
    if (!needsTags(state) || pending.has(state.bvid)) return;
    pending.add(state.bvid);
    queue.push(state.bvid);
    pump();
  }

  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      const entries = [...cache].filter(([, v]) => Date.now() - v.time < TTL)
        .sort((a, b) => b[1].time - a[1].time).slice(0, 600);
      cache.clear();
      entries.forEach(([key, value]) => cache.set(key, value));

    }, 1000);
  }

  function pump() {
    if (signal.aborted) return;
    clearTimeout(queueTimer);
    if (Date.now() < cooldown) {
      queueTimer = setTimeout(pump, cooldown - Date.now());
      return;
    }
    while (active < 2 && queue.length) {
      const bvid = queue.shift()!;
      if (![...cards.values()].some(state => state.bvid === bvid && needsTags(state))) {
        pending.delete(bvid);
        continue;
      }
      active++;
      requestTags(bvid).then(tags => {
        if (signal.aborted) return;
        cache.set(bvid, { tags, time: Date.now() });
        saveCache();
        for (const state of cards.values()) if (state.bvid === bvid) render(state);
      }).catch(() => {
        if (signal.aborted) return;
        failed.add(bvid);
        cooldown = Date.now() + 30000;
        launcher.title = '标签查询暂不可用；普通模式按标题判断，严格模式未确认内容保持占位。';
        for (const state of cards.values()) if (state.bvid === bvid) render(state);
      }).finally(() => {
        active--;
        pending.delete(bvid);
        pump();
      });
    }
  }

  const nearby = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = cards.get(entry.target as HTMLElement);
      if (!state) continue;
      state.near = entry.isIntersecting;
      enqueue(state);
    }
  }, { rootMargin: '250px' });
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = cards.get(entry.target as HTMLElement);
      if (state) { state.visible = entry.isIntersecting; state.seen ||= state.visible; render(state); }
    }
  });

  function scan() {
    const home = location.pathname === '/';
    const video = location.pathname.startsWith('/video/');
    document.documentElement.classList.toggle('bf-hide-carousel', home && settings.hideCarousel);
    launcher.hidden = !home && !video;
    const selector = home && !settings.homeSearch ? '.bili-feed-card .bili-video-card, .floor-card.single-card' : video ? '.video-page-card-small .card-box, .video-card-ad-small-inner' : null;
    const found = new Set<HTMLElement>(selector ? document.querySelectorAll<HTMLElement>(selector) : []);
    for (const [element, state] of cards) {
      if (!found.has(element) || !element.isConnected) {
        restore(state);
        element.classList.remove('bf-card', 'bf-related');
        nearby.unobserve(element);
        visible.unobserve(element);
        cards.delete(element);
      }
    }
    for (const element of found) {
      const data = readCard(element);
      let state = cards.get(element);
      if (!data) {
        if (state) {
          restore(state);
          element.classList.remove('bf-card', 'bf-related');
          nearby.unobserve(element); visible.unobserve(element);
          cards.delete(element);
        }
        continue;
      }
      if (state && state.key !== data.key) {
        restore(state);
        Object.assign(state, data, { revealed: false, seen: state.visible });
      }
      if (!state) {
        state = { element, ...data, near: false, visible: false, seen: false, revealed: false, mask: null, inertChildren: new Map() };
        cards.set(element, state);
        nearby.observe(element);
        visible.observe(element);
      }
      // 网站更新卡片时可能重写 class，已有卡片也需要恢复定位和横向布局标记。
      if (!element.classList.contains('bf-card')) element.classList.add('bf-card');
      if (element.classList.contains('bf-related') !== video) element.classList.toggle('bf-related', video);
      render(state);
      enqueue(state);
    }
  }

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest('#bf-launcher, .bf-mask')) return false;
      if (record.type === 'attributes' && record.attributeName === 'class') {
        return cards.has(target as HTMLElement) && record.oldValue !== target?.getAttribute('class');
      }
      return record.type === 'attributes' || record.type === 'characterData' ||
        [...record.addedNodes, ...record.removedNodes].some(node =>
          node.nodeType === 3 || (node instanceof Element && !node.matches('.bf-mask')));
    });
    if (!relevant) return;
    // 首页卡片更新后，在下一次绘制前接管，避免复用节点或换一批时闪出原内容。
    if (location.pathname === '/') { scan(); return; }
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = undefined; scan(); }, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeOldValue: true, attributeFilter: ['href', 'class'] });
  window.addEventListener('popstate', scan, { signal });
  document.addEventListener('play', event => {
    if (event.target instanceof HTMLMediaElement && event.target.closest('.bf-blocked')) event.target.pause();
  }, { capture: true, signal });
  scan();
  return () => {
    observer.disconnect(); nearby.disconnect(); visible.disconnect();
    clearTimeout(cacheTimer); clearTimeout(scanTimer); clearTimeout(queueTimer);
    browser.runtime.onMessage.removeListener(onMessage);
    for (const state of cards.values()) { restore(state); state.element.classList.remove('bf-card', 'bf-related'); }
    cards.clear(); queue.length = 0;
    reviews.clear();
    style.remove(); launcher.remove();
    document.documentElement.classList.remove('bf-hide-carousel');
  };
  }
