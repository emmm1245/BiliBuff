// 验证侧栏排序恢复、栏目增减兼容与组内移动边界。
import { afterEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { moveNavigationTab, NAVIGATION_ORDER_KEY, normalizeNavigationOrder } from '../src/settings/navigation';
import { SettingsNavigation } from '../src/ui/SettingsNavigation';

afterEach(() => vi.unstubAllGlobals());

test('无保存值时使用默认顺序，恢复时过滤旧栏目、去重并补上新栏目', () => {
  const defaults = ['rules', 'home', 'quickRead', 'videoAssistant', 'analysis', 'services', 'data'];
  expect(normalizeNavigationOrder(null)).toEqual(defaults);
  expect(normalizeNavigationOrder({ rules: 1 })).toEqual(defaults);
  expect(normalizeNavigationOrder(['data', 'analysis', 'analysis', 'removed', 'home'])).toEqual([
    'analysis', 'home', 'rules', 'quickRead', 'videoAssistant', 'data', 'services',
  ]);
});

test('组内可以向上和向下移动，跨组和原地移动不改变顺序', () => {
  const order = normalizeNavigationOrder(null);
  const moved = moveNavigationTab(order, 'rules', 'analysis');
  expect(moved).toEqual(['home', 'quickRead', 'videoAssistant', 'analysis', 'rules', 'services', 'data']);
  expect(moveNavigationTab(moved, 'rules', 'home')).toEqual(order);
  expect(moveNavigationTab(order, 'data', 'services').slice(-2)).toEqual(['data', 'services']);
  expect(moveNavigationTab(order, 'rules', 'data')).toBe(order);
  expect(moveNavigationTab(order, 'rules', 'rules')).toBe(order);
  expect(order[0]).toBe('rules');
});

test('重新打开侧栏时恢复本机顺序，仅提供可拖动导航按钮', () => {
  const getItem = vi.fn(() => JSON.stringify(['analysis', 'home', 'rules', 'quickRead', 'videoAssistant', 'data', 'services']));
  vi.stubGlobal('localStorage', { getItem });
  const html = renderToStaticMarkup(createElement(SettingsNavigation, { tab: 'rules', onChange: vi.fn() }));
  expect(getItem).toHaveBeenCalledWith(NAVIGATION_ORDER_KEY);
  expect(html.indexOf('AI 计划分析')).toBeLessThan(html.indexOf('首页外观'));
  expect(html.indexOf('数据与维护')).toBeLessThan(html.indexOf('AI 服务'));
  expect(html.match(/draggable="true"/g)).toHaveLength(7);
  expect(html.match(/<button /g)).toHaveLength(7);
  expect(html.match(/title="拖动调整顺序"/g)).toHaveLength(7);
  expect(html).not.toMatch(/上移|下移/);
});

test('保存内容损坏时仍可打开侧栏并使用默认顺序', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'invalid json' });
  const html = renderToStaticMarkup(createElement(SettingsNavigation, { tab: 'rules', onChange: vi.fn() }));
  expect(html.indexOf('内容过滤')).toBeLessThan(html.indexOf('首页外观'));
  expect(html.match(/draggable="true"/g)).toHaveLength(7);
});
