// 同步设置页与留白首页的外观，迁移旧选择并缓存设置页首屏主题。
import { Button } from './primitives/button';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { parseTheme, THEME_KEY, type Theme } from '../theme';
import styles from './App.module.css';

export function initializeTheme(): Theme {
  const theme = parseTheme(localStorage.getItem(THEME_KEY));
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme as Theme || 'system');
  const [error, setError] = useState('');
  function apply(value: Theme) {
    localStorage.setItem(THEME_KEY, value);
    document.documentElement.dataset.theme = value;
    setTheme(value);
    setError('');
  }
  useEffect(() => {
    let alive = true, version = 0;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && THEME_KEY in changes) { version++; apply(parseTheme(changes[THEME_KEY]?.newValue)); }
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local.get(THEME_KEY).then(async saved => {
      if (!alive || version) return;
      if (saved[THEME_KEY] === undefined) await browser.storage.local.set({ [THEME_KEY]: initializeTheme() });
      else apply(parseTheme(saved[THEME_KEY]));
    }).catch(() => { if (alive) setError('外观暂未同步，请重试切换。'); });
    return () => { alive = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
  async function change(value: Theme) {
    try { await browser.storage.local.set({ [THEME_KEY]: value }); apply(value); }
    catch { setError('外观没能保存，请重试切换。'); }
  }
  return <div className={styles.themePicker}>
    <span>外观</span>
    <div className={styles.themeOptions} role="group" aria-label="外观主题">
      {(['system', 'light', 'dark'] as const).map(value => <Button type="button" key={value} aria-pressed={theme === value} onClick={() => { void change(value); }}>{({ system: '跟随系统', light: '浅色', dark: '深色' })[value]}</Button>)}
    </div>
    {error && <small role="alert">{error}</small>}
  </div>;
}
