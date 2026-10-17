// 采用shadcn/ui按钮的原生节点与样式约定，保留项目实际使用的原生按钮能力。
import type { ComponentProps } from 'react';
import { cn } from './utils';
export function Button({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return <button data-slot="button" type={type} className={cn('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)} {...props} />;
}
