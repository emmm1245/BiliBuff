// 挂载可恢复的留白首页，呈现深浅壁纸、原站搜索历史和搜索联想。
import logo from './assets/bilibili-text.svg?raw';
import css from './search-home.css?inline';
import themeCss from './home-theme.css?inline';
import type { Settings } from './types';
import type { Theme } from './theme';
import { attachSearchPanel } from './search-panel';

export function createSearchHome(openSettings: () => Promise<unknown>, suggest: (term: string) => Promise<string[]>) {
  const host = document.createElement('div');
  host.id = 'bf-search-home';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}\n${themeCss}</style>
    <main class="home" aria-label="留白搜索首页">
      <div class="wallpaper"></div><div class="veil"></div>
      <div class="search-area">
        <div class="logo" role="img" aria-label="哔哩哔哩">${logo}</div>
        <div class="search-box"><form class="search" role="search" action="https://search.bilibili.com/all" method="get">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
          <input type="search" name="keyword" aria-label="搜索哔哩哔哩" placeholder="搜点你热爱的" autocomplete="off" maxlength="100" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bf-search-options" required>
          <button class="submit" type="submit" aria-label="搜索" title="搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>
        </form><section class="search-panel" aria-labelledby="bf-search-title" hidden>
          <div class="search-panel-header"><span id="bf-search-title">搜索历史</span><button type="button" class="clear-history" title="同时清空 B 站原搜索历史" hidden>清空</button></div>
          <div id="bf-search-options" role="listbox" aria-labelledby="bf-search-title"></div>
          <p class="search-notice" role="status" hidden></p>
          <div class="search-hints"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>新标签页搜索</span><span><kbd>Esc</kbd>收起</span></div>
        </section></div>
        <p class="quote">你所热爱的，就是你的生活。</p>
        <p class="error" role="status" hidden></p>
      </div>
      <button class="settings" type="button" title="调整留白模式与壁纸"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/></svg>留白设置</button>
    </main>`;
  const home = root.querySelector<HTMLElement>('.home')!;
  const wallpaper = root.querySelector<HTMLElement>('.wallpaper')!;
  const search = attachSearchPanel(root, suggest);
  const error = root.querySelector<HTMLElement>('.error')!;
  root.querySelector('.settings')!.addEventListener('click', () => {
    void openSettings().catch(reason => { error.hidden = false; error.textContent = reason instanceof Error ? reason.message : '暂时无法打开设置。'; });
  });
  const hide = document.createElement('style');
  hide.textContent = `html.bf-search-home { overflow: hidden !important; }
    html.bf-search-home > body { display: none !important; }
    html.bf-search-home > #bf-search-home { display: block !important; }`;
  let wallpaperValue = '';
  function remove() { search.unmount(); document.documentElement.classList.remove('bf-search-home'); host.remove(); hide.remove(); }
  function update(settings: Pick<Settings, 'homeSearch' | 'homeWallpaper'>, pathname = location.pathname) {
    if (!settings.homeSearch || pathname !== '/') { remove(); return; }
    if (settings.homeWallpaper !== wallpaperValue) {
      wallpaperValue = settings.homeWallpaper;
      wallpaper.style.backgroundImage = wallpaperValue ? `url("${wallpaperValue}")` : '';
      home.classList.toggle('custom', Boolean(wallpaperValue));
    }
    if (!host.isConnected) {
      document.documentElement.append(hide, host);
      document.documentElement.classList.add('bf-search-home');
      search.mount();
    }
  }
  function setTheme(theme: Theme) { host.dataset.theme = theme; }
  return { update, remove, setTheme };
}
