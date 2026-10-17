// 装配七个设置面板，草稿、分析会话和备份分别由对应功能状态管理。
import { Button } from './primitives/button';
import { Textarea } from './primitives/textarea';
import { Card } from './primitives/card';
import type { AnalysisFollowup } from '../analysis';
import { mergeSuggestions, validateBackup } from '../core';
import { aiConnection } from '../ai-providers';
import { RuleEditor } from './RuleEditor';
import { ThemePicker } from './ThemePicker';
import { Icon } from './Icon';
import { BrandIcon } from './BrandIcon';
import { AIServiceSettings } from './AIServiceSettings';
import { AnalysisSettings } from './AnalysisSettings';
import { QuickReadSettings } from './QuickReadSettings';
import { VideoAssistantSettings } from './VideoAssistantSettings';
import { ReviewSettings } from './ReviewSettings';
import { SearchHomeSettings } from './SearchHomeSettings';
import { DebugLogs } from './DebugLogs';
import { StorageUsage } from './StorageUsage';
import { AnalysisInteraction, AnalysisStreamingPreview, ClarificationHistory } from './AnalysisInteraction';
import styles from './App.module.css';

import { useAnalysisSession } from '../analysis/useAnalysisSession';
import { useSettingsDraft } from '../settings/useSettingsDraft';
import { useBackup } from '../settings/useBackup';
import { tabTitles } from '../settings/navigation';
import { SettingsNavigation } from './SettingsNavigation';
import { Markdown } from './ai/Markdown';
import { errorMessage } from '../settings/errors';
export function App() {
  const analysis = useAnalysisSession();
  const settings = useSettingsDraft(analysis);
  const { busy, pendingAnalysis, setPendingAnalysis, analysisPreview, setAnalysisPreview, analysisCleared, setAnalysisCleared, selected, setSelected, abort } = analysis;
  const { tab, changeTab, snapshot, draft, setDraft, inputs, setInputs, undo, setUndo, keyInput, setKeyInput, providerKeys, setProviderKeys,
    decisionKeyInput, setDecisionKeyInput, plan, updatePlan, status, setStatus, saving, saveError, planError, conflict, dirty, planSaving,
    reload, refresh, failedSave, save, planWrite, load, setSaving } = settings;
  const waitForPlan = () => planWrite.current;
  const { includeKey, setIncludeKey, imported, setImported, exportData, importData } = useBackup({ busy, waitForPlan, load, setStatus, setSaving });
  const runAnalysis = (followup?: AnalysisFollowup) => analysis.runAnalysis({ draft, waitForPlan, refresh, setStatus }, followup);
  if (!snapshot || !draft) return <main className={styles.main}><h1>BiliBuff · 哔哩哔哩</h1><p role="status">{status || '正在读取本机设置……'}</p><Button onClick={() => void reload()}>重新读取</Button></main>;
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
      <SettingsNavigation tab={tab} onChange={changeTab} />
      <div className={styles.sidebarBottom}><ThemePicker /><p>上B站，学东西，有个Buff更顺手。</p></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.pageHeader}><h1>{tabTitles[tab]}</h1><span className={`${styles.saveBadge} ${saveError || planError || conflict ? styles.saveWarning : ''}`} role="status"><Icon name="check" />{saveMessage}</span></header>
      {conflict && <div className={styles.banner}>另一个设置页更新了规则，已暂停本页自动保存。你的修改还在，重新读取后可继续编辑。 <Button disabled={busy || saving} onClick={() => void reload()}>读取最新设置</Button></div>}
      {saveError && !conflict && <div className={styles.banner} role="alert">暂时没能保存：{saveError}<Button disabled={saving} onClick={() => { failedSave.current = ''; void save(); }}>重试</Button></div>}
      {planError && <div className={styles.banner} role="alert">{planError}<Button onClick={() => updatePlan(plan)}>重试</Button></div>}
      {tab !== 'analysis' && (busy || awaitingAnswer) && <div className={styles.activity} role="status">{busy ? '计划分析进行中，设置暂时不可编辑。' : '计划分析等待你的回答，设置暂时不可编辑。'}<Button onClick={() => changeTab('analysis')}>返回分析</Button></div>}
      <fieldset disabled={busy || awaitingAnswer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {tab === 'rules' && <><RuleEditor draft={draft} setDraft={setDraft} inputs={inputs} setInputs={setInputs} undo={undo} setUndo={setUndo} />
          <ReviewSettings draft={draft} setDraft={setDraft} plan={plan} decisionKeyInput={decisionKeyInput} setDecisionKeyInput={setDecisionKeyInput} onEditPlan={() => changeTab('analysis')} onServices={() => changeTab('services')} />
          {snapshot.reviewError && <p className={styles.banner}>最近一次 AI 复核未完成：{snapshot.reviewError}</p>}
        </>}
        {tab === 'home' && <SearchHomeSettings draft={draft} setDraft={setDraft} />}
        {tab === 'quickRead' && <QuickReadSettings draft={draft} setDraft={setDraft} onServices={() => changeTab('services')} />}
        {tab === 'videoAssistant' && <VideoAssistantSettings draft={draft} setDraft={setDraft} onServices={() => changeTab('services')} />}
        {tab === 'services' && <AIServiceSettings draft={draft} setDraft={setDraft} keyInput={keyInput} setKeyInput={setKeyInput} providerKeys={providerKeys} setProviderKeys={setProviderKeys} />}
        {tab === 'data' && <>
          <div className={styles.sectionHeading}><h2>累计统计</h2><Button disabled={saving} onClick={() => void refresh().catch(error => setStatus(errorMessage(error)))}>刷新统计</Button></div>
          <div className={styles.stats}>{(['highlight', 'blocked', 'watched'] as const).map(kind => <Card className={styles.card} key={kind}><span className={styles.notice}>{({ highlight: '累计高亮', blocked: '累计屏蔽', watched: '累计观看' })[kind]}</span><strong>{counts[kind].toLocaleString()}</strong></Card>)}</div>
          <Card className={styles.card}><h2>备份与迁移</h2><label className={styles.switch}><input type="checkbox" checked={includeKey} onChange={event => setIncludeKey(event.target.checked)} />备份中包含密钥</label>
            {includeKey && <p className={styles.notice}>密钥会以明文写入文件，请妥善保管。</p>}
            <Button disabled={waiting || Boolean(saveError || planError)} onClick={() => void exportData()}>导出备份</Button>
            <label className={styles.switch}>选择备份文件<input type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; setImported(null); if (!file) return; try { setImported(validateBackup(JSON.parse(await file.text()))); setStatus('备份校验通过，请检查摘要并确认导入。'); } catch (error) { setStatus(errorMessage(error)); } event.target.value = ''; }} /></label>
            {imported && <div className={styles.banner}>包含 {imported.events.length} 条累计记录、{imported.settings.providers.filter(provider => provider.type === 'openai-compatible').length} 个兼容服务；{(['apiKey', 'decisionApiKey'] as const).map(field => <span key={field}>{field === 'apiKey' ? 'DeepSeek：' : '阿里云：'}{Object.hasOwn(imported, field) ? imported[field] ? '替换本机密钥。' : '移除本机密钥。' : '保留本机密钥。'}</span>)}<span>{imported.providerKeys ? '兼容服务密钥按备份替换。' : '兼容服务仅在标识和地址均一致时保留本机密钥。'}</span><div className={styles.row}><Button disabled={saving} onClick={() => void importData()}>确认导入</Button><Button onClick={() => setImported(null)}>取消导入</Button></div></div>}
          </Card></>}
      </fieldset>
      {tab === 'data' && <><StorageUsage /><DebugLogs /></>}
      {tab === 'analysis' && <>
        <Card className={styles.card}><h2>近期计划</h2>
          <Textarea aria-label="近期计划" maxLength={preferences.settings.planMaxLength} rows={4} value={plan} disabled={busy || awaitingAnswer} onChange={event => updatePlan(event.target.value)} placeholder="比如：这两周准备考试，想多看数学和英语的学习视频。" />
          <div className={styles.planMeta}><span>{plan.length}/{preferences.settings.planMaxLength} 字</span><span>{analysisService || '尚未配置服务'} · {preferences.settings.ai.model || '尚未填写模型'} · <a href="#analysis-settings">分析设置</a></span></div>
          {planTooLong && <p className={styles.banner}>计划超出字数上限，请缩短计划或在下方“分析设置”中提高上限。</p>}
          <div className={styles.sampleProgress}><span data-ready={counts.watched >= preferences.settings.minWatched}>观看样本 {counts.watched}/{preferences.settings.minWatched}</span><span data-ready={counts.blocked >= preferences.settings.minBlocked}>屏蔽样本 {counts.blocked}/{preferences.settings.minBlocked}</span><Button className={styles.textButton} disabled={busy || saving} onClick={() => void refresh().catch(error => setStatus(errorMessage(error)))}>刷新样本</Button></div>
          {(!plan.trim() || counts.watched < preferences.settings.minWatched || counts.blocked < preferences.settings.minBlocked) && <p className={styles.notice}>填写计划，且两类样本均达标后即可分析。</p>}
          <div className={styles.row}><Button className={styles.primary} disabled={!busy && (!ready || waiting || Boolean(saveError || planError) || conflict || awaitingAnswer)} onClick={() => { if (busy) { abort.current?.abort(); setStatus('正在取消分析……'); } else void runAnalysis(); }}>{busy ? '取消分析' : '开始分析'}</Button></div>
          <p className={styles.notice}>将计划、样本标题、标签和规则发送给所选服务，可能产生费用。</p>
          {connectionError && <div className={styles.banner}>{connectionError}<Button onClick={() => changeTab('services')}>管理服务与密钥</Button></div>}
        </Card>
        {pendingAnalysis && <><AnalysisInteraction key={`${pendingAnalysis.session.messages.length}:${pendingAnalysis.question.question}`} pending={pendingAnalysis}
          disabled={busy || saving || conflict || pendingAnalysis.session.plan !== plan} busy={busy || saving} onAnswer={followup => void runAnalysis(followup)}
          onEnd={() => { setPendingAnalysis(null); setAnalysisPreview(''); setStatus('已结束本次澄清，上次分析结果保留。'); }} />
          {(conflict || pendingAnalysis.session.plan !== plan) && <p className={styles.banner}>计划或设置已在其他页面改变，请结束本次澄清后重新分析。</p>}</>}
        {busy && <AnalysisStreamingPreview value={analysis.structuredPreview} summary={analysisPreview} />}
        {result && <Card className={`${styles.card} bb-result-reveal`}><h2>本次分析</h2><small>{new Date(result.at).toLocaleString()}{result.ai ? ` · ${result.ai.model}` : ''}</small><Markdown text={result.summary} />{result.plan !== plan && <p className={styles.banner}>计划已改变，旧建议仅供查看，请重新分析。</p>}
          <ClarificationHistory answers={result.clarifications ?? []} />
          <div className={styles.columns}>{(['positive', 'negative'] as const).flatMap(side => (['text', 'tags'] as const).map(field => {
            const items = result.suggestions.map((item, index) => ({ item, index })).filter(({ item }) => item.side === side && item.field === field);
            return items.length ? <div key={`${side}:${field}`} className={styles[side]}><h3>{side === 'positive' ? '偏好内容' : '避开内容'} / {field === 'text' ? '标题词' : '视频标签'}</h3>{items.map(({ item, index }) => <label className={styles.suggestion} key={index}><input type="checkbox" disabled={busy || saving || awaitingAnswer || result.plan !== plan} checked={selected.includes(index)} onChange={event => setSelected(previous => event.target.checked ? [...previous, index] : previous.filter(value => value !== index))} /><span><strong><span className={item.action === 'remove' ? styles.removeAction : styles.addAction}>{item.action === 'remove' ? '删除' : '新增'}</span> {item.word}</strong><small>{item.reason}</small></span></label>)}</div> : null;
            }))}</div><div className={styles.row}>
            <label><input type="checkbox" disabled={!result.suggestions.length || busy || saving || awaitingAnswer || conflict || result.plan !== plan} checked={result.suggestions.length > 0 && selected.length === result.suggestions.length} onChange={event => setSelected(event.target.checked ? result.suggestions.map((_, index) => index) : [])} />全选</label>
            <small>已选择 {selected.length} / {result.suggestions.length} 条</small><Button disabled={!selected.length || busy || saving || awaitingAnswer || conflict || result.plan !== plan} onClick={() => { try { setDraft(mergeSuggestions(draft, result.suggestions.filter((_, index) => selected.includes(index)))); setSelected([]); setAnalysisCleared(true); setAnalysisPreview(''); setStatus('已采用选中的建议，规则会自动保存。'); } catch (error) { setStatus(errorMessage(error)); } }}>采用所选建议</Button></div>
        </Card>}
        <fieldset disabled={busy || awaitingAnswer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><AnalysisSettings draft={draft} setDraft={setDraft} onServices={() => changeTab('services')} /></fieldset>
      </>}
    </main>
    <footer className={styles.footer}><small>设置和记录保存在这台设备上</small><span className={styles.status} role="status" aria-live="polite">{status}</span></footer>
  </div>;
}
