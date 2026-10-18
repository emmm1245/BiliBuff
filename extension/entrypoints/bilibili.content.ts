// 首页提前保留骨架，页面加载及播放页节点接管完成后启动过滤，扩展重载时统一清理。
import { defineContentScript } from 'wxt/utils/define-content-script';
import { send } from '../src/client';
import { startContent } from '../src/content';
import { isListPlayback } from '../src/core';
import { holdHomeSkeleton } from '../src/filter/home-skeleton';

export default defineContentScript({
  matches: ['https://www.bilibili.com/*'],
  runAt: 'document_start',
  async main(ctx) {
    const releaseSkeleton = holdHomeSkeleton();
    ctx.onInvalidated(releaseSkeleton);
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
    try {
      const settings = await send({ type: 'rules' });
      if (ctx.isInvalid) return;
      const stop = startContent(settings);
      ctx.onInvalidated(stop);
    } catch (error) {
      releaseSkeleton();
      throw error;
    }
  },
});
