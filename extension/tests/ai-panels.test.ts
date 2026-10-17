// 离线验收实际React面板的分页、原生章节、部分评论说明及受控正文，不读取真实存储。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { VideoAssistantSettings } from '../src/ui/VideoAssistantSettings';
import { migrateSettings } from '../src/core';
import { AnalysisStreamingPreview } from '../src/ui/AnalysisInteraction';
import { VideoPanel, type VideoPanelActions, type VideoPanelState } from '../src/video-panel';
import { CommentCard, type CommentCardActions, type CommentCardState } from '../src/comment-card';
const videoActions: VideoPanelActions = { density: vi.fn(), read: vi.fn(), language: vi.fn(), analyze: vi.fn(), cancel: vi.fn(), seek: vi.fn(), export: vi.fn(), media: vi.fn(), download: vi.fn(), clear: vi.fn(), settings: vi.fn() };
const commentActions: CommentCardActions = { collect: vi.fn(), pause: vi.fn(), analyze: vi.fn(), cancel: vi.fn(), copy: vi.fn(), download: vi.fn(), settings: vi.fn(), jump: vi.fn() };
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
  const state: CommentCardState = { status: '', error: '', collecting: false, paused: true, analyzing: false, preview: '', complete: false, loadingCache: false,
    total: 1, expected: 10, selected: 1, result: { bvid: 'BVtest', title: '视频', key: '', at: 1, total: 1, selected: 1, complete: false, expected: 10,
      summary: '**有依据的观点**', topics: [], valuable: [{ id: '123', reason: '具体解释' }], sources: [{ id: '123', root: '0', parent: '0', author: '甲', text: '<img src=x onerror=alert(1)>', time: 1, likes: 1, replies: 0 }] } };
  const html = renderToStaticMarkup(createElement(CommentCard,{ state, actions: commentActions, position: () => ({} as DOMRect), place: vi.fn(), mount: vi.fn() }));
  expect(html).toContain('部分采集结果'); expect(html).toContain('继续采集'); expect(html).toContain('#reply123');
  expect(html).toContain('data-streamdown="strong"'); expect(html).not.toContain('<img');
  expect(commentActions.collect).not.toHaveBeenCalled(); expect(commentActions.analyze).not.toHaveBeenCalled();
});


test('计划增量显示建议和澄清选项，但没有可用的应用入口', () => {
  const html = renderToStaticMarkup(createElement(AnalysisStreamingPreview,{ summary: '', value: {
    summary: '分析说明', question: '更关注哪方面？', options: ['数学'],
    suggestions: [{ side: 'positive', field: 'text', word: '代数', reason: '准备考试' }],
  } }));
  expect(html).toContain('代数'); expect(html.replace(/<[^>]*>/g,'')).toContain('准备考试'); expect(html).toContain('更关注哪方面');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>数学/);
  expect(html).toMatch(/<input[^>]*disabled=""/); expect(html).not.toContain('采用所选建议');
});

test('评论增量展示话题和推荐理由，引用尚未校验时不提供楼层链接', () => {
  const state: CommentCardState = { status: '', error: '', collecting: false, paused: true, analyzing: true, preview: '总览', complete: false, loadingCache: false,
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
  expect(html).not.toContain('跳过至'); expect(html).not.toContain('class="link timestamp"');
});


test.each(['summary','chapters','chat'] as const)('视频%s生成中仅保留一个可用取消入口，隐藏当前任务的次要操作', task => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task, status: '正在阅读视频…', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect(html).not.toContain('正在阅读视频');
  expect((html.match(/>取消生成<\/button>/g) ?? [])).toHaveLength(1);
  expect(html).toMatch(/<button[^>]*class="[^"]*cancel[^>]*>取消生成<\/button>/);
  if (task === 'summary') { expect(html).not.toContain('copy-summary'); expect(html).not.toContain('export-summary'); }
  if (task === 'chapters') expect(html).not.toContain('aria-label="章节密度"');
});


test('设置页的章节密度为三项单选，三档数量上下限分别可调', () => {
  const html = renderToStaticMarkup(createElement(VideoAssistantSettings,{ draft: migrateSettings(), setDraft: vi.fn(), onServices: vi.fn() }));
  expect((html.match(/type="radio"/g) ?? [])).toHaveLength(3);
  for (const label of ['精简下限','精简上限','适中下限','适中上限','详细下限','详细上限']) expect(html).toContain(label);
  expect(html).toContain('广告另算');
});

test('字幕跟随播放初始为开启状态', () => {
  const state: VideoPanelState = { source: null, cache: null, media: [], busy: false, task: null, status: '', error: '', preview: '', question: '', mediaLoading: false, mediaError: '' };
  const html = renderToStaticMarkup(createElement(VideoPanel,{ state, actions: videoActions }));
  expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
});
