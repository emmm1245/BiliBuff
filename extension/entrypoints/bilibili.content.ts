// 等待页面加载及普通、列表播放页节点接管完成后启动过滤和计时，并在扩展重载时清理。
import { defineContentScript } from 'wxt/utils/define-content-script';
import { send } from '../src/client';
import { startContent } from '../src/content';
import { isListPlayback } from '../src/core';
import type { ContentSettings } from '../src/types';

export default defineContentScript({
  matches: ['https://www.bilibili.com/*'],
  runAt: 'document_end',
  async main(ctx) {
    // 过早插入遮罩会破坏播放页原有节点的接管，导致导航重复挂载后清空。
    if (document.readyState !== 'complete') {
      await new Promise<void>(resolve => {
        const loaded = () => { window.removeEventListener('load', loaded); resolve(); };
        window.addEventListener('load', loaded, { once: true });
        ctx.onInvalidated(loaded);
      });
    }
    if (ctx.isInvalid) return;
    if (location.pathname.startsWith('/video/') || isListPlayback(location.pathname)) {
      const videoReady = () => {
        const app = document.querySelector('#app');
        return app && !app.hasAttribute('data-server-rendered') &&
          document.querySelector('#biliMainHeader[data-v-app] .bili-header__bar');
      };
      if (!videoReady()) await new Promise<void>(resolve => {
        const observer = new MutationObserver(() => { if (videoReady()) finish(); });
        const finish = () => { observer.disconnect(); resolve(); };
        observer.observe(document.body, { childList: true, subtree: true, attributes: true,
          attributeFilter: ['data-server-rendered', 'data-v-app'] });
        ctx.onInvalidated(finish);
      });
    }
    if (ctx.isInvalid) return;
    const settings = await send<ContentSettings>({ type: 'rules' });
    if (ctx.isInvalid) return;
    const stop = startContent(settings);
    ctx.onInvalidated(stop);
  },
});
