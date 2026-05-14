/** Normalize for display / Cosmos id (uppercase, trim). */
export function normalizeTicker(t: string): string {
  return t.trim().toUpperCase();
}

/**
 * US-listed equity style symbol (Alpaca tradable subset).
 * 1–5 letters, optional single class suffix like BRK.B / BF.A.
 */
export function isValidEquityTicker(raw: string): boolean {
  const s = normalizeTicker(raw);
  if (s.length < 1 || s.length > 8) return false;
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(s);
}

/** Split user paste / Alpaca import lines into candidate tokens. */
export function splitTickerCandidates(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((x) => normalizeTicker(x))
    .filter(Boolean);
}
