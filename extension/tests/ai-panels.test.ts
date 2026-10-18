// 离线验收实际React面板的分页、原生章节、部分评论说明及受控正文，不读取真实存储。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { VideoAssistantSettings } from '../src/ui/VideoAssistantSettings';
import { migrateSettings } from '../src/core';
import { AnalysisStreamingPreview } from '../src/ui/AnalysisInteraction';
import { VideoPanel, type VideoPanelActions, type VideoPanelState } from '../src/video-panel';
import { CommentCard, type CommentCardActions, type CommentCardState } from '../src/comment-card';
import { VideoChat } from '../src/ui/ai/VideoChat';
const videoActions: VideoPanelActions = { density: vi.fn(), read: vi.fn(), language: vi.fn(), analyze: vi.fn(), cancel: vi.fn(), seek: vi.fn(), export: vi.fn(), media: vi.fn(), download: vi.fn(), clear: vi.fn(), settings: vi.fn() };
const commentActions: CommentCardActions = { collect: vi.fn(), pause: vi.fn(), analyze: vi.fn(), cancel: vi.fn(), copy: vi.fn(), download: vi.fn(), settings: vi.fn(), jump: vi.fn(), context: vi.fn() };
test('实际视频面板保留五分页与键盘焦点入口，没有字幕也显示官方章节', () => {
  const state: VideoPanelState = { source: { bvid: 'BVtest', aid: 1, cid: 1, page: 1, title: '视频', part: '', duration: 30, parts: [], tracks: [],
    nativeChapters: [{ start: 0, end: 30, title: '官方章节', summary: '', ad: false }] }, cache: null, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect((html.match(/role="tab"/g) ?? [])).toHaveLength(5);
  expect((html.match(/role="tabpanel"/g) ?? [])).toHaveLength(5);
  expect(html).toContain('官方章节'); expect(html).toContain('aria-controls="bb-video-pane-subtitles"');
  expect(html).toMatch(/class="toolbar" hidden=""/);
  expect(videoActions.analyze).not.toHaveBeenCalled();
});
test('评论面板保留部分覆盖说明和真实来源，评论原文不会成为HTML', () => {
  const state: CommentCardState = { status: '', error: '', collecting: false, paused: true, analyzing: false, preview: '', complete: false, loadingCache: false, useVideoSummary: true,
    total: 1, expected: 10, selected: 1, result: { bvid: 'BVtest', title: '视频', key: '', at: 1, total: 1, selected: 1, complete: false, expected: 10,
      summary: '**有依据的观点**', topics: [], valuable: [{ id: '123', reason: '具体解释' }], sources: [{ id: '123', root: '0', parent: '0', author: '甲', text: '<img src=x onerror=alert(1)>', time: 1, likes: 1, replies: 0 }] } };
  const html = renderToStaticMarkup(createElement(CommentCard,{ state, actions: commentActions, position: () => ({} as DOMRect), place: vi.fn(), mount: vi.fn() }));
  expect(html).toContain('#reply123');
  const collect = html.match(/<button\b[^>]*class="[^"]*\bcollect\b[^"]*"[^>]*>/)?.[0];
  expect(collect).toBeDefined(); expect(collect).not.toMatch(/\b(?:disabled|hidden)=""/);
  // 部分覆盖必须额外提示，但不固定提示的措辞。
  const complete = renderToStaticMarkup(createElement(CommentCard,{ state: { ...state, result: { ...state.result!, complete: true } }, actions: commentActions, position: () => ({} as DOMRect), place: vi.fn(), mount: vi.fn() }));
  expect((html.match(/<small>/g) ?? []).length).toBe((complete.match(/<small>/g) ?? []).length + 1);
  expect(html).toContain('data-streamdown="strong"'); expect(html).not.toContain('<img');
  expect(commentActions.collect).not.toHaveBeenCalled(); expect(commentActions.analyze).not.toHaveBeenCalled();
  expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
});


test('计划增量显示建议和澄清选项，但没有可用的应用入口', () => {
  const html = renderToStaticMarkup(createElement(AnalysisStreamingPreview,{ summary: '', value: {
    summary: '分析说明', question: '更关注哪方面？', options: ['数学'],
    suggestions: [{ side: 'positive', field: 'text', word: '代数', reason: '准备考试' }],
  } }));
  expect(html).toContain('代数'); expect(html.replace(/<[^>]*>/g,'')).toContain('准备考试'); expect(html).toContain('更关注哪方面');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>数学/);
  expect(html).toMatch(/<input[^>]*disabled=""/);
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button).toContain('disabled=""');
});

test('评论增量展示话题和推荐理由，引用尚未校验时不提供楼层链接', () => {
  const state: CommentCardState = { status: '', error: '', collecting: false, paused: true, analyzing: true, preview: '总览', complete: false, loadingCache: false, useVideoSummary: false,
    total: 1, expected: 1, selected: 1, result: null, partial: { topics: [{ title: '讨论话题', summary: '正在补充论据', refs: ['999'] }], valuable: [{ id: '999', reason: '具体解释' }] } };
  const html = renderToStaticMarkup(createElement(CommentCard,{ state, actions: commentActions, position: () => ({} as DOMRect), place: vi.fn(), mount: vi.fn() }));
  expect(html).toContain('讨论话题'); expect(html.replace(/<[^>]*>/g,'')).toContain('正在补充论据'); expect(html.replace(/<[^>]*>/g,'')).toContain('具体解释');
  expect(html).not.toContain('#reply'); expect(html).not.toContain('href=');
});

