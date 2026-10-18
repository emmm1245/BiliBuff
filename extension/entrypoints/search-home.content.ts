// 尽早启用留白首页，并在设置变更、站内导航或扩展失效时同步恢复。
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { send } from '../src/client';
import { createSearchHome } from '../src/search-home';
import type { ContentSettings } from '../src/types';
import { parseTheme } from '../src/theme';

export default defineContentScript({
  matches: ['https://www.bilibili.com/*'],
  runAt: 'document_start',
  main(ctx) {
    const home = createSearchHome(() => send({ type: 'open-settings', section: 'home' }), term => send({ type: 'suggest', term }));
    let settings: ContentSettings | undefined;
    let epoch = 0;
    let themeEpoch = 0;
    const update = () => { if (settings) home.update(settings); };
    async function refresh() {
      const request = ++epoch;
      try {
        const latest = await send({ type: 'rules' });
        if (ctx.isInvalid || request !== epoch) return;
        settings = latest;
        update();
      } catch { /* 读取失败时保留当前首页，初次失败则保留原站点。 */ }
    }
    async function refreshTheme() {
      const request = ++themeEpoch;
      try {
        const theme = await send({ type: 'theme' });
        if (!ctx.isInvalid && request === themeEpoch) home.setTheme(parseTheme(theme));
      } catch { /* 暂时无法读取选择时，首页保持系统主题。 */ }
    }
    const onMessage = (message: { type?: string; theme?: unknown }) => {
      if (message.type === 'rules-changed') void refresh();
      if (message.type === 'theme-changed') { themeEpoch++; home.setTheme(parseTheme(message.theme)); }
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.addEventListener(window, 'wxt:locationchange', update);
    ctx.addEventListener(window, 'focus', () => { void refresh(); void refreshTheme(); });
    ctx.onInvalidated(() => { browser.runtime.onMessage.removeListener(onMessage); home.remove(); });
    void refreshTheme().then(() => { if (!ctx.isInvalid) void refresh(); });
  },
});
