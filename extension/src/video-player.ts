// 将生成章节接入播放器底栏、进度条和跳转菜单，并按区间判断广告自动跳过。
import { clock } from './video-data.ts';
import { chevronRightIcon } from './ui/static-icons.ts';
import type { VideoTimelineChapter } from './video-types';

export function adSkipTarget(chapters: VideoTimelineChapter[], seconds: number, skipped: Set<number>) {
  const chapter = chapters.find(item => item.ad && seconds >= item.start && seconds < item.end);
  if (!chapter || skipped.has(chapter.start)) return null;
  skipped.add(chapter.start); return chapter.end;
}
export function createVideoPlayerNavigation(seek: (seconds: number) => void, signal: AbortSignal) {
  const host = document.createElement('div'); host.id = 'bf-player-chapters';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{display:inline-flex;position:relative;pointer-events:auto;align-items:center;margin-left:16px;font:14px/22px "PingFang SC",HarmonyOS_Regular,"Helvetica Neue","Microsoft YaHei",sans-serif;color:rgba(255,255,255,.8)}*{box-sizing:border-box}
    button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}button:focus-visible{outline:2px solid #00aeec;outline-offset:2px}.trigger{display:flex;align-items:center;gap:2px;padding:0;max-width:190px;white-space:nowrap;height:22px}.trigger span{overflow:hidden;text-overflow:ellipsis}.trigger svg{width:18px;height:18px;flex:none}.trigger:hover{color:#fff}
    .menu{position:fixed;inset:auto;margin:0;padding:0;border:0;border-radius:2px;background:rgba(20,20,20,.9);color:rgba(255,255,255,.8);width:210px;max-width:calc(100vw - 24px);max-height:240px;overflow:auto;scrollbar-width:thin;font:12px/30px "PingFang SC",HarmonyOS_Regular,"Helvetica Neue","Microsoft YaHei",sans-serif}.menu::backdrop{background:transparent}
    .menu button{display:block;width:100%;padding:0 20px;min-height:30px;line-height:30px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.menu button:hover{background:rgba(255,255,255,.1);color:#fff}.menu button[aria-current=true]{color:#00aeec}.menu:popover-open{animation:bb-player-menu-in .12s ease-out}@keyframes bb-player-menu-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.menu:popover-open{animation:none}}
  </style><button class="trigger" aria-label="AI章节导航" aria-expanded="false" title="AI 生成章节"><span>章节</span>${chevronRightIcon}</button><div class="menu" popover="auto" aria-label="AI章节"></div>`;
  const trigger = root.querySelector<HTMLButtonElement>('.trigger')!, menu = root.querySelector<HTMLElement>('.menu')!;
  let chapters: VideoTimelineChapter[] = [], markers: HTMLElement | null = null, signature = '', current = -1, expandedControl: Element | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function open() {
    clearTimeout(hideTimer);
    if (menu.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect(); menu.showPopover();
    menu.style.left = `${Math.max(12,Math.min(rect.left,innerWidth-menu.offsetWidth-12))}px`;
    menu.style.top = `${Math.max(12,rect.top-menu.offsetHeight-6)}px`;
  }
  function closeLater() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (menu.matches(':popover-open')) menu.hidePopover(); },160); }
  host.addEventListener('pointerenter',open);
  host.addEventListener('pointerleave',closeLater);
  menu.addEventListener('pointerenter',() => clearTimeout(hideTimer));
  menu.addEventListener('pointerleave',closeLater);
  trigger.addEventListener('click',() => { if (menu.matches(':popover-open')) menu.hidePopover(); else open(); });
  menu.addEventListener('toggle',() => trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
  function clear() {
    clearTimeout(hideTimer);
    if (menu.matches(':popover-open')) menu.hidePopover(); host.remove(); markers?.remove(); markers = null; signature = ''; current = -1; chapters = [];
    if (!expandedControl?.querySelector('.bpx-player-ctrl-viewpoint')) expandedControl?.classList.remove('bpx-player-control-bottom-left-viewpoint');
    expandedControl = null;
  }
  function update(next: VideoTimelineChapter[], native: boolean, duration: number) {
    if (!next.length || native || document.querySelector('.bpx-player-ctrl-viewpoint')) { clear(); return; }
    const controls = document.querySelector('.bpx-player-control-bottom-left'), progress = document.querySelector('.bpx-player-progress');
    if (!controls) { clear(); return; }
    if (host.parentElement !== controls) {
      if (!controls.classList.contains('bpx-player-control-bottom-left-viewpoint')) { controls.classList.add('bpx-player-control-bottom-left-viewpoint'); expandedControl = controls; }
      controls.append(host);
    }
    const key = JSON.stringify(next);
    if (key !== signature) {
      signature = key; chapters = next; current = -1; menu.replaceChildren(); markers?.remove(); markers = null;
      for (const chapter of chapters) {
        const button = document.createElement('button');
        button.textContent = chapter.title; button.title = `${clock(chapter.start)} · ${chapter.title}`; button.setAttribute('aria-label',button.title); button.setAttribute('aria-current','false');
        button.addEventListener('click',() => { seek(chapter.start); menu.hidePopover(); }); menu.append(button);
      }
    }
    if (progress && duration > 0 && (!markers || markers.parentElement !== progress)) {
      markers?.remove(); markers = document.createElement('div'); markers.dataset.bilibuffChapters = '';
      markers.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
      for (const chapter of chapters) {
        if (chapter.start <= 0) continue;
        const marker = document.createElement('i'); marker.style.cssText = `position:absolute;left:${chapter.start/duration*100}%;top:0;bottom:0;width:2px;background:rgba(0,0,0,.7)`; markers.append(marker);
      }
      progress.append(markers);
    }
  }
  function playback(seconds: number) {
    const index = chapters.findIndex(chapter => seconds >= chapter.start && seconds < chapter.end);
    if (index === current) return; current = index;
    trigger.querySelector('span')!.textContent = `章节 ·${chapters[index]?.title ?? '查看全部'}`;
    [...menu.children].forEach((button,i) => button.setAttribute('aria-current',String(i === index)));
  }
  signal.addEventListener('abort',clear,{ once: true });
  return { update, playback, clear };
}
