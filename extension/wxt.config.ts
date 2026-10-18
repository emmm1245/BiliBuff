// 定义 Chrome 与 Edge 扩展构建、界面模块和最小站点权限。
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifestVersion: 3,
  webExt: { disabled: true },
  manifest: {
    default_locale: 'zh_CN',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: ['storage', 'unlimitedStorage', 'downloads', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    host_permissions: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*', 'https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://api.deepseek.com/*', 'https://*.cn-beijing.maas.aliyuncs.com/*'],
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
    },
  },
});
