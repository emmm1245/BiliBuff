// 检查扩展的 TypeScript 代码并排除框架生成文件。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', '.artifacts/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  { files: ['scripts/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
