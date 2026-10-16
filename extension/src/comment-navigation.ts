// 通过原站评论组件的属性入口在当前视频定位并高亮评论，不导航或重建播放器。
function shadowRoots(host: Element): ShadowRoot[] {
  const root = host.shadowRoot;
  return root ? [root,...[...root.querySelectorAll('*')].flatMap(shadowRoots)] : [];
}
function spotlight(host: HTMLElement): HTMLElement | undefined {
  return shadowRoots(host).map(root => root.querySelector<HTMLElement>('#body.spotlight')).find(element => element !== null);
}
function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve,reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },ms);
    signal.addEventListener('abort',abort,{ once: true });
  });
}
export async function jumpToComment(id: string, signal: AbortSignal) {
  if (!/^\d+$/.test(id)) throw new Error('评论编号无效。');
  const host = document.querySelector<HTMLElement>('bili-comments');
  const params = host?.getAttribute('data-params');
  if (!host || !params || params === '0,0') throw new Error('当前页面评论区尚未准备好，请稍后重试。');
  const roots = shadowRoots(host);
  if (roots.some(root => [...root.querySelectorAll<HTMLElement | HTMLTextAreaElement>('textarea,[contenteditable="true"]')]
    .some(input => ('value' in input ? input.value : input.textContent)?.trim()))) throw new Error('评论输入框里有未发送的内容，请先处理后再定位。');
  const original = ['seek-id','lazy-load'].map(name => [name,host.getAttribute(name)] as const);
  try {
    signal.throwIfAborted();
    host.setAttribute('seek-id',id);
    host.removeAttribute('lazy-load');
    // 两次属性更新分开提交，让原站清空评论列表，再按定位编号读取目标楼层。
    host.setAttribute('data-params','0,0');
    await delay(0,signal);
    host.setAttribute('data-params',params);
    const deadline = Date.now()+15000;
    let target: HTMLElement | undefined;
    while (!target && Date.now()<deadline) {
      await delay(150,signal);
      if (!host.isConnected || host.getAttribute('data-params') !== params) throw new Error('视频已切换，已停止定位。');
      target = spotlight(host);
    }
    if (!target) throw new Error('未找到目标评论，可能已删除、不可见或加载失败，请稍后重试。');
    await delay(400,signal);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    if (host.getAttribute('data-params') === '0,0') host.setAttribute('data-params',params);
    if (host.getAttribute('data-params') === params) for (const [name,value] of original) {
      if (value === null) host.removeAttribute(name); else host.setAttribute(name,value);
    }
  }
}
