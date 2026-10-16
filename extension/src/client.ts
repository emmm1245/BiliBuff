// 为扩展页面和内容脚本提供统一的消息请求与错误反馈。
import { browser } from 'wxt/browser';
import type { Message } from './types';

export async function send<T>(message: Message): Promise<T> {
  const response = await browser.runtime.sendMessage(message) as { ok: boolean; value?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error || '扩展后台不可用，请刷新页面重试。');
  return response.value as T;
}
