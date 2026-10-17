// 离线验证流式正文库的中文排版、未闭合语法和受限资源展示配置，不代表浏览器样式已验收。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/ui/ai/Markdown';
import { expect, test } from 'vitest';

function render(text: string, streaming = true) {
  return renderToStaticMarkup(createElement(Markdown, { text, streaming }));
}

test('中文加粗与未闭合加粗都可以排版，后续补齐不丢正文', () => {
  for (const text of ['这是**中文重点', '这是**中文重点**，继续说明。']) {
    const html = render(text);
    expect(html).toContain('data-streamdown="strong"');
    expect(html.replace(/<[^>]*>/g,'')).toContain('中文重点');
    expect(html).not.toContain('**');
  }
  expect(render('这是**中文重点**，继续说明。', false)).toContain('继续说明。');
});

test('中文表格与代码块可直接呈现，不要求额外高亮或图表插件', () => {
  const table = render('| 科目 | 进度 |\n| --- | --- |\n| 数学 | 学习中 |', false);
  expect(table).toContain('<table');
  expect(table).toContain('数学');
  expect(table).toContain('学习中');
  const code = render('```ts\nconst 目标 = "数学";\n', true);
  expect(code).toContain('<pre');
  expect(code).toContain('目标');
});

test('受限配置保留普通链接，禁止模型主动加载图片或执行HTML与脚本链接', () => {
  const html = render('[查看来源](https://www.bilibili.com/video/BVtest)\n\n' +
    '![外部图片](https://images.invalid/tracker.png)\n\n[危险链接](javascript:alert%281%29)\n\n' +
    '<script>alert(1)</script>\n\n<iframe src="https://frames.invalid"></iframe>\n\n' +
    '<img src="https://images.invalid/raw.png" onerror="alert(1)">', false);
  expect(html).toContain('href="https://www.bilibili.com/video/BVtest"');
  for (const forbidden of ['<img', '<iframe', '<script', 'javascript:', 'onerror=', 'tracker.png', 'raw.png']) {
    expect(html).not.toContain(forbidden);
  }
});
