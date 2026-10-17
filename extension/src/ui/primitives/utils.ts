// 连接组件的固定样式与调用者样式，样式覆盖由层级及业务样式表处理。
export function cn(...values: (string | undefined | false)[]) { return values.filter(Boolean).join(' '); }
