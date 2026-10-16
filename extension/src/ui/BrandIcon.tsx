// 设置页的小电视标志，间歇随机播放五种轻动画并尊重减少动态效果设置。
import { useEffect, useState } from 'react';
import styles from './BrandIcon.module.css';

const motions = ['blink', 'blink', 'blink', 'hop', 'look', 'happy', 'antenna'] as const;
type Motion = typeof motions[number];

export function BrandIcon() {
  const [motion, setMotion] = useState<Motion | null>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number;

    function schedule(first: boolean) {
      timer = window.setTimeout(play, first ? 1000 + Math.random() * 1000 : 5000 + Math.random() * 5000);
    }

    function play() {
      setMotion(motions[Math.floor(Math.random() * motions.length)]!);
      timer = window.setTimeout(() => { setMotion(null); schedule(false); }, 1000);
    }

    function sync() {
      window.clearTimeout(timer);
      setMotion(null);
      if (!document.hidden && !reducedMotion.matches) schedule(true);
    }

    sync();
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
    };
  }, []);

  return <svg className={`${styles.icon} ${motion ? styles[motion] : ''}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className={styles.leftAntenna} d="m7 3 3 4" />
    <path className={styles.rightAntenna} d="m17 3-3 4" />
    <rect x="3" y="7" width="18" height="14" rx="4" />
    <g className={styles.eyes}><path d="M8 12v3m8-3v3" /></g>
    <path className={styles.closedEyes} d="M6.5 13.5h3m5 0h3" />
    <path className={styles.happyEyes} d="M6.5 14.5q1.5-3 3 0m5 0q1.5-3 3 0" />
  </svg>;
}
