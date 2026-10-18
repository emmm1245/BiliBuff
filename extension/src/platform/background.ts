// 管理可信存储、标签与评论请求、AI 分析复核、累计记录和扩展页面消息。
import { browser } from 'wxt/browser';
import { parseMessage } from './messages';
import { mayAccess } from '../access';
import { allEvents, counts, mergeEvents } from '../database';
import { analysisPool, selectBlockedSamples } from '../sampling';
import { currentSettings, migrateSettings, validateBackup, validateEvent, validatePlan, validateResult, validateSettings } from '../core';
import { requestTags } from '../tags';
import { createReviewer } from '../review';
import type { Backup, Message, Preferences } from '../types';
import { parseTheme, THEME_KEY } from '../theme';
import { requestSuggestions } from '../search';
import { aiConnection, validateProviderKeys } from '../ai-providers';
import { createCommentService } from '../comment-service';
import type { QuickReadProgress } from '../comment-types';
import { allDebugLogs, clearDebugLogs, debugState, setDebugEnabled } from '../ai-debug';
import { createVideoService } from '../video-service';
import { registerVideoDownloads } from '../video-download';
import type { VideoProgress } from '../video-types';
import { defaultVideoOptions } from '../video-ai';
import type { VideoSelection } from '../video-types';
import { createBrowseService } from '../browse-service';

