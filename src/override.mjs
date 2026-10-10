// Explicit trailing commands only. Quoted examples and fenced code are task data.
const groups = {
  astra: ['astra', '아스트라', 'アストラ', '阿斯特拉'], sol: ['sol', '솔', 'ソル', '索尔', '索爾'],
  luna: ['luna', '루나', '루니', 'ルナ', '露娜'], opus: ['opus', '오퍼스', 'オーパス'],
  sonnet: ['sonnet', '소넷', 'ソネット'], haiku: ['haiku', '하이쿠', 'ハイク'],
};
const levels = {
  low: ['low', '로우', 'ロー', '低'], medium: ['medium', '미디엄', '미디움', 'ミディアム', '中'],
  high: ['high', '하이', 'ハイ', '高'], xhigh: ['xhigh', '엑스하이', 'エクストラハイ', '极高', '極高'],
  max: ['max', '맥스', 'マックス', '最高'],
};
const alternatives = object => Object.values(object).flat().sort((a, b) => b.length - a.length).join('|');
const model = `(${alternatives(groups)})`, effort = `(?:\\s*(${alternatives(levels)}))?`;
const patterns = [
  new RegExp(`(?:^|[\\s.!?。])${model}${effort}\\s*(?:으로|로)?\\s*(?:해\\s*줘|해\\s*주세요|해주세요|해)[.!。\\s]*$`, 'iu'),
  new RegExp(`(?:^|[\\s.!?。])(?:please\\s+)?use\\s+${model}${effort}(?:\\s+please)?[.!。\\s]*$`, 'iu'),
  new RegExp(`(?:^|[\\s。.!?])${model}${effort}\\s*で(?:お願いします|お願い|実行して|実行してください)[。.!\\s]*$`, 'iu'),
  new RegExp(`(?:^|[\\s。.!?，,])(?:请|請)?(?:使用|用)\\s*${model}${effort}(?:\\s*(?:模型|模式))?[。.!\\s]*$`, 'iu'),
];
const canonical = (object, value) => Object.entries(object).find(([, names]) => names.some(n => n.toLowerCase() === value.toLowerCase()))?.[0];
export function trailingOverride(text) {
  if (typeof text !== 'string') return null;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const prefix = text.slice(0, match.index);
    if ((prefix.match(/```/g)?.length ?? 0) % 2 || (prefix.match(/~~~/g)?.length ?? 0) % 2) return null;
    return { model: canonical(groups, match[1]), effort: match[2] ? canonical(levels, match[2]) : null };
  }
  return null;
}
