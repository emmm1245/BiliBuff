// 定义 Chrome 与 Edge 扩展构建、界面模块和最小站点权限。
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifestVersion: 3,
  webExt: { disabled: true },
  manifest: {
    name: 'BiliBuff - 哔哩哔哩｜B站效率与体验增强插件',
    description: '上B站学点东西，有个Buff更顺手。推荐筛选、留白首页、观看统计与 AI 计划分析、内容复核、评论速读，提升学习效率与浏览体验。',
    permissions: ['storage', 'unlimitedStorage', 'downloads', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    host_permissions: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*', 'https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://api.deepseek.com/*', 'https://*.cn-beijing.maas.aliyuncs.com/*'],
    action: { default_title: '打开 BiliBuff 设置' },
  },
});
