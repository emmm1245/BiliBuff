// 提供设置侧栏的组内拖动预览、换位动画与本机顺序记忆。
import { useLayoutEffect, useRef, useState } from 'react';
import { moveNavigationTab, navigationGroups, NAVIGATION_ORDER_KEY, normalizeNavigationOrder, tabTitles, type Tab } from '../settings/navigation';
import { Button } from './primitives/button';
import { Icon } from './Icon';
import styles from './App.module.css';

function readOrder(): Tab[] {
  try { return normalizeNavigationOrder(JSON.parse(localStorage.getItem(NAVIGATION_ORDER_KEY) ?? 'null')); }
  catch { return normalizeNavigationOrder(null); }
}

export function SettingsNavigation({ tab, onChange }: { tab: Tab; onChange: (value: Tab) => void }) {
  const [order, setOrder] = useState(readOrder);
  const [message, setMessage] = useState('');
  const [activeDrag, setActiveDrag] = useState<Tab | null>(null);
  const dragging = useRef<Tab | null>(null);
  const originalOrder = useRef(order);
  const items = useRef(new Map<Tab, HTMLDivElement>());
  const positions = useRef(new Map<Tab, DOMRect>());

  function preview(next: Tab[]) {
    positions.current = new Map([...items.current].map(([value, node]) => [value, node.getBoundingClientRect()]));
    setOrder(next);
  }

  // 重排后从原来的屏幕位置过渡到新位置，支持窄屏的横向换位。
  useLayoutEffect(() => {
    for (const [value, node] of items.current) {
      const before = positions.current.get(value);
      node.getAnimations().forEach(animation => animation.cancel());
      if (!before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
      const after = node.getBoundingClientRect();
      const x = before.left - after.left, y = before.top - after.top;
      if (x || y) node.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: 180, easing: 'ease-out' });
    }
    positions.current.clear();
  }, [order]);

  function finish() {
    const source = dragging.current;
    if (!source) return;
    dragging.current = null;
    setActiveDrag(null);
    try {
      localStorage.setItem(NAVIGATION_ORDER_KEY, JSON.stringify(order));
      setMessage(`已调整${tabTitles[source]}的位置，顺序已保存。`);
    } catch { setMessage('顺序未能保存，请重新调整重试。'); }
  }

  return <nav className={styles.nav} aria-label="设置导航">
    {navigationGroups.map(group => {
      const tabs = order.filter(value => group.tabs.includes(value));
      return <div className={styles.navGroup} key={group.label}>
        <div className={styles.navLabel}>{group.label}</div>
        {tabs.map(value => <div key={value} ref={node => { if (node) items.current.set(value, node); else items.current.delete(value); }}
          className={`${styles.navItem} ${activeDrag === value ? styles.navDragging : ''}`}
          onDragOver={event => {
            const source = dragging.current;
            if (!source || !group.tabs.includes(source)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (source === value) return;
            // 越过目标中线后才换位，减少边缘处的反复移动。
            const target = event.currentTarget;
            const sourceNode = items.current.get(source)!;
            const rect = target.getBoundingClientRect();
            const horizontal = sourceNode.offsetTop === target.offsetTop;
            const pointer = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
            const middle = (horizontal ? rect.width : rect.height) / 2;
            const forward = order.indexOf(source) < order.indexOf(value);
            if (forward ? pointer < middle : pointer > middle) return;
            preview(moveNavigationTab(order, source, value));
          }}
          onDrop={event => {
            if (!dragging.current || !group.tabs.includes(dragging.current)) return;
            event.preventDefault();
            finish();
          }}>
          <Button draggable className={`${styles.navLink} ${tab === value ? styles.active : ''}`} aria-current={tab === value ? 'page' : undefined}
            onClick={() => onChange(value)}
            onDragStart={event => {
              dragging.current = value;
              originalOrder.current = order;
              setActiveDrag(value);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', value);
            }}
            onDragEnd={() => {
              if (dragging.current) preview(originalOrder.current);
              dragging.current = null;
              setActiveDrag(null);
            }}>
            <Icon name={value} /><span className={styles.navTitle}>{tabTitles[value]}</span>
            <span className={styles.navGrip} title="拖动调整顺序"><Icon name="grip" /></span>
          </Button>
        </div>)}
      </div>;
    })}
    {message && <p className={styles.navHint} role="status">{message}</p>}
  </nav>;
}
