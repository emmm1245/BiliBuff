// 定义设置页与留白首页共用的主题选择及独立存储键。
export type Theme = 'system' | 'light' | 'dark';
export const THEME_KEY = 'bilibili-focus-theme';
export function parseTheme(value: unknown): Theme { return value === 'light' || value === 'dark' ? value : 'system'; }
