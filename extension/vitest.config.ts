// 配置业务、模型库、消息边界与界面组件的离线验收。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
