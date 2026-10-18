// 定义设置面板、功能分组及可恢复的导航顺序。
export const tabTitles = { rules: '内容过滤', home: '首页外观', browse: 'AI帮你刷', quickRead: 'AI 评论速读', videoAssistant: 'AI 视频助手', analysis: 'AI 计划分析', services: 'AI 服务', data: '数据与维护' };
export type Tab = keyof typeof tabTitles;

export const navigationGroups: { label: string; tabs: Tab[] }[] = [
  { label: '日常功能', tabs: ['rules', 'home', 'browse', 'quickRead', 'videoAssistant', 'analysis'] },
  { label: '配置与维护', tabs: ['services', 'data'] },
];
export const NAVIGATION_ORDER_KEY = 'bilibuff-settings-navigation-order';

export function normalizeNavigationOrder(value: unknown): Tab[] {
  const saved: unknown[] = Array.isArray(value) ? value : [];
  return navigationGroups.flatMap(group => [
    ...group.tabs.filter(tab => saved.includes(tab)).sort((a, b) => saved.indexOf(a) - saved.indexOf(b)),
    ...group.tabs.filter(tab => !saved.includes(tab)),
  ]);
}

export function moveNavigationTab(order: Tab[], source: Tab, target: Tab): Tab[] {
  if (source === target || !navigationGroups.some(group => group.tabs.includes(source) && group.tabs.includes(target))) return order;
  const next = [...order];
  next.splice(next.indexOf(source), 1);
  next.splice(order.indexOf(target), 0, source);
  return next;
}

