// 管理设置草稿、保存基线、计划写入、外部同步与离开提醒。
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { send } from '../client';
import { validateSettings } from '../core';
import type { Settings, Side, Snapshot, WordField } from '../types';
import type { useAnalysisSession } from '../analysis/useAnalysisSession';
import { emptyInputs } from './word-inputs';
import { type Tab } from './navigation';
import { createSaveGate } from './save-gate';
import { errorMessage } from './errors';
export function useSettingsDraft(analysis: ReturnType<typeof useAnalysisSession>) {
  const { busy, busyRef, pendingRef, pendingAnalysis, abort } = analysis;
  const [tab, setTab] = useState<Tab>(() => location.hash === '#videoAssistant' ? 'videoAssistant' : 'rules');
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState('');
  const planWrite = useRef<Promise<unknown>>(Promise.resolve());
  const planPending = useRef(0);
  const planDirtyRef = useRef(false);
  const savingRef = useRef(false);
  const revisionRef = useRef(revision); revisionRef.current = revision;
  const saveGate = useRef(createSaveGate()).current;
  const failedSave = saveGate.failure;
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


  useEffect(() => { analysis.setSelected([]); }, [snapshot?.preferences.result?.at]);
  function load(value: Snapshot) {
    planDirtyRef.current = false;
    analysis.reset();
    setSnapshot(value); setDraft(structuredClone(value.preferences.settings));
    setBaseline(structuredClone(value.preferences.settings)); setRevision(value.preferences.revision); revisionRef.current = value.preferences.revision;
    setPlan(value.preferences.plan); setInputs({ ...emptyInputs }); setUndo(null); setKeyInput(value.preferences.apiKey);
    setDecisionKeyInput(value.preferences.decisionApiKey ?? '');
    setProviderKeys(value.preferences.providerKeys ?? {}); setSavedProviderKeys(value.preferences.providerKeys ?? {});
    setSavedKeys({ apiKey: value.preferences.apiKey, decisionApiKey: value.preferences.decisionApiKey ?? '' });
    setSaveError(''); setPlanError(''); failedSave.current = '';
  }
  async function refresh() {
    const planAtRead = planWrite.current;
    const value = await send({ type: 'snapshot' });
    if (value.preferences.revision >= revisionRef.current) setSnapshot(value);
    if (!planDirtyRef.current && planAtRead === planWrite.current) setPlan(value.preferences.plan);
    return value;
  }
  useEffect(() => {
    let alive = true;
    void send({ type: 'snapshot' }).then(value => { if (alive) load(value); }).catch(error => { if (alive) setStatus(error.message); });
    const changed = () => {
      const planAtRead = planWrite.current;
      void send({ type: 'snapshot' }).then(value => {
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
    try { await planWrite.current.catch(() => {}); load(await send({ type: 'snapshot' })); setStatus('已读取最新设置。'); } catch (error) { setStatus(errorMessage(error)); }
  }
  async function save() {
    if (!draft || savingRef.current) return;
    const signature = JSON.stringify([draft, keyInput, providerKeys, decisionKeyInput, revision]);
    try {
      await saveGate.run(signature, async () => {
        const settings = validateSettings(draft);
        savingRef.current = true; setSaving(true); setSaveError('');
        await planWrite.current;
        const saved = await send({ type: 'save', settings, revision, ...(keyInput.trim() !== savedKeys.apiKey ? { apiKey: keyInput.trim() } : {}),
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
      });
    } catch (error) { setSaveError(errorMessage(error)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return { tab, changeTab, snapshot, draft, setDraft, inputs, setInputs, undo, setUndo, keyInput, setKeyInput, providerKeys, setProviderKeys,
    decisionKeyInput, setDecisionKeyInput, plan, updatePlan, status, setStatus, saving, setSaving, saveError, planError, conflict, dirty, planSaving,
    reload, refresh, failedSave, save, planWrite, load };
}
