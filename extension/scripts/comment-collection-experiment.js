// 供 CDP 注入可信扩展后台的小规模只读实验，记录性能与完整性，异常时停止且不重试。
export function createCommentExperiment(sign) {
  const logs = [], rounds = [], sources = [], controller = new AbortController();
  let turn = Promise.resolve(), lastStart = -Infinity, active = 0, stopped = '', keys;
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  const guard = () => {
    if (stopped) throw new Error(stopped);
    if (logs.length >= 160) throw new Error('达到本轮实验的160次请求预算。');
    controller.signal.throwIfAborted();
  };
  async function request(path, options) {
    guard();
    const entry = { round: options.name, path: path.split('?')[0], root: options.root, pn: options.pn, ps: options.ps };
    turn = turn.then(async () => {
      await wait(Math.max(0,lastStart + options.gap - performance.now())); guard();
      entry.start = performance.now(); entry.sincePrevious = Number.isFinite(lastStart) ? entry.start-lastStart : null;
      lastStart = entry.start; entry.inFlight = ++active; logs.push(entry);
    });
    await turn;
    try {
      const response = await fetch(`https://api.bilibili.com${path}`, {
        credentials: 'include', redirect: 'error', signal: AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),
      });
      entry.http = response.status; entry.retryAfter = response.headers.get('Retry-After');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text(); entry.bytes = new TextEncoder().encode(text).length;
      const json = JSON.parse(text); entry.code = json.code;
      if (json.code !== 0 || !json.data) throw new Error(`业务状态 ${json.code}：${json.message || '缺少数据'}`);
      entry.returned = json.data.replies?.length;
      entry.page = json.data.page; entry.expected = json.data.cursor?.all_count;
      entry.duration = performance.now()-entry.start;
      if (entry.duration > 3000) throw new Error('响应超过3秒，停止进一步提速实验。');
      return json.data;
    } catch (error) {
      entry.error = String(error); stopped ||= entry.error; controller.abort(); throw error;
    } finally { entry.duration = performance.now()-entry.start; active--; }
  }
  async function rest() { guard(); await wait(Math.max(0,lastStart+5000-performance.now())); }
  async function main(oid, { name = 'main', gap = 1000, pages = 20, mode = '2' } = {}) {
    await rest();
    if (!keys) {
      const nav = await request('/x/web-interface/nav',{ name, gap });
      const key = url => url.slice(url.lastIndexOf('/')+1).split('.')[0];
      keys = { img: key(nav.wbi_img.img_url), sub: key(nav.wbi_img.sub_url) };
    }
    const roots = new Map(), ids = new Set(); let offset = '', expected = 0, end = false, selected = false;
    const start = performance.now(), first = logs.length;
    for (let page = 0; page < pages; page++) {
      const query = sign({ oid, type: '1', mode, pagination_str: JSON.stringify({ offset }), plat: '1', web_location: '1315875' },keys.img,keys.sub);
      const data = await request(`/x/v2/reply/wbi/main?${query}`,{ name, gap });
      expected = data.cursor.all_count; end = data.cursor.is_end; selected ||= data.control?.web_selection === true;
      for (const root of [...(data.top_replies || []),...(data.replies || [])]) {
        if (root.invisible) continue;
        const previews = (root.replies || []).filter(reply => !reply.invisible).map(reply => reply.rpid_str);
        roots.set(root.rpid_str,{ id: root.rpid_str, replies: root.rcount, previews });
        ids.add(root.rpid_str); for (const id of previews) ids.add(id);
      }
      if (end) break;
      const next = data.cursor.pagination_reply?.next_offset;
      if (!next) throw new Error('主评论未结束但缺少游标，停止该样本。');
      offset = next;
    }
    const result = { name, oid, gap, mode, expected, end, selected, elapsed: performance.now()-start,
      requests: logs.length-first, roots: [...roots.values()], ids: [...ids].sort() };
    rounds.push(result); return result;
  }
  async function replies(oid, roots, { name, gap, afterResponse = 0, concurrency = 1, ps = 20, budget = 50 }) {
    await rest();
    const start = performance.now(), first = logs.length, results = [];
    let next = 0, issued = 0;
    const worker = async () => {
      while (next < roots.length) {
        guard(); const root = roots[next++], ids = new Set(); let expected = root.replies, size = ps, end = false;
        for (let pn = 1; !end; pn++) {
          if (++issued > budget) throw new Error('达到本组实验请求预算。');
          if (afterResponse) await wait(afterResponse);
          const data = await request(`/x/v2/reply/reply?${new URLSearchParams({ oid, type: '1', root: root.id, ps: String(ps), pn: String(pn) })}`,
            { name, gap, root: root.id, pn, ps });
          expected = data.page.count; size = data.page.size; end = data.page.num*size >= expected;
          for (const reply of data.replies || []) if (!reply.invisible) ids.add(reply.rpid_str);
          if (!end && !data.replies?.length) throw new Error('回复分页提前为空，停止该组。');
        }
        results.push({ root: root.id, expected, declared: root.replies, pageSize: size, total: ids.size, complete: ids.size === expected, ids: [...ids].sort() });
      }
    };
    const tasks = await Promise.allSettled(Array.from({ length: concurrency },worker));
    const requests = logs.slice(first), durations = requests.map(item => item.duration).sort((a,b) => a-b);
    const gaps = requests.slice(1).map(item => item.sincePrevious);
    const result = { name, oid, gap, afterResponse, concurrency, ps, requests: requests.length, elapsed: performance.now()-start,
      minStartGap: Math.min(...gaps), maxInFlight: Math.max(...requests.map(item => item.inFlight)),
      median: durations[Math.floor(durations.length*.5)], p95: durations[Math.min(durations.length-1,Math.floor(durations.length*.95))],
      errors: tasks.filter(item => item.status === 'rejected').map(item => String(item.reason)),
      complete: tasks.every(item => item.status === 'fulfilled') && results.length === roots.length && results.every(item => item.complete), results };
    rounds.push(result); return result;
  }
  return {
    async source(bvid) {
      const data = await request(`/x/web-interface/view?bvid=${bvid}`,{ name: 'metadata', gap: 1000 });
      const result = { bvid, oid: String(data.aid), title: data.title, comments: data.stat.reply }; sources.push(result); return result;
    }, main, replies,
    snapshot: () => ({ at: new Date().toISOString(), stopped, sources, requests: logs, rounds }),
    stop: () => { stopped = '手动停止实验。'; controller.abort(); },
  };
}
