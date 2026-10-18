// 在首页过滤接管前保留骨架占位，并复用官方骨架结构等待标签和 AI 判断。
export const homeSkeleton = '<div class="bf-home-skeleton bili-video-card__skeleton" aria-hidden="true"><div class="bili-video-card__skeleton--cover"></div><div class="bili-video-card__skeleton--info"><div class="bili-video-card__skeleton--right"><p class="bili-video-card__skeleton--text"></p><p class="bili-video-card__skeleton--text short"></p><p class="bili-video-card__skeleton--light"></p></div></div></div>';

export function holdHomeSkeleton() {
  if (location.pathname !== '/') return () => {};
  const style = document.createElement('style');
  style.textContent = `
    .bili-feed-card .bili-video-card:not(.bf-card) { position: relative; }
    .bili-feed-card .bili-video-card:not(.bf-card) > :not(.bili-video-card__skeleton) {
      visibility: hidden !important; pointer-events: none !important;
    }
    .bili-feed-card .bili-video-card:not(.bf-card) > :not(.bili-video-card__skeleton) * {
      visibility: hidden !important;
    }
    /* 官方移除骨架到过滤接管之间，封面与文字继续使用骨架色占位。 */
    .bili-feed-card .bili-video-card:not(.bf-card):not(:has(> .bili-video-card__skeleton))::before {
      content: ''; display: block; position: absolute; inset: 0 0 auto;
      padding-top: var(--cover-radio, 56.25%); border-radius: 6px; background: var(--graph_bg_regular, #f1f2f3);
    }
    .bili-feed-card .bili-video-card:not(.bf-card):not(:has(> .bili-video-card__skeleton))::after {
      content: ''; position: absolute; inset: auto 6% 0 0; height: 58px;
      background: linear-gradient(var(--graph_bg_regular, #f1f2f3) 0 0) left top / 100% 18px no-repeat,
        linear-gradient(var(--graph_bg_regular, #f1f2f3) 0 0) left 22px / 72% 18px no-repeat,
        linear-gradient(var(--graph_bg_regular, #f1f2f3) 0 0) left bottom / 50% 10px no-repeat;
    }
  `;
  document.documentElement.append(style);
  return () => style.remove();
}
