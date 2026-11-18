const CNPJ_PATTERN = /(?<![A-Z0-9])(?:[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}[/\s]?[A-Z0-9]{4}[-\s]?[0-9]{2})(?![A-Z0-9])/gi;
function digit(ch: string) { return /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 48; }
export function normalizeCnpj(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
export function isValidCnpj(value: string) {
  const c = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(c) || /^(.)\1+$/.test(c)) return false;
  const nums = [...c].map(digit);
  const calc = (length: number) => { let weight = length - 7, sum = 0; for (let i = 0; i < length; i++) { sum += nums[i] * weight; weight = weight === 2 ? 9 : weight - 1; } const rest = sum % 11; return rest < 2 ? 0 : 11 - rest; };
  return nums[12] === calc(12) && nums[13] === calc(13);
}
export function extractCnpjs(html: string) {
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ');
  return [...new Set((text.match(CNPJ_PATTERN) || []).map(normalizeCnpj).filter(isValidCnpj))].slice(0, 4);
}
