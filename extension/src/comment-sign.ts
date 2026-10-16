// 按当前 B 站公开请求层的规则生成评论读取所需的 WBI 签名。
const mixin = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function md5(text: string) {
  const bytes = new TextEncoder().encode(text), length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length); buffer.set(bytes); buffer[bytes.length] = 128;
  const view = new DataView(buffer.buffer); view.setUint32(length - 8, bytes.length * 8, true);
  const state: [number,number,number,number] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const shifts = [[7,12,17,22], [5,9,14,20], [4,11,16,23], [6,10,15,21]];
  for (let offset = 0; offset < length; offset += 64) {
    let [a,b,c,d] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = round === 0 ? i : round === 1 ? (5*i+1)%16 : round === 2 ? (3*i+5)%16 : (7*i)%16;
      const sum = (a + f + Math.floor(Math.abs(Math.sin(i+1)) * 2**32) + view.getUint32(offset + word*4, true)) | 0;
      const shift = shifts[round]![i%4]!, rotated = (sum << shift) | (sum >>> (32-shift));
      [a,b,c,d] = [d,(b+rotated)|0,b,c];
    }
    [a,b,c,d].forEach((value, i) => { state[i] = (state[i]! + value) | 0; });
  }
  return state.map(value => Array.from({ length: 4 }, (_, i) => ((value >>> (i*8)) & 255).toString(16).padStart(2,'0')).join('')).join('');
}
export function signedCommentQuery(params: Record<string, string>, imgKey: string, subKey: string, timestamp = Math.round(Date.now()/1000)) {
  const key = mixin.map(index => (imgKey + subKey)[index]).join('').slice(0,32);
  const values = { ...params, wts: String(timestamp) };
  const query = Object.entries(values).sort(([a],[b]) => a.localeCompare(b)).map(([name,value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value.replace(/[!'()*]/g,''))}`).join('&');
  return `${query}&w_rid=${md5(query+key)}`;
}
