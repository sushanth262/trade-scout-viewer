import { EMA, RSI, MACD } from "technicalindicators";
import type { AlertRule } from "@/lib/cosmos";
import type { Bar } from "@/lib/market-bars";
import { barChartTime } from "@/lib/market-bars";

export type ChartTrigger = {
  time: string | number;
  price: number;
  rule: string;
  direction: "bullish" | "bearish";
};

export type LinePoint = { time: string | number; value: number };

export type EmaOverlay = { period: number; label: string; color: string; points: LinePoint[] };

export type MacdOverlay = {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: { time: string | number; value: number; color?: string }[];
};

const EMA_COLORS = ["#d9f854", "#2962ff", "#f59e0b", "#a855f7", "#22d3ee", "#f472b6"];

/** Cosmos may store params as object or JSON string (legacy form saves). */
export function normalizeRuleParams(params: unknown): Record<string, unknown> {
  if (params == null) return {};
  if (typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  if (typeof params === "string") {
    try {
      const parsed = JSON.parse(params) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeAlertRule(rule: AlertRule): AlertRule {
  return { ...rule, params: normalizeRuleParams(rule.params) };
}

/** Rules that apply to the chart/backtest bar series (enabled + matching timeframe). */
export function filterRulesForChart(rules: AlertRule[], chartTimeframe: string): AlertRule[] {
  return rules
    .map(normalizeAlertRule)
    .filter((r) => r.enabled !== false && r.timeframe === chartTimeframe);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function pad<T>(arr: T[], target: number, fill: T): T[] {
  const off = target - arr.length;
  if (off <= 0) return arr;
  return [...Array(off).fill(fill), ...arr] as T[];
}

function emaSeries(closes: number[], period: number): (number | undefined)[] {
  if (period < 1 || closes.length < period) {
    return pad([], closes.length, undefined);
  }
  return pad(EMA.calculate({ period, values: closes }) as (number | undefined)[], closes.length, undefined);
}

export function collectEmaPeriods(rules: AlertRule[]): number[] {
  const set = new Set<number>();
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const p = normalizeRuleParams(rule.params);
    if (rule.rule_type === "ema_crossover") {
      const f = num(p.fast);
      const s = num(p.slow);
      if (f >= 2) set.add(Math.round(f));
      if (s >= 2) set.add(Math.round(s));
    }
    if (rule.rule_type === "ema_price") {
      const period = num(p.period);
      if (period >= 2) set.add(Math.round(period));
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function ruleHit(
  i: number,
  closes: number[],
  emaByPeriod: Map<number, (number | undefined)[]>,
  rsi: (number | undefined)[],
  macd: { MACD?: number; signal?: number; histogram?: number }[],
  rule: AlertRule,
): "bullish" | "bearish" | null {
  const p = normalizeRuleParams(rule.params);
  if (rule.rule_type === "ema_crossover") {
    const fast = Math.round(num(p.fast) || 20);
    const slow = Math.round(num(p.slow) || 50);
    const emaF = emaByPeriod.get(fast);
    const emaS = emaByPeriod.get(slow);
    if (!emaF || !emaS) return null;
    const dir = String(p.direction ?? "above");
    const ef = emaF[i];
    const es = emaS[i];
    const pef = i > 0 ? emaF[i - 1] : undefined;
    const pes = i > 0 ? emaS[i - 1] : undefined;
    if (ef == null || es == null || pef == null || pes == null) return null;
    if (dir === "above" || dir === "bullish_cross") {
      if (pef <= pes && ef > es) return "bullish";
      if (pef >= pes && ef < es) return "bearish";
    } else if (dir === "below" || dir === "bearish_cross") {
      if (pef >= pes && ef < es) return "bearish";
      if (pef <= pes && ef > es) return "bullish";
    }
    return null;
  }
  if (rule.rule_type === "ema_price") {
    const period = Math.round(num(p.period) || 200);
    const ema = emaByPeriod.get(period);
    if (!ema || i < 1) return null;
    const e = ema[i];
    const pe = ema[i - 1];
    const c = closes[i];
    const pc = closes[i - 1];
    if (e == null || pe == null) return null;
    const direction = String(p.direction ?? "above");
    if (direction === "above" && pc <= pe && c > e) return "bullish";
    if (direction === "below" && pc >= pe && c < e) return "bearish";
    return null;
  }
  if (rule.rule_type === "rsi_threshold") {
    const thr = num(p.threshold) ?? 30;
    const direction = String(p.direction ?? "below");
    const rv = rsi[i];
    if (rv == null || i < 1) return null;
    const prev = rsi[i - 1];
    if (prev == null) return null;
    if (direction === "below" && prev > thr && rv <= thr) return "bullish";
    if (direction === "above" && prev < thr && rv >= thr) return "bearish";
    return null;
  }
  if (rule.rule_type === "macd_cross") {
    const direction = String(p.direction ?? "bullish");
    const cur = macd[i];
    const prev = i > 0 ? macd[i - 1] : undefined;
    if (!cur || !prev) return null;
    const ch = cur.histogram ?? (cur.MACD ?? 0) - (cur.signal ?? 0);
    const ph = prev.histogram ?? (prev.MACD ?? 0) - (prev.signal ?? 0);
    if (direction === "bullish" && ph <= 0 && ch > 0) return "bullish";
    if (direction === "bearish" && ph >= 0 && ch < 0) return "bearish";
    return null;
  }
  if (rule.rule_type === "price_level") {
    const level = num(p.level);
    const direction = String(p.direction ?? "above");
    if (!Number.isFinite(level)) return null;
    const c = closes[i];
    const pc = closes[i - 1];
    if (i < 1) return null;
    if (direction === "above" && pc <= level && c > level) return "bullish";
    if (direction === "below" && pc >= level && c < level) return "bearish";
    return null;
  }
  return null;
}

export type EmaPeriods = { fast: number; slow: number };

export function emaPeriodsFromRules(rules: AlertRule[]): EmaPeriods {
  const emaRule = rules.find((r) => r.rule_type === "ema_crossover" && r.enabled !== false);
  const p = emaRule ? normalizeRuleParams(emaRule.params) : {};
  return {
    fast: emaRule ? num(p.fast) || 20 : 20,
    slow: emaRule ? num(p.slow) || 50 : 50,
  };
}

export function computeChartSeries(
  bars: Bar[],
  rules: AlertRule[],
  timeframe: string,
): {
  emaFast: LinePoint[];
  emaSlow: LinePoint[];
  emaOverlays: EmaOverlay[];
  rsi: { period: number; points: LinePoint[] } | null;
  macd: MacdOverlay | null;
  priceLevels: { price: number; title: string }[];
  triggers: ChartTrigger[];
} {
  const active = filterRulesForChart(rules, timeframe);
  const closes = bars.map((b) => b.close);
  const n = closes.length;

  const emaPeriods = collectEmaPeriods(active);
  const emaByPeriod = new Map<number, (number | undefined)[]>();
  for (const period of emaPeriods) {
    emaByPeriod.set(period, emaSeries(closes, period));
  }

  const rsiRule = active.find((r) => r.rule_type === "rsi_threshold");
  const rsiParams = rsiRule ? normalizeRuleParams(rsiRule.params) : {};
  const rsiP = rsiRule ? Math.round(num(rsiParams.period) || 14) : 14;
  const rsiCalc = active.some((r) => r.rule_type === "rsi_threshold")
    ? pad(RSI.calculate({ period: rsiP, values: closes }) as (number | undefined)[], n, undefined)
    : [];

  const macdRule = active.find((r) => r.rule_type === "macd_cross");
  const macdParams = macdRule ? normalizeRuleParams(macdRule.params) : {};
  const macdFast = macdRule ? Math.round(num(macdParams.fast) || 12) : 12;
  const macdSlow = macdRule ? Math.round(num(macdParams.slow) || 26) : 26;
  const macdSig = macdRule ? Math.round(num(macdParams.signal) || 9) : 9;
  const macdCalc = active.some((r) => r.rule_type === "macd_cross")
    ? pad(
        MACD.calculate({
          fastPeriod: macdFast,
          slowPeriod: macdSlow,
          signalPeriod: macdSig,
          values: closes,
          SimpleMAOscillator: false,
          SimpleMASignal: false,
        }) as { MACD?: number; signal?: number; histogram?: number }[],
        n,
        {},
      )
    : [];

  const { fast, slow } = emaPeriodsFromRules(active);
  const emaFp = emaByPeriod.get(Math.round(fast)) ?? emaSeries(closes, fast);
  const emaSp = emaByPeriod.get(Math.round(slow)) ?? emaSeries(closes, slow);

  const emaFast: LinePoint[] = [];
  const emaSlow: LinePoint[] = [];
  const emaOverlays: EmaOverlay[] = [];

  emaPeriods.forEach((period, idx) => {
    const arr = emaByPeriod.get(period);
    if (!arr) return;
    const points: LinePoint[] = [];
    for (let i = 0; i < n; i++) {
      if (arr[i] != null) {
        points.push({ time: barChartTime(bars[i].date, timeframe), value: arr[i] as number });
      }
    }
    if (!points.length) return;
    emaOverlays.push({
      period,
      label: `EMA ${period}`,
      color: EMA_COLORS[idx % EMA_COLORS.length],
      points,
    });
  });

  for (let i = 0; i < n; i++) {
    const t = barChartTime(bars[i].date, timeframe);
    if (emaFp[i] != null) emaFast.push({ time: t, value: emaFp[i] as number });
    if (emaSp[i] != null) emaSlow.push({ time: t, value: emaSp[i] as number });
  }

  let rsi: { period: number; points: LinePoint[] } | null = null;
  if (active.some((r) => r.rule_type === "rsi_threshold")) {
    const points: LinePoint[] = [];
    for (let i = 0; i < n; i++) {
      if (rsiCalc[i] != null) {
        points.push({ time: barChartTime(bars[i].date, timeframe), value: rsiCalc[i] as number });
      }
    }
    if (points.length) rsi = { period: rsiP, points };
  }

  let macd: MacdOverlay | null = null;
  if (active.some((r) => r.rule_type === "macd_cross")) {
    const macdLine: LinePoint[] = [];
    const signalLine: LinePoint[] = [];
    const histogram: { time: string | number; value: number; color?: string }[] = [];
    for (let i = 0; i < n; i++) {
      const t = barChartTime(bars[i].date, timeframe);
      const row = macdCalc[i];
      if (!row) continue;
      const m = row.MACD;
      const s = row.signal;
      const h = row.histogram ?? (m != null && s != null ? m - s : undefined);
      if (m != null) macdLine.push({ time: t, value: m });
      if (s != null) signalLine.push({ time: t, value: s });
      if (h != null) {
        histogram.push({
          time: t,
          value: h,
          color: h >= 0 ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
        });
      }
    }
    if (macdLine.length || histogram.length) {
      macd = { macd: macdLine, signal: signalLine, histogram };
    }
  }

  const priceLevels: { price: number; title: string }[] = [];
  for (const rule of active) {
    if (rule.rule_type !== "price_level") continue;
    const level = num(normalizeRuleParams(rule.params).level);
    if (Number.isFinite(level)) {
      priceLevels.push({ price: level, title: rule.name || "Level" });
    }
  }

  const maxPeriod = Math.max(
    slow,
    ...emaPeriods,
    rsiP,
    macdSlow + macdSig,
    30,
  );
  const triggers: ChartTrigger[] = [];
  for (let i = Math.max(maxPeriod, 30); i < n; i++) {
    for (const rule of active) {
      const hit = ruleHit(i, closes, emaByPeriod, rsiCalc, macdCalc, rule);
      if (hit) {
        triggers.push({
          time: barChartTime(bars[i].date, timeframe),
          price: bars[i].close,
          rule: rule.name,
          direction: hit,
        });
      }
    }
  }

  return { emaFast, emaSlow, emaOverlays, rsi, macd, priceLevels, triggers };
}
