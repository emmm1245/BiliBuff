// 编辑首页留白、壁纸和轮播显示，预览首页效果并自动保存。
import { Button } from './primitives/button';
import { Icon } from './Icon';
import { Card } from './primitives/card';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { MAX_WALLPAPER_BYTES, validateWallpaper } from '../core';
import type { Settings } from '../types';
import logo from '../assets/bilibili-text.svg';
import styles from './App.module.css';

export function SearchHomeSettings({ draft, setDraft }: { draft: Settings; setDraft: Dispatch<SetStateAction<Settings | null>> }) {
  const homeEnabled = draft.homeSearch || draft.browse.enabled;
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  async function upload(file: File) {
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_WALLPAPER_BYTES) {
      setError('请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。'); return;
    }
    setReading(true);
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('没能读取图片，请重新选择。'));
        reader.readAsDataURL(file);
      });
      const wallpaper = validateWallpaper(value);
      const image = new Image(); image.src = wallpaper;
      await image.decode();
      setDraft(previous => previous && { ...previous, homeWallpaper: wallpaper });
    } catch { setError('图片无法读取，请换一张 PNG、JPG 或 WebP 图片。'); }
    finally { setReading(false); }
  }
  return <>
    <Card className={styles.card}><h2>留白模式</h2>
      <label className={styles.switch}><input type="checkbox" checked={homeEnabled} disabled={draft.browse.enabled} onChange={event => setDraft({ ...draft, homeSearch: event.target.checked })} />使用留白首页</label>
      {draft.browse.enabled && <p className={styles.notice}>AI帮你刷开启期间固定使用留白首页。</p>}
    </Card>
    <Card className={styles.card}><h2>首页壁纸</h2>
    <div className={styles.homePreview} role="img" aria-label="留白首页预览：粉色哔哩哔哩标志、搜索框和你所热爱的，就是你的生活。">
      {draft.homeWallpaper && <div className={styles.previewWallpaper} style={{ backgroundImage: `url("${draft.homeWallpaper}")` }} />}
      <img src={logo} alt="" />
      <div className={styles.previewSearch}>搜点你热爱的<span><Icon name="arrowRight" size={17} /></span></div>
      <span className={styles.previewQuote}>你所热爱的，就是你的生活。</span>
    </div>
    <div className={styles.row}><span className={styles.notice}>{draft.homeWallpaper ? '自选壁纸' : '默认壁纸 · 跟随深浅主题'}</span>
      {draft.homeWallpaper && <Button type="button" disabled={reading} onClick={() => { setError(''); setDraft(previous => previous && { ...previous, homeWallpaper: '' }); }}>恢复默认壁纸</Button>}
    </div>
    <label className={styles.wallpaperUpload}>添加壁纸<input type="file" accept="image/png,image/jpeg,image/webp" disabled={reading} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file);
    }} /><span className={styles.notice}>{reading ? '正在读取图片…' : 'PNG、JPG 或 WebP，最大 2 MB'}</span></label>
    {error && <p className={styles.banner} role="alert">{error}</p>}
    </Card>
    <Card className={styles.card}><h2>原版首页</h2>
      <label className={styles.switch}><input type="checkbox" checked={draft.hideCarousel} disabled={homeEnabled} onChange={event => setDraft({ ...draft, hideCarousel: event.target.checked })} />隐藏首页推荐轮播</label>
      {homeEnabled && <p className={styles.notice}>关闭留白模式后可调整。</p>}
    </Card>
  </>;
}
