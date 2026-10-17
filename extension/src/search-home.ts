// 挂载可恢复的留白首页，呈现深浅壁纸、原站搜索历史和搜索联想。
import { homeTemplate } from './search/home-template';
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
  root.innerHTML = `<style>${css}\n${themeCss}</style>${homeTemplate(logo)}`;
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