export const PREFERENCES_KEY = 'preferences';
export function startBackground() {
  const initialized = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(async () => {
    const saved = await browser.storage.local.get(PREFERENCES_KEY);
    const prefs = saved[PREFERENCES_KEY] as Preferences | undefined;
    if (!prefs) await browser.storage.local.set({ [PREFERENCES_KEY]: {
      schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: '', decisionApiKey: '', reviewRevision: 0, result: null,
    } satisfies Preferences });
    else if (prefs.schemaVersion !== 1) throw new Error('本地配置版本不受支持，请使用匹配版本的扩展。');
    else if (!prefs.settings.videoAssistant) {
      const settings = currentSettings(prefs.settings);
      const legacy = (await browser.storage.local.get('video-workbench-selection'))['video-workbench-selection'] as VideoSelection | undefined;
      const selection = legacy && settings.providers.some(p => p.id === legacy.providerId) ? legacy : { providerId: settings.ai.providerId ?? 'deepseek', model: settings.ai.model };
      await browser.storage.local.set({ [PREFERENCES_KEY]: { ...prefs, settings: { ...settings, videoAssistant: defaultVideoOptions(selection) } } });
    }
  });
  async function preferences(): Promise<Preferences> {
    await initialized;
    const prefs = (await browser.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY] as Preferences;
    return { ...prefs, providerKeys: prefs.providerKeys ?? {}, decisionApiKey: prefs.decisionApiKey ?? '', settings: currentSettings(prefs.settings) };
  }
  const reviewer = createReviewer(preferences, requestTags);
  const comments = createCommentService(preferences);
  const videos = createVideoService(preferences);
  const browse = createBrowseService(preferences);
  registerVideoDownloads();
  async function publishTheme(value: unknown) {
    const theme = parseTheme(value);
    const tabs = await browser.tabs.query({ url: 'https://www.bilibili.com/*' });
    await Promise.allSettled(tabs.filter(tab => tab.id != null).map(tab => browser.tabs.sendMessage(tab.id!, { type: 'theme-changed', theme })));
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && THEME_KEY in changes) void publishTheme(changes[THEME_KEY]?.newValue).catch(() => {});
  });
  let mutations: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>) {
    const task = mutations.then(work);
    mutations = task.catch(() => {});
    return task;
  }
  async function publish(prefs: Preferences, rulesChanged = false) {
    browse.invalidate(prefs);
    if (rulesChanged) { reviewer.invalidate(); prefs.reviewRevision = (prefs.reviewRevision ?? 0) + 1; }
    await browser.storage.local.set({ [PREFERENCES_KEY]: prefs });
    if (rulesChanged) {
      // 保存只等待本机写入；休眠页面的通知不能占住保存队列，页面恢复时会主动读取。
      void browser.tabs.query({ url: 'https://www.bilibili.com/*' }).then(tabs =>
        Promise.allSettled(tabs.filter(tab => tab.id != null).map(tab => browser.tabs.sendMessage(tab.id!, { type: 'rules-changed' })))
      ).catch(() => {});
    }
  }
  async function handle(message: Message, progress: (value: QuickReadProgress | VideoProgress) => void, owner: string): Promise<unknown> {
    await initialized;
    switch (message.type) {
      case 'browse-state': case 'browse-refresh': case 'browse-feedback': case 'browse-cancel': return browse.handle(message);
      case 'video-source': case 'video-subtitles': case 'video-selection': case 'video-cache-clear': case 'video-analyze': case 'video-cancel': case 'video-media': case 'video-download':
        return videos(message,progress,owner);
      case 'comments-source': case 'comments-page': case 'comments-cache': case 'comments-analyze': case 'comments-cancel': return comments(message,progress);
      case 'comments-context': return serialize(async () => {
        const prefs = await preferences();
        if (prefs.settings.quickRead.useVideoSummary !== message.enabled) {
          await publish({ ...prefs, revision: prefs.revision + 1, settings: { ...prefs.settings,
            quickRead: { ...prefs.settings.quickRead, useVideoSummary: message.enabled } } },true);
        }
        return message.enabled;
      });
      case 'video-density': return serialize(async () => {
        const prefs = await preferences();
        if (prefs.settings.videoAssistant.chapterDensity !== message.density) {
          await publish({ ...prefs, revision: prefs.revision + 1, settings: { ...prefs.settings,
            videoAssistant: { ...prefs.settings.videoAssistant, chapterDensity: message.density } } },true);
        }
        return message.density;
      });
      case 'suggest': return requestSuggestions(message.term);
      case 'theme': return parseTheme((await browser.storage.local.get(THEME_KEY))[THEME_KEY]);
      case 'rules': {
        const prefs = await preferences();
        // 仅覆盖网页的生效值，关闭AI推荐后仍使用原来的留白偏好。
        return { ...prefs.settings, homeSearch: prefs.settings.homeSearch || prefs.settings.browse.enabled, reviewRevision: prefs.reviewRevision ?? 0 };
      }
      case 'open-settings': return message.section ? browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#${message.section}` }) : browser.runtime.openOptionsPage();
      case 'tags': return requestTags(message.bvid);
      case 'review': return reviewer.request(message.bvid, message.title, message.durationSeconds);
      case 'record': return mergeEvents([validateEvent(message.event)]);
      case 'snapshot': {
        const pool = analysisPool(await allEvents());
        return { preferences: await preferences(), counts: await counts(),
          sampleCounts: { watched: pool.watched.length, blocked: pool.blocked.length }, reviewError: reviewer.error() };
      }
      case 'debug-state': return debugState();
      case 'debug-toggle':
        if (typeof message.enabled !== 'boolean') throw new Error('调试日志开关无效。');
        await setDebugEnabled(message.enabled);
        return;
      case 'debug-export': return { format: 'bilibili-focus-debug', version: 1, exportedAt: new Date().toISOString(), logs: await allDebugLogs() };
      case 'debug-clear': return clearDebugLogs();
      case 'samples': {
        const prefs = await preferences();
        const target = message.counts?.blocked ?? prefs.settings.minBlocked;
        const pool = analysisPool(await allEvents());
        return { watched: pool.watched.slice(0, message.counts?.watched ?? 100), blocked: selectBlockedSamples(pool.blocked, target) };
      }
      case 'save': return serialize(async () => {
        const prefs = await preferences();
        if (message.revision !== prefs.revision) throw new Error('其他设置页已保存，请重新读取后再编辑。');
        const settings = validateSettings(message.settings);
        if (message.apiKey !== undefined && (typeof message.apiKey !== 'string' || /\s/.test(message.apiKey))) throw new Error('密钥不能包含空白字符。');
        if (message.decisionApiKey !== undefined && (typeof message.decisionApiKey !== 'string' || /\s/.test(message.decisionApiKey))) throw new Error('阿里云密钥不能包含空白字符。');
        const next = { ...prefs, settings, revision: prefs.revision + 1, ...(message.apiKey !== undefined ? { apiKey: message.apiKey } : {}),
          providerKeys: message.providerKeys !== undefined ? validateProviderKeys(message.providerKeys, settings.providers) :
            Object.fromEntries(Object.entries(prefs.providerKeys ?? {}).filter(([id]) => settings.providers.some(provider => provider.id === id))),
          ...(message.decisionApiKey !== undefined ? { decisionApiKey: message.decisionApiKey } : {}) };
        if (settings.review.enabled) {
          validatePlan(prefs.plan, settings.planMaxLength);
          if (settings.review.mode === 'general') aiConnection(next, { providerId: settings.review.providerId, model: settings.review.model ?? 'deepseek-flash' });
          else if (!next.decisionApiKey || !settings.review.workspaceId) throw new Error('启用 AI 复核前，请填写对应密钥及阿里云业务空间标识。');
        }
        if (settings.quickRead.auto) aiConnection(next, settings.quickRead);
        if (settings.browse.enabled) { validatePlan(prefs.plan,settings.planMaxLength); aiConnection(next,settings.browse); }
        if (settings.videoAssistant.autoSummary) aiConnection(next,settings.videoAssistant.summary);
        if (settings.videoAssistant.autoChapters || settings.videoAssistant.autoSkipAds) aiConnection(next,settings.videoAssistant.chapters);
        await publish(next, true);
        return next;
      });
      case 'plan': return serialize(async () => {
        const prefs = await preferences();
        if (typeof message.plan !== 'string' || message.plan.length > 6000 ||
            (message.plan.length > prefs.settings.planMaxLength && message.plan.length >= prefs.plan.length)) throw new Error(`计划最多 ${prefs.settings.planMaxLength} 字，请在偏好设置中调整上限。`);
        if (message.plan === prefs.plan) return;
        await publish({ ...prefs, plan: message.plan }, true);
      });
      case 'result': return serialize(async () => {
        const prefs = await preferences();
        const result = validateResult(message.result);
        if (result.plan !== prefs.plan) throw new Error('计划已被其他设置页更改，本次建议未保存。');
        await publish({ ...prefs, result });
        return result;
      });
      case 'export': {
        const prefs = await preferences();
        return { format: 'bilibili-focus-backup', version: 1, exportedAt: new Date().toISOString(), settings: prefs.settings,
          plan: prefs.plan, result: prefs.result, events: await allEvents(), ...(message.includeKey ? { apiKey: prefs.apiKey, providerKeys: prefs.providerKeys ?? {}, decisionApiKey: prefs.decisionApiKey ?? '' } : {}) } satisfies Backup;
      }
      case 'import': return serialize(async () => {
        const backup = validateBackup(message.backup);
        const prefs = await preferences();
        await mergeEvents(backup.events);
        const providerKeys = backup.providerKeys ?? Object.fromEntries(backup.settings.providers.filter(provider =>
          provider.type === 'openai-compatible' && prefs.settings.providers.some(previous => previous.id === provider.id && previous.baseUrl === provider.baseUrl))
          .map(provider => [provider.id, prefs.providerKeys?.[provider.id] ?? '']));
        await publish({ ...prefs, settings: backup.settings, plan: backup.plan, result: backup.result,
          providerKeys,
          apiKey: backup.apiKey ?? prefs.apiKey, decisionApiKey: backup.decisionApiKey ?? prefs.decisionApiKey, revision: prefs.revision + 1 }, true);
      });
      default: throw new Error('不支持的扩展消息。');
    }
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message.type !== 'string' || !mayAccess(message.type, sender, browser.runtime.id, browser.runtime.getURL('/options.html'))) {
      respond({ ok: false, error: '此页面无权调用该功能。' }); return false;
    }
    const progress = (value: QuickReadProgress | VideoProgress) => {
      if (sender.tab?.id !== undefined) void browser.tabs.sendMessage(sender.tab.id,value,{ frameId: sender.frameId ?? 0 }).catch(() => {});
    };
    void Promise.resolve().then(() => handle(parseMessage(message),progress,`${sender.tab?.id ?? 'settings'}:${sender.frameId ?? 0}`)).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error instanceof Error ? error.message : '扩展操作失败。' }));
    return true;
  });
  browser.action.onClicked.addListener(() => { void browser.runtime.openOptionsPage(); });
}
