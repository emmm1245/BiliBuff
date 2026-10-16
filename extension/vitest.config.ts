// 配置规则、数据库和消息边界的离线单元测试。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
