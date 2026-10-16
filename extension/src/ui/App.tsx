// 管理设置页导航、自动保存、跨页冲突、分析与备份。
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { analyze, type AnalysisFollowup, type AnalysisTurn } from '../analysis';
import { send } from '../client';
import { mergeSuggestions, validateBackup, validateSettings } from '../core';
import { aiConnection } from '../ai-providers';
import type { AnalysisResult, Backup, Preferences, Settings, Side, Snapshot, WordField } from '../types';
import { emptyInputs, RuleEditor } from './RuleEditor';
import { ThemePicker } from './ThemePicker';
import { Icon } from './Icon';
import { BrandIcon } from './BrandIcon';
import { AIServiceSettings } from './AIServiceSettings';
import { AnalysisSettings } from './AnalysisSettings';
import { QuickReadSettings } from './QuickReadSettings';
import { ReviewSettings } from './ReviewSettings';
import { SearchHomeSettings } from './SearchHomeSettings';
import { DebugLogs } from './DebugLogs';
import { StorageUsage } from './StorageUsage';
import { AnalysisInteraction, ClarificationHistory } from './AnalysisInteraction';
import styles from './App.module.css';

const tabTitles = { rules: '内容过滤', home: '首页外观', quickRead: '评论速读', analysis: 'AI 计划分析', services: 'AI 服务', data: '数据与维护' };
type Tab = keyof typeof tabTitles;

