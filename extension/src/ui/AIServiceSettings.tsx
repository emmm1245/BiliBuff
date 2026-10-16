// 管理内置及兼容 AI 服务、独立密钥、站点授权，并复用服务与模型选择控件。
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { browser } from 'wxt/browser';
import { DEEPSEEK_MODELS, providerOrigin } from '../ai-providers';
import type { AIProvider, Settings } from '../types';
import { Icon } from './Icon';
import styles from './App.module.css';

interface Props {
  draft: Settings;
  setDraft: Dispatch<SetStateAction<Settings | null>>;
  keyInput: string;
  setKeyInput: (value: string) => void;
  providerKeys: Record<string, string>;
  setProviderKeys: (value: Record<string, string>) => void;
}

export function AIServiceSettings({ draft, setDraft, keyInput, setKeyInput, providerKeys, setProviderKeys }: Props) {
  const update = (id: string, change: Partial<AIProvider>) => setDraft({ ...draft, providers: draft.providers.map(provider => provider.id === id ? { ...provider, ...change } : provider) });
  function remove(id: string) {
    setDraft({ ...draft, providers: draft.providers.filter(provider => provider.id !== id),
      review: draft.review.providerId === id ? { ...draft.review, providerId: 'deepseek', model: 'deepseek-flash' } : draft.review });
    setProviderKeys(Object.fromEntries(Object.entries(providerKeys).filter(([key]) => key !== id)));
  }
  return <section className={styles.card}>
    <h2>已配置服务</h2>
    <div className={styles.providerList}>{draft.providers.map(provider => {
      const used = (draft.ai.providerId ?? 'deepseek') === provider.id || draft.quickRead.providerId === provider.id || (draft.review.mode === 'general' && (draft.review.providerId ?? 'deepseek') === provider.id);
      return <ProviderCard key={provider.id} provider={provider} used={used} onChange={change => update(provider.id, change)}
        apiKey={provider.id === 'deepseek' ? keyInput : providerKeys[provider.id] ?? ''}
        onKeyChange={value => provider.id === 'deepseek' ? setKeyInput(value) : setProviderKeys({ ...providerKeys, [provider.id]: value })}
        onRemove={() => remove(provider.id)} />;
    })}</div>
    <div className={styles.row}><button onClick={() => setDraft({ ...draft, providers: [...draft.providers, { id: `custom-${crypto.randomUUID()}`, name: '自定义服务', type: 'openai-compatible', baseUrl: '' }] })}>添加 OpenAI 兼容服务</button></div>
    <p className={styles.notice}>密钥仅保存在本机，未加密；清空即可删除。各功能的模型在对应面板选择。</p>
  </section>;
}

function ProviderCard({ provider, used, apiKey, onChange, onKeyChange, onRemove }: {
  provider: AIProvider; used: boolean; apiKey: string; onChange: (change: Partial<AIProvider>) => void; onKeyChange: (value: string) => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(provider.type === 'deepseek' || !provider.baseUrl);
  const official = provider.type === 'deepseek';
  return <details className={styles.provider} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>{provider.name || '自定义服务'}</span><small>{official ? '内置' : 'OpenAI 兼容'}{used ? ' · 已选用' : ''}</small></summary>
    <div className={styles.providerBody}>
      {!official && <div className={styles.formGrid}>
        <label>服务名称<input value={provider.name} onChange={event => onChange({ name: event.target.value })} placeholder="例如：我的模型服务" /></label>
        <label>基础地址<input type="url" value={provider.baseUrl} onChange={event => onChange({ baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
      </div>}
      <KeyInput label={official ? 'DeepSeek 密钥' : `${provider.name}密钥`} value={apiKey} onChange={onKeyChange} placeholder={official ? '填写官方密钥' : '填写此服务的密钥；本地免密服务可留空'} />
      {official ? <small>{provider.baseUrl}</small> : <div className={styles.row}>
        <ProviderAccess baseUrl={provider.baseUrl} />
        <button disabled={used} title={used ? '请先让使用它的功能切换到其他服务' : undefined} onClick={onRemove}>删除服务</button>
        {used && <span className={styles.notice}>请先在使用此服务的功能中切换服务，再删除。</span>}
      </div>}
    </div>
  </details>;
}

function ProviderAccess({ baseUrl }: { baseUrl: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    setMessage('');
    try {
      const origins = [providerOrigin(baseUrl)];
      void browser.permissions.contains({ origins }).then(allowed => { if (alive) setMessage(allowed ? '已授权访问此站点' : '使用前请授权访问此站点'); }, () => { if (alive) setMessage('暂时无法读取站点授权'); });
    } catch { /* 地址尚未填写完整时，等用户继续输入。 */ }
    return () => { alive = false; };
  }, [baseUrl]);
  function grant() {
    try {
      // 必须在点击处理函数中直接申请，保留浏览器要求的用户手势。
      void browser.permissions.request({ origins: [providerOrigin(baseUrl)] }).then(allowed => setMessage(allowed ? '已授权访问此站点' : '未获得授权，服务配置已保留'), () => setMessage('授权失败，请重试'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '请先填写基础地址'); }
  }
  return <><button disabled={!baseUrl.trim()} onClick={grant}>授权访问此站点</button>{message && <small role="status">{message}</small>}</>;
}

export function ModelSelection({ providers, providerId = 'deepseek', model, onChange }: {
  providers: AIProvider[]; providerId?: string; model: string; onChange: (value: { providerId: string; model: string }) => void;
}) {
  return <>
    <label>AI 服务<select value={providerId} onChange={event => onChange({ providerId: event.target.value, model: event.target.value === 'deepseek' ? 'deepseek-flash' : '' })}>
      {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </select></label>
    <label>模型{providerId === 'deepseek' ? <select value={model} onChange={event => onChange({ providerId, model: event.target.value })}>
      {DEEPSEEK_MODELS.map(value => <option key={value} value={value}>{value}</option>)}
    </select> : <input value={model} onChange={event => onChange({ providerId, model: event.target.value.trim() })} placeholder="填写服务商提供的模型名称" />}</label>
  </>;
}

export function KeyInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.switch}>
    <label>{label}<span className={styles.keyField}>
      <input type={visible ? 'text' : 'password'} autoComplete="off" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </span></label>
    <button type="button" className={styles.keyToggle} aria-label={`${visible ? '隐藏' : '查看'}${label}`} aria-pressed={visible} title={visible ? '隐藏密钥' : '查看密钥'} onClick={() => setVisible(current => !current)}><Icon name={visible ? 'eyeOff' : 'eye'} /></button>
  </div>;
}
