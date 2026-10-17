// 规范化词条与分隔输入，供设置和推荐判断共用。
export function normalize(text: string) { return text.normalize('NFKC').toLowerCase().trim(); }
export function parseWords(text: string) { return [...new Set(text.split(/[\n,，;；]+/).map(normalize).filter(Boolean))]; }