export function App() {
  const [tab, setTab] = useState<Tab>('rules');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [revision, setRevision] = useState(0);
  const [inputs, setInputs] = useState({ ...emptyInputs });
  const [undo, setUndo] = useState<{ side: Side; field: WordField; word: string; index: number } | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [savedProviderKeys, setSavedProviderKeys] = useState<Record<string, string>>({});
  const [decisionKeyInput, setDecisionKeyInput] = useState('');
  const [savedKeys, setSavedKeys] = useState({ apiKey: '', decisionApiKey: '' });
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState('');
  const [includeKey, setIncludeKey] = useState(false);
  const [imported, setImported] = useState<Backup | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [pendingAnalysis, setPendingAnalysis] = useState<Extract<AnalysisTurn, { kind: 'clarification' }> | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState('');
  const [analysisCleared, setAnalysisCleared] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const planWrite = useRef<Promise<unknown>>(Promise.resolve());
  const planPending = useRef(0);
  const planDirtyRef = useRef(false);
  const busyRef = useRef(false);
  const savingRef = useRef(false);
  const revisionRef = useRef(revision); revisionRef.current = revision;
  const failedSave = useRef('');
  const pendingRef = useRef(false); pendingRef.current = Boolean(pendingAnalysis);
  const normalizedProviderKeys = Object.fromEntries(Object.entries(providerKeys).map(([id, value]) => [id, value.trim()]));
  const keysDirty = keyInput.trim() !== savedKeys.apiKey || decisionKeyInput.trim() !== savedKeys.decisionApiKey || JSON.stringify(normalizedProviderKeys) !== JSON.stringify(savedProviderKeys);
  const dirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(baseline) || Object.values(inputs).some(Boolean) || keysDirty || planError));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const conflict = Boolean(snapshot && snapshot.preferences.revision !== revision);
  const settingsDirty = Boolean(draft && (JSON.stringify(draft) !== JSON.stringify(baseline) || keysDirty));

  function changeTab(value: Tab) {
    setTab(value); window.scrollTo({ top: 0 });
    if (value === 'analysis' || value === 'data') void refresh().catch(error => setStatus(errorMessage(error)));
  }

  useEffect(() => {
    if (!settingsDirty && !saving) { setSaveError(''); failedSave.current = ''; return; }
    if (!settingsDirty || conflict || busy || pendingAnalysis || saving) return;
    const timer = window.setTimeout(() => { void save(); }, 200);
    return () => window.clearTimeout(timer);
  }, [draft, baseline, revision, keyInput, providerKeys, decisionKeyInput, settingsDirty, conflict, busy, pendingAnalysis, saving]);

  useEffect(() => { setSelected([]); }, [snapshot?.preferences.result?.at]);

  function load(value: Snapshot) {
    planDirtyRef.current = false;
    setPendingAnalysis(null); setAnalysisPreview('');
    setSnapshot(value); setDraft(structuredClone(value.preferences.settings));
    setBaseline(structuredClone(value.preferences.settings)); setRevision(value.preferences.revision); revisionRef.current = value.preferences.revision;
    setPlan(value.preferences.plan); setInputs({ ...emptyInputs }); setUndo(null); setKeyInput(value.preferences.apiKey); setSelected([]);
    setDecisionKeyInput(value.preferences.decisionApiKey ?? '');
    setProviderKeys(value.preferences.providerKeys ?? {}); setSavedProviderKeys(value.preferences.providerKeys ?? {});
    setSavedKeys({ apiKey: value.preferences.apiKey, decisionApiKey: value.preferences.decisionApiKey ?? '' });
    setSaveError(''); setPlanError(''); failedSave.current = '';
  }
  async function refresh() {
    const planAtRead = planWrite.current;
    const value = await send<Snapshot>({ type: 'snapshot' });
    if (value.preferences.revision >= revisionRef.current) setSnapshot(value);
    if (!planDirtyRef.current && planAtRead === planWrite.current) setPlan(value.preferences.plan);
    return value;
  }
  useEffect(() => {
    let alive = true;
    void send<Snapshot>({ type: 'snapshot' }).then(value => { if (alive) load(value); }).catch(error => { if (alive) setStatus(error.message); });
    const changed = () => {
      const planAtRead = planWrite.current;
      void send<Snapshot>({ type: 'snapshot' }).then(value => {
        if (!alive || value.preferences.revision < revisionRef.current) return;
        if (!dirtyRef.current && !savingRef.current && !busyRef.current && !pendingRef.current && !planDirtyRef.current && planAtRead === planWrite.current) load(value);
        else setSnapshot(value);
        if (!planDirtyRef.current && planAtRead === planWrite.current) setPlan(value.preferences.plan);
      }).catch(error => { if (alive) setStatus(error.message); });
    };
    const storageChanged = (changes: Record<string, unknown>, area: string) => { if (area === 'local' && changes.preferences) changed(); };
    browser.storage.onChanged.addListener(storageChanged);
    window.addEventListener('focus', changed);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current || busyRef.current || pendingRef.current || planDirtyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { alive = false; abort.current?.abort(); browser.storage.onChanged.removeListener(storageChanged); window.removeEventListener('focus', changed); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  function updatePlan(value: string) {
    if (snapshot && value.length > snapshot.preferences.settings.planMaxLength && value.length >= plan.length) {
      setStatus('计划已达到字数上限，可在本页“分析设置”中调整。'); return;
    }
    setPlan(value); planDirtyRef.current = true; planPending.current++; setPlanSaving(true); setPlanError('');
    const task = send({ type: 'plan', plan: value });
    planWrite.current = task;
    void task.then(() => { if (planWrite.current === task) planDirtyRef.current = false; }, error => {
      if (planWrite.current === task) setPlanError(`计划没能保存：${error.message}`);
    }).finally(() => { planPending.current--; if (!planPending.current) setPlanSaving(false); });
  }
  async function reload() {
    if (dirty && !confirm('重新读取会放弃本页还没保存的修改，继续吗？')) return;
    try { await planWrite.current.catch(() => {}); load(await send<Snapshot>({ type: 'snapshot' })); setStatus('已读取最新设置。'); } catch (error) { setStatus(errorMessage(error)); }
  }
  async function save() {
    if (!draft || savingRef.current) return;
    const signature = JSON.stringify([draft, keyInput, providerKeys, decisionKeyInput, revision]);
    if (failedSave.current === signature) return;
    try {
      const settings = validateSettings(draft);
      savingRef.current = true; setSaving(true); setSaveError('');
      await planWrite.current;
      const saved = await send<Preferences>({ type: 'save', settings, revision, ...(keyInput.trim() !== savedKeys.apiKey ? { apiKey: keyInput.trim() } : {}),
        providerKeys: normalizedProviderKeys,
        ...(decisionKeyInput.trim() !== savedKeys.decisionApiKey ? { decisionApiKey: decisionKeyInput.trim() } : {}) });
      // 只更新保存基线，保存期间继续输入的内容留待下一次写入。
      setBaseline(settings); setRevision(saved.revision); revisionRef.current = saved.revision;
      setDraft(current => current === draft ? structuredClone(settings) : current);
      setSnapshot(previous => previous && previous.preferences.revision <= saved.revision ? { ...previous, preferences: saved } : previous);
      setSavedKeys({ apiKey: saved.apiKey, decisionApiKey: saved.decisionApiKey ?? '' });
      setKeyInput(current => current === keyInput ? saved.apiKey : current);
      setSavedProviderKeys(saved.providerKeys ?? {});
      setProviderKeys(current => current === providerKeys ? saved.providerKeys ?? {} : current);
      setDecisionKeyInput(current => current === decisionKeyInput ? saved.decisionApiKey ?? '' : current);
      failedSave.current = '';
    } catch (error) { failedSave.current = signature; setSaveError(errorMessage(error)); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function runAnalysis(followup?: AnalysisFollowup) {
    if (!draft || busyRef.current) return;
    const controller = new AbortController(); abort.current = controller; busyRef.current = true; setBusy(true); setSelected([]); setAnalysisPreview('');
    setAnalysisCleared(true); setStatus('正在准备分析……');
    try {
      await planWrite.current;
      const latest = await refresh();
      const turn = await analyze(latest.preferences, structuredClone(draft), controller.signal, setStatus, setAnalysisPreview, followup);
      controller.signal.throwIfAborted();
      if (turn.kind === 'clarification') {
        setPendingAnalysis(turn); setStatus('请选择选项、自定义回答或跳过；本次尚未保存新建议。');
      } else {
        await send<AnalysisResult>({ type: 'result', result: turn.result });
        setPendingAnalysis(null); await refresh(); setAnalysisCleared(false); setStatus('分析好了，选中想采用的建议就可以加入规则。');
      }
    } catch (error) {
      setStatus(controller.signal.aborted ? '已取消分析。' : error instanceof Error && error.name === 'TimeoutError' ? '模型请求超时。' : errorMessage(error));
    } finally { busyRef.current = false; setBusy(false); abort.current = null; }
  }
  async function exportData() {
    try {
      await planWrite.current;
      const backup = await send<Backup>({ type: 'export', includeKey });
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `bilibuff-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000); setStatus('备份已导出。');
    } catch (error) { setStatus(errorMessage(error)); }
  }
  async function importData() {
    if (!imported || busy || !confirm('导入会替换规则、计划和上次建议，合并累计记录，并丢弃本页草稿。确认导入？')) return;
    setSaving(true);
    try { await planWrite.current; await send({ type: 'import', backup: imported }); load(await send<Snapshot>({ type: 'snapshot' })); setImported(null); setStatus('导入完成，累计记录已合并。'); }
    catch (error) { setStatus(errorMessage(error)); } finally { setSaving(false); }
  }
  if (!snapshot || !draft) return <main className={styles.main}><h1>BiliBuff · 哔哩哔哩</h1><p role="status">{status || '正在读取本机设置……'}</p><button onClick={() => void reload()}>重新读取</button></main>;
  const { counts, preferences } = snapshot;
  const result = analysisCleared ? null : preferences.result;
  const planTooLong = plan.length > preferences.settings.planMaxLength;
  let connectionError = '';
  let analysisService = '';
  try { const connection = aiConnection(preferences, preferences.settings.ai); analysisService = connection.provider.name; }
  catch (error) { connectionError = errorMessage(error); }
  const ready = counts.watched >= preferences.settings.minWatched && counts.blocked >= preferences.settings.minBlocked && !connectionError && Boolean(plan.trim()) && !planTooLong;
  const awaitingAnswer = Boolean(pendingAnalysis);
  const waiting = dirty || planSaving || saving;
  const saveMessage = conflict ? '保存已暂停' : saveError || planError ? '有修改未保存' : saving || planSaving ? '正在保存…' : dirty ? '等待保存…' : '已自动保存';
  return <div className={styles.layout}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span className={styles.brandIcon}><BrandIcon /></span><div>BiliBuff<span>哔哩哔哩</span></div></div>
      <nav className={styles.nav} aria-label="设置导航">{([
        { label: '日常功能', tabs: ['rules', 'home', 'quickRead', 'analysis'] },
        { label: '配置与维护', tabs: ['services', 'data'] },
      ] as const).map(group => <div className={styles.navGroup} key={group.label}><div className={styles.navLabel}>{group.label}</div>{group.tabs.map(value => <button key={value} className={tab === value ? styles.active : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => changeTab(value)}><Icon name={value} />{tabTitles[value]}</button>)}</div>)}</nav>
      <div className={styles.sidebarBottom}><ThemePicker /><p>上B站，学东西，有个Buff更顺手。</p></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.pageHeader}><h1>{tabTitles[tab]}</h1><span className={`${styles.saveBadge} ${saveError || planError || conflict ? styles.saveWarning : ''}`} role="status"><Icon name="check" />{saveMessage}</span></header>
      {conflict && <div className={styles.banner}>另一个设置页更新了规则，已暂停本页自动保存。你的修改还在，重新读取后可继续编辑。 <button disabled={busy || saving} onClick={() => void reload()}>读取最新设置</button></div>}
      {saveError && !conflict && <div className={styles.banner} role="alert">暂时没能保存：{saveError}<button disabled={saving} onClick={() => { failedSave.current = ''; void save(); }}>重试</button></div>}
      {planError && <div className={styles.banner} role="alert">{planError}<button onClick={() => updatePlan(plan)}>重试</button></div>}
      {tab !== 'analysis' && (busy || awaitingAnswer) && <div className={styles.activity} role="status">{busy ? '计划分析进行中，设置暂时不可编辑。' : '计划分析等待你的回答，设置暂时不可编辑。'}<button onClick={() => changeTab('analysis')}>返回分析</button></div>}
      <fieldset disabled={busy || awaitingAnswer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {tab === 'rules' && <><RuleEditor draft={draft} setDraft={setDraft} inputs={inputs} setInputs={setInputs} undo={undo} setUndo={setUndo} />
          <ReviewSettings draft={draft} setDraft={setDraft} plan={plan} decisionKeyInput={decisionKeyInput} setDecisionKeyInput={setDecisionKeyInput} onEditPlan={() => changeTab('analysis')} onServices={() => changeTab('services')} />
          {snapshot.reviewError && <p className={styles.banner}>最近一次 AI 复核未完成：{snapshot.reviewError}</p>}
        </>}
        {tab === 'home' && <SearchHomeSettings draft={draft} setDraft={setDraft} />}
        {tab === 'quickRead' && <QuickReadSettings draft={draft} setDraft={setDraft} onServices={() => changeTab('services')} />}
        {tab === 'services' && <AIServiceSettings draft={draft} setDraft={setDraft} keyInput={keyInput} setKeyInput={setKeyInput} providerKeys={providerKeys} setProviderKeys={setProviderKeys} />}
        {tab === 'data' && <>
          <div className={styles.sectionHeading}><h2>累计统计</h2><button disabled={saving} onClick={() => void refresh().catch(error => setStatus(errorMessage(error)))}>刷新统计</button></div>
          <div className={styles.stats}>{(['highlight', 'blocked', 'watched'] as const).map(kind => <section className={styles.card} key={kind}><span className={styles.notice}>{({ highlight: '累计高亮', blocked: '累计屏蔽', watched: '累计观看' })[kind]}</span><strong>{counts[kind].toLocaleString()}</strong></section>)}</div>
          <section className={styles.card}><h2>备份与迁移</h2><label className={styles.switch}><input type="checkbox" checked={includeKey} onChange={event => setIncludeKey(event.target.checked)} />备份中包含密钥</label>
            {includeKey && <p className={styles.notice}>密钥会以明文写入文件，请妥善保管。</p>}
            <button disabled={waiting || Boolean(saveError || planError)} onClick={() => void exportData()}>导出备份</button>
            <label className={styles.switch}>选择备份文件<input type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; setImported(null); if (!file) return; try { setImported(validateBackup(JSON.parse(await file.text()))); setStatus('备份校验通过，请检查摘要并确认导入。'); } catch (error) { setStatus(errorMessage(error)); } event.target.value = ''; }} /></label>
            {imported && <div className={styles.banner}>包含 {imported.events.length} 条累计记录、{imported.settings.providers.filter(provider => provider.type === 'openai-compatible').length} 个兼容服务；{(['apiKey', 'decisionApiKey'] as const).map(field => <span key={field}>{field === 'apiKey' ? 'DeepSeek：' : '阿里云：'}{Object.hasOwn(imported, field) ? imported[field] ? '替换本机密钥。' : '移除本机密钥。' : '保留本机密钥。'}</span>)}<span>{imported.providerKeys ? '兼容服务密钥按备份替换。' : '兼容服务仅在标识和地址均一致时保留本机密钥。'}</span><div className={styles.row}><button disabled={saving} onClick={() => void importData()}>确认导入</button><button onClick={() => setImported(null)}>取消导入</button></div></div>}
          </section></>}
      </fieldset>
      {tab === 'data' && <><StorageUsage /><DebugLogs /></>}
      {tab === 'analysis' && <>
        <section className={styles.card}><h2>近期计划</h2>
          <textarea aria-label="近期计划" maxLength={preferences.settings.planMaxLength} rows={4} value={plan} disabled={busy || awaitingAnswer} onChange={event => updatePlan(event.target.value)} placeholder="比如：这两周准备考试，想多看数学和英语的学习视频。" />
          <div className={styles.planMeta}><span>{plan.length}/{preferences.settings.planMaxLength} 字</span><span>{analysisService || '尚未配置服务'} · {preferences.settings.ai.model || '尚未填写模型'} · <a href="#analysis-settings">分析设置</a></span></div>
          {planTooLong && <p className={styles.banner}>计划超出字数上限，请缩短计划或在下方“分析设置”中提高上限。</p>}
          <div className={styles.sampleProgress}><span data-ready={counts.watched >= preferences.settings.minWatched}>观看样本 {counts.watched}/{preferences.settings.minWatched}</span><span data-ready={counts.blocked >= preferences.settings.minBlocked}>屏蔽样本 {counts.blocked}/{preferences.settings.minBlocked}</span><button className={styles.textButton} disabled={busy || saving} onClick={() => void refresh().catch(error => setStatus(errorMessage(error)))}>刷新样本</button></div>
          {(!plan.trim() || counts.watched < preferences.settings.minWatched || counts.blocked < preferences.settings.minBlocked) && <p className={styles.notice}>填写计划，且两类样本均达标后即可分析。</p>}
          <div className={styles.row}><button className={styles.primary} disabled={!ready || busy || waiting || Boolean(saveError || planError) || conflict || awaitingAnswer} onClick={() => void runAnalysis()}>开始分析</button>{busy && <button onClick={() => { abort.current?.abort(); setStatus('正在取消分析……'); }}>取消分析</button>}</div>
          <p className={styles.notice}>将计划、样本标题、标签和规则发送给所选服务，可能产生费用。</p>
          {connectionError && <div className={styles.banner}>{connectionError}<button onClick={() => changeTab('services')}>管理服务与密钥</button></div>}
        </section>
        {pendingAnalysis && <><AnalysisInteraction key={`${pendingAnalysis.session.messages.length}:${pendingAnalysis.question.question}`} pending={pendingAnalysis}
          disabled={busy || saving || conflict || pendingAnalysis.session.plan !== plan} busy={busy || saving} onAnswer={followup => void runAnalysis(followup)}
          onEnd={() => { setPendingAnalysis(null); setAnalysisPreview(''); setStatus('已结束本次澄清，上次分析结果保留。'); }} />
          {(conflict || pendingAnalysis.session.plan !== plan) && <p className={styles.banner}>计划或设置已在其他页面改变，请结束本次澄清后重新分析。</p>}</>}
        {busy && <section className={styles.card}><h2>正在生成分析</h2><p className={styles.summary}>{analysisPreview || '正在准备样本或等待模型输出……'}</p><p className={styles.notice}>请保持设置页打开，完成后可选择建议。</p></section>}
        {result && <section className={styles.card}><h2>本次分析</h2><small>{new Date(result.at).toLocaleString()}{result.ai ? ` · ${result.ai.model}` : ''}</small><p className={styles.summary}>{result.summary}</p>{result.plan !== plan && <p className={styles.banner}>计划已改变，旧建议仅供查看，请重新分析。</p>}
          <ClarificationHistory answers={result.clarifications ?? []} />
          <div className={styles.columns}>{(['positive', 'negative'] as const).flatMap(side => (['text', 'tags'] as const).map(field => {
            const items = result.suggestions.map((item, index) => ({ item, index })).filter(({ item }) => item.side === side && item.field === field);
            return items.length ? <div key={`${side}:${field}`} className={styles[side]}><h3>{side === 'positive' ? '偏好内容' : '避开内容'} / {field === 'text' ? '标题词' : '视频标签'}</h3>{items.map(({ item, index }) => <label className={styles.suggestion} key={index}><input type="checkbox" disabled={busy || saving || awaitingAnswer || result.plan !== plan} checked={selected.includes(index)} onChange={event => setSelected(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} /><span><strong><span className={item.action === 'remove' ? styles.removeAction : styles.addAction}>{item.action === 'remove' ? '删除' : '新增'}</span> {item.word}</strong><small>{item.reason}</small></span></label>)}</div> : null;
            }))}</div><div className={styles.row}>
            <label><input type="checkbox" disabled={!result.suggestions.length || busy || saving || awaitingAnswer || conflict || result.plan !== plan} checked={result.suggestions.length > 0 && selected.length === result.suggestions.length} onChange={event => setSelected(event.target.checked ? result.suggestions.map((_, index) => index) : [])} />全选</label>
            <small>已选择 {selected.length} / {result.suggestions.length} 条</small><button disabled={!selected.length || busy || saving || awaitingAnswer || conflict || result.plan !== plan} onClick={() => { try { setDraft(mergeSuggestions(draft, result.suggestions.filter((_, index) => selected.includes(index)))); setSelected([]); setAnalysisCleared(true); setAnalysisPreview(''); setStatus('已采用选中的建议，规则会自动保存。'); } catch (error) { setStatus(errorMessage(error)); } }}>采用所选建议</button></div>
        </section>}
        <fieldset disabled={busy || awaitingAnswer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><AnalysisSettings draft={draft} setDraft={setDraft} onServices={() => changeTab('services')} /></fieldset>
      </>}
    </main>
    <footer className={styles.footer}><small>设置和记录保存在这台设备上</small><span className={styles.status} role="status" aria-live="polite">{status}</span></footer>
  </div>;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