test('章节增量显示标题与说明，不提供跳转和跳广告操作', () => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task: 'chapters', status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '',
    chaptersPreview: [{ first: 0, title: '本章标题', summary: '本章说明', ad: true }] };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect(html).toContain('本章标题'); expect(html.replace(/<[^>]*>/g,'')).toContain('本章说明');
  expect(html).not.toMatch(/<button\b[^>]*class="[^"]*\b(?:skip|timestamp)\b/);
});


test.each(['summary','chapters','chat'] as const)('视频%s生成中仅保留一个可用取消入口，隐藏当前任务的次要操作', task => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task, status: '测试状态：当前任务进行中', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect(html).not.toContain(state.status);
  const cancels = html.match(/<button\b[^>]*class="[^"]*\bcancel\b[^"]*"[^>]*>/g) ?? [];
  expect(cancels).toHaveLength(1);
  expect(cancels[0]).not.toMatch(/\b(?:disabled|hidden)=""/);
  if (task === 'summary') { expect(html).not.toContain('copy-summary'); expect(html).not.toContain('export-summary'); }
  if (task === 'chapters') expect(html).not.toMatch(/<select\b[^>]*class="density"/);
});


test('设置页的章节密度为三项单选，三档数量上下限分别可调', () => {
  const html = renderToStaticMarkup(createElement(VideoAssistantSettings,{ draft: migrateSettings(), setDraft: vi.fn(), onServices: vi.fn() }));
  expect((html.match(/type="radio"/g) ?? [])).toHaveLength(3);
  for (const density of ['concise','balanced','detailed']) expect(html).toMatch(new RegExp(`<input[^>]*type="radio"[^>]*name="chapter-density"[^>]*value="${density}"`));
  expect(html.match(/<input[^>]*type="radio"[^>]*checked=""/g)).toHaveLength(1);
  expect(html.match(/<input[^>]*type="number"[^>]*min="1"[^>]*step="1"/g)).toHaveLength(6);
});

test('字幕跟随播放初始为开启状态', () => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
});

test('问答没有字幕时禁用输入与发送；生成中保留可用取消入口和已提交问题', () => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '已提交的问题', mediaLoading: false, mediaError: '' };
  const render = () => renderToStaticMarkup(createElement(VideoChat,{ state, actions: videoActions, question: '', setQuestion: vi.fn(), active: true }));
  let html = render();
  expect(html).toMatch(/<textarea[^>]*disabled=""/); expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  state.task = 'chat'; html = render();
  expect(html).toContain(state.question); expect(html).toMatch(/<div[^>]*role="status">[^<]+/);
  const cancel = html.match(/<button\b[^>]*class="[^"]*\bcancel\b[^"]*"[^>]*>/)?.[0];
  expect(cancel).toBeDefined(); expect(cancel).not.toMatch(/\b(?:disabled|hidden)=""/);
  state.preview = '回答正文[[0]]'; html = render();
  expect(html.replace(/<[^>]*>/g,'')).toContain('回答正文'); expect(html).not.toContain('[[0]]');
});


test('视频问答流式正文隐藏批量引用及尚未完成的引用标记', () => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: true, task: 'chat', status: '', error: '', preview: '', question: '解释源码', mediaLoading: false, mediaError: '' };
  for (const suffix of ['[[3,4,5,6,7]]','[[40,41,42','[[101,102,103]','[[30–33]][[52–61]]','[[30–']) {
    state.preview = '源码说明'+suffix;
    const html = renderToStaticMarkup(createElement(VideoChat,{ state, actions: videoActions, question: '', setQuestion: vi.fn(), active: true }));
    expect(html.replace(/<[^>]*>/g,'')).toContain('源码说明');
    expect(html).not.toContain('[[');
    expect(html).not.toContain('3,4,5'); expect(html).not.toContain('40,41'); expect(html).not.toContain('101,102');
  }
});

test('旧问答的区间引用恢复为时间来源入口，并与已存来源去重', () => {
  const state: VideoPanelState = { source: null, cache: {
    source: { bvid: 'BVtest', aid: 1, cid: 1, page: 1, title: '视频', part: '', duration: 400, parts: [], tracks: [] },
    language: 'zh', fingerprint: 'test', at: 1,
    rows: Array.from({ length: 100 },(_,i) => ({ start: i*2, end: i*2+2, text: '字幕'+i })),
    answers: [{ question: '核心观点？', answer: '两项技术[[30–33]][[52–61]][[99–101]]', refs: [30], selection: { providerId: 'deepseek', model: 'deepseek-flash' }, at: 1 }],
  }, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoChat,{ state, actions: videoActions, question: '', setQuestion: vi.fn(), active: true }));
  expect(html).toContain('两项技术'); expect(html).not.toContain('[[');
  const refs = html.match(/<div class="refs"[^>]*>(.*?)<\/div>/)?.[1];
  expect(refs).toBeDefined();
  expect(refs!.match(/<button\b/g)).toHaveLength(2);
  expect(refs!.match(/01:00/g)).toHaveLength(1); expect(refs!.match(/01:44/g)).toHaveLength(1);
  expect(refs).not.toContain('03:18');
});
