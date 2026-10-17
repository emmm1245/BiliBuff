// 串行保护设置保存，阻止同一失败草稿自动循环请求，同时允许编辑或主动重试。
export function createSaveGate() {
  let running = false;
  const failure = { current: '' };
  return { failure, async run(signature: string, work: () => Promise<void>) {
    if (running || failure.current === signature) return false;
    running = true;
    try { await work(); failure.current = ''; return true; }
    catch (error) { failure.current = signature; throw error; }
    finally { running = false; }
  } };
}
