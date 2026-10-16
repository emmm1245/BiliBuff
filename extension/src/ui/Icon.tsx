// 设置页共用的轻量线条图标。
export function Icon({ name }: { name: 'tv' | 'rules' | 'home' | 'quickRead' | 'analysis' | 'services' | 'data' | 'preferences' | 'check' | 'eye' | 'eyeOff' }) {
  const paths = {
    tv: <><path d="m7 3 3 4m7-4-3 4" /><rect x="3" y="7" width="18" height="14" rx="4" /><path d="M8 12v3m8-3v3" /></>,
    rules: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" /></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21v-8h6v8" /></>,
    quickRead: <><path d="M21 11a8 8 0 0 1-8 8H7l-5 3 1.5-6A8 8 0 1 1 21 11Z" /><path d="M7 8h10M7 12h7" /></>,
    services: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M12 10v4" /></>,
    data: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3" /></>,
    analysis: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z" /></>,
    preferences: <><path d="M3 6h7m4 0h7M3 12h12m4 0h2M3 18h2m4 0h12" /><circle cx="12" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="7" cy="18" r="2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18M9 5.5A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4M6 6.5A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4" /></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
