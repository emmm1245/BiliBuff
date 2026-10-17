// 使用现有依赖独立检查视频章节优先级、正文流式输出、字幕引用、自动跳过和独立设置迁移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeVideoChapters, videoTimeline, videoAnswer, indexedChunks } from '../src/video-data.ts';
import { adSkipTarget } from '../src/video-player.ts';
import { defaultVideoOptions, videoInputBudget, videoParameters } from '../src/video-ai.ts';
import { currentSettings, migrateSettings, validateSettings, validateBackup } from '../src/core.ts';
import { completedStream } from '../src/platform/completed-stream.ts';
import { mayAccess } from '../src/access.ts';
import { mediaStreamResource } from '../src/video-api.ts';

test('官方章节只接受真实分段、有效时间并拒绝重叠', () => {
  assert.deepEqual(nativeVideoChapters([{ type: 2, from: 0, to: 20, content: '开头' },{ type: 2, from: 20, to: 45, content: '正文' },{ type: 1, from: 1, to: 3, content: '非章节看点' }],40),[
    { start: 0, end: 20, title: '开头', summary: '', ad: false },{ start: 20, end: 40, title: '正文', summary: '', ad: false },
  ]);
  assert.deepEqual(nativeVideoChapters([{ type: 2, from: 5, to: 20, content: '一' },{ type: 2, from: 10, to: 30, content: '二' }],40),[]);
  assert.deepEqual(nativeVideoChapters([{ type: 2, from: -1, to: 3, content: '坏时间' }],40),[]);
});
test('没有字幕也能显示官方章节，生成章节不能覆盖官方章节或串视频', () => {
  const nativeChapters = [{ start: 0, end: 30, title: 'UP章节', summary: '', ad: false }];
  const source = { cid: 10, nativeChapters }, cache = { source: { cid: 10 }, rows: [{ start: 0, end: 5 }], chapters: { value: [{ first: 0, last: 0, title: '生成章节', summary: '正文', ad: true }] } };
  assert.equal(videoTimeline(source,null),nativeChapters); assert.equal(videoTimeline(source,cache),nativeChapters);
  assert.deepEqual(videoTimeline({ cid: 20 },cache),[]);
  assert.deepEqual(videoTimeline({ cid: 10 },cache),[{ start: 0, end: 5, title: '生成章节', summary: '正文', ad: true }]);
});
test('广告仅在区间内跳过一次，手动返回不会再次被跳走', () => {
  const chapters = [{ start: 5, end: 15, ad: true },{ start: 15, end: 20, ad: false }], skipped = new Set();
  assert.equal(adSkipTarget(chapters,4,skipped),null); assert.equal(adSkipTarget(chapters,7,skipped),15);
  assert.equal(adSkipTarget(chapters,6,skipped),null); assert.equal(adSkipTarget(chapters,15,new Set()),null);
});
test('问答正文直接保存，引用可定位且非法行号拒绝保存', () => {
  assert.deepEqual(videoAnswer('核心依据[[2]]，以及补充[[3]][[2]]',0,4),{ answer: '核心依据，以及补充', refs: [2,3] });
  assert.throws(() => videoAnswer('错误[[8]]',0,4),/无效字幕引用/);
  assert.throws(() => videoAnswer('[[1]]',0,4),/有效正文/);
});
test('总结问答不发送结构化输出约束，章节保留约束', () => {
  const selection = defaultVideoOptions().summary;
  assert.equal(videoParameters(selection,false).response_format,undefined);
  assert.deepEqual(videoParameters(selection,true).response_format,{ type: 'json_object' });
});
test('传输完成保护保留原始正文事件，具体解析由SDK测试验证', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) {
    for (const delta of ['直接','显示正文']) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); controller.close();
  } });
  const result = await completedStream(new Response(body),new AbortController().signal).text();
  assert.ok(result.includes('直接')); assert.ok(result.includes('显示正文')); assert.ok(result.includes('[DONE]'));
});
test('旧设置补齐三个独立模型配置，备份往返保留自动功能与各自参数', () => {
  const original = migrateSettings(), old = { ...original }; delete old.videoAssistant;
  assert.deepEqual(currentSettings(old).videoAssistant,defaultVideoOptions());
  original.videoAssistant.summary.maxTokens = 32768; original.videoAssistant.chapters.effort = 'high'; original.videoAssistant.autoSkipAds = true;
  assert.equal(original.videoAssistant.chat.maxTokens,8192);
  const restored = validateBackup({ format: 'bilibili-focus-backup', version: 1, settings: original, plan: '', events: [], result: null });
  assert.deepEqual(restored.settings.videoAssistant,original.videoAssistant);
  assert.throws(() => validateSettings({ ...original, videoAssistant: { ...original.videoAssistant, autoSummary: 'yes' } }),/开关/);
});
test('容量预算完整覆盖所有字幕，不能只截开头', () => {
  const rows = Array.from({ length: 100 },(_,i) => ({ start: i, end: i+1, text: '视频的真实内容'.repeat(100) }));
  const selection = { ...defaultVideoOptions().summary, contextTokens: 16000, maxTokens: 1024 };
  const chunks = indexedChunks(rows,videoInputBudget(selection));
  assert.ok(chunks.length > 1); assert.equal(chunks[0].first,0); assert.equal(chunks.at(-1).last,99);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].first,chunks[i-1].last+1);
});

test('视频助手设置深链接仍是可信设置页，外部页面不能借片段获得权限', () => {
  const options = 'chrome-extension://test/options.html';
  assert.equal(mayAccess('snapshot',{ id: 'test', url: options+'#videoAssistant' },'test',options),true);
  assert.equal(mayAccess('snapshot',{ id: 'test', url: 'https://evil.invalid/#'+options, frameId: 0 },'test',options),false);
});

test('媒体备用地址保留签名、优先常规CDN且拒绝不受支持的节点', () => {
  assert.equal(mediaStreamResource(['https://75un29t.edge.mountaintoys.cn/media','https://xy1.mcdn.bilivideo.cn/media','http://upos-sz-mirrorcoso1.bilivideo.com/media?sig=123']),'https://upos-sz-mirrorcoso1.bilivideo.com/media?sig=123');
  assert.equal(mediaStreamResource(['https://unsupported.invalid/media','https://bilivideo.com.evil.invalid/media']),undefined);
});
