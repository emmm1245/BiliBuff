// 为扩展页面和内容脚本提供统一的消息请求与错误反馈。
import { browser } from 'wxt/browser';
import type { Message } from './types';
import type { MessageResult } from './platform/messages';

export async function send<M extends Message>(message: M): Promise<MessageResult<M>> {
  const response = await browser.runtime.sendMessage(message) as { ok: boolean; value?: MessageResult<M>; error?: string };
  if (!response?.ok) throw new Error(response?.error || '扩展后台不可用，请刷新页面重试。');
  return response.value as MessageResult<M>;
}
