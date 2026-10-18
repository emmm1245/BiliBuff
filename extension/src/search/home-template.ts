// 构造留白搜索的静态展示骨架，不引入模型或重型渲染依赖，保证早启动。
import { searchIcon, arrowRightIcon, settingsIcon } from '../ui/static-icons';

export function homeTemplate(logo: string) {
  return `
    <main class="home" aria-label="留白搜索首页">
      <div class="wallpaper"></div><div class="veil"></div>
      <div class="search-area">
        <div class="logo" role="img" aria-label="哔哩哔哩">${logo}</div>
        <div class="search-box"><form class="search" role="search" action="https://search.bilibili.com/all" method="get">
          ${searchIcon}
          <input type="search" name="keyword" aria-label="搜索哔哩哔哩" placeholder="搜点你热爱的" autocomplete="off" maxlength="100" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bf-search-options" required>
          <button class="submit" type="submit" aria-label="搜索" title="搜索">${arrowRightIcon}</button>
        </form><section class="search-panel" aria-labelledby="bf-search-title" hidden>
          <div class="search-panel-header"><span id="bf-search-title">搜索历史</span><button type="button" class="clear-history" title="同时清空 B 站原搜索历史" hidden>清空</button></div>
          <div id="bf-search-options" role="listbox" aria-labelledby="bf-search-title"></div>
          <p class="search-notice" role="status" hidden></p>
          <div class="search-hints"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>新标签页搜索</span><span><kbd>Esc</kbd>收起</span></div>
        </section></div>
        <p class="quote">你所热爱的，就是你的生活。</p>
        <p class="error" role="status" hidden></p>
      </div>
      <div class="browse-mount" hidden></div>
      <button class="settings" type="button" title="调整留白模式与壁纸">${settingsIcon}留白设置</button>
    </main>`;
}
