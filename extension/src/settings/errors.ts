// 为设置交互统一生成简短错误说明。
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
