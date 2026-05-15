"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type SeriesMarker,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import type { AlertRule } from "@/lib/cosmos";
import type { BarSourcePreference } from "@/lib/market-bars";
import type { EmaOverlay, MacdOverlay } from "@/lib/alert-rule-eval";
import styles from "./LightweightStockChart.module.css";

export type ChartDataPayload = {
  ticker: string;
  timeframe: string;
  source: string;
  sourceNote?: string;
  emaPeriods: { fast: number; slow: number };
  candles: CandlestickData<Time>[];
  emaFast: { time: string | number; value: number }[];
  emaSlow: { time: string | number; value: number }[];
  emaOverlays?: EmaOverlay[];
  rsi?: { period: number; points: { time: string | number; value: number }[] } | null;
  macd?: MacdOverlay | null;
  priceLevels: { price: number; title: string }[];
  triggers: {
    time: string | number;
    price: number;
    rule: string;
    direction: "bullish" | "bearish";
  }[];
  firedMarkers: {
    time: string | number;
    price: number;
    rule: string;
    direction: "bullish" | "bearish";
    status: string;
    source: "fired";
  }[];
  appliedRules?: { name: string; rule_type: string; timeframe: string }[];
  skippedRules?: { name: string; timeframe: string; reason: string }[];
  rulesTotal?: number;
  rulesApplied?: number;
};

type Props = {
  ticker: string;
  basePath: string;
  timeframe: string;
  lookbackDays: number;
  barSource?: BarSourcePreference;
  refreshKey?: number;
  /** When set, POST to chart-data with same rules as backtest (not only Cosmos on GET). */
  rules?: AlertRule[];
};

function buildMarkers(data: ChartDataPayload): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  for (const t of data.triggers) {
    markers.push({
      time: t.time as Time,
      position: t.direction === "bullish" ? "belowBar" : "aboveBar",
      color: t.direction === "bullish" ? "#26a69a" : "#ef5350",
      shape: t.direction === "bullish" ? "arrowUp" : "arrowDown",
      text: t.rule.slice(0, 12),
    });
  }

  for (const f of data.firedMarkers) {
    markers.push({
      time: f.time as Time,
      position: f.direction === "bullish" ? "belowBar" : "aboveBar",
      color: "#f59e0b",
      shape: "circle",
      text: `${f.rule.slice(0, 8)} · ${f.status}`,
    });
  }

  return markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export function LightweightStockChart({
  ticker,
  basePath,
  timeframe,
  lookbackDays,
  barSource = "auto",
  refreshKey = 0,
  rules,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [data, setData] = useState<ChartDataPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const payload = {
      ticker,
      timeframe,
      days: lookbackDays,
      source: barSource,
      rules: rules ?? [],
    };
    const usePost = Array.isArray(rules) && rules.length > 0;
    const req = usePost
      ? fetch(`${basePath}/api/chart-data`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch(
          `${basePath}/api/chart-data?${new URLSearchParams({
            ticker,
            timeframe,
            days: String(lookbackDays),
            source: barSource,
          })}`,
        );
    req
      .then(async (r) => {
        const j = (await r.json()) as ChartDataPayload & { error?: string };
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        if (!cancelled) setData(j);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setErr(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, basePath, timeframe, lookbackDays, barSource, refreshKey, rules]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !data?.candles.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const hasRsi = !!(data.rsi && data.rsi.points.length);
    const hasMacd = !!(data.macd && (data.macd.histogram.length || data.macd.macd.length));
    const mainBottom = hasMacd ? 0.32 : hasRsi ? 0.22 : 0.05;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#2a2e39" },
        horzLines: { color: "#2a2e39" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2e39" },
      timeScale: { borderColor: "#2a2e39", timeVisible: timeframe !== "1D" },
      width: el.clientWidth,
      height: hasMacd ? 640 : hasRsi ? 580 : 520,
    });
    chartRef.current = chart;

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.05, bottom: mainBottom },
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    candles.setData(data.candles);

    const overlays =
      data.emaOverlays && data.emaOverlays.length > 0
        ? data.emaOverlays
        : [
            ...(data.emaFast.length
              ? [{ period: data.emaPeriods.fast, label: `EMA ${data.emaPeriods.fast}`, color: "#d9f854", points: data.emaFast }]
              : []),
            ...(data.emaSlow.length
              ? [{ period: data.emaPeriods.slow, label: `EMA ${data.emaPeriods.slow}`, color: "#2962ff", points: data.emaSlow }]
              : []),
          ];

    for (const ema of overlays) {
      if (!ema.points.length) continue;
      const line = chart.addLineSeries({
        color: ema.color,
        lineWidth: ema.period >= 100 ? 2 : 1,
        title: ema.label,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      line.setData(ema.points as LineData<Time>[]);
    }

    for (const pl of data.priceLevels) {
      candles.createPriceLine({
        price: pl.price,
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: pl.title,
      });
    }

    if (hasRsi && data.rsi) {
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: hasMacd ? 0.72 : 0.78, bottom: hasMacd ? 0.34 : 0.08 },
      });
      const rsiLine = chart.addLineSeries({
        color: "#c084fc",
        lineWidth: 1,
        priceScaleId: "rsi",
        title: `RSI ${data.rsi.period}`,
        priceLineVisible: false,
      });
      rsiLine.setData(data.rsi.points as LineData<Time>[]);
      rsiLine.createPriceLine({ price: 70, color: "#64748b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true });
      rsiLine.createPriceLine({ price: 30, color: "#64748b", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true });
    }

    if (hasMacd && data.macd) {
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0.02 },
      });
      const hist = chart.addHistogramSeries({
        priceScaleId: "macd",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      hist.setData(data.macd.histogram as HistogramData<Time>[]);
      if (data.macd.macd.length) {
        const ml = chart.addLineSeries({
          color: "#38bdf8",
          lineWidth: 1,
          priceScaleId: "macd",
          title: "MACD",
          priceLineVisible: false,
        });
        ml.setData(data.macd.macd as LineData<Time>[]);
      }
      if (data.macd.signal.length) {
        const sl = chart.addLineSeries({
          color: "#fb923c",
          lineWidth: 1,
          priceScaleId: "macd",
          title: "Signal",
          priceLineVisible: false,
        });
        sl.setData(data.macd.signal as LineData<Time>[]);
      }
    }

    const markers = buildMarkers(data);
    if (markers.length) candles.setMarkers(markers);

    chart.timeScale().fitContent();

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, timeframe]);

  const legendEmas =
    data?.emaOverlays && data.emaOverlays.length > 0
      ? data.emaOverlays
      : data
        ? [
            { period: data.emaPeriods.fast, color: "#d9f854" },
            { period: data.emaPeriods.slow, color: "#2962ff" },
          ]
        : [];

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.badge}>
          {loading ? "Loading…" : data ? `Bars: ${data.source}` : "—"}
        </span>
        {data?.sourceNote && <span className={styles.note}>{data.sourceNote}</span>}
        {data && data.rulesTotal !== undefined && (
          <span className={styles.note}>
            {data.rulesApplied
              ? `${data.rulesApplied} rule(s) on chart`
              : data.rulesTotal > 0
                ? `0/${data.rulesTotal} rules — switch chart timeframe to match saved rules`
                : "No alert rules"}
          </span>
        )}
        {data && (data.skippedRules?.length ?? 0) > 0 && (
          <span className={styles.warn}>
            Skipped: {data.skippedRules!.map((s) => `${s.name} (${s.timeframe})`).join(", ")}
          </span>
        )}
        {data && (
          <span className={styles.legend}>
            {legendEmas.map((e) => (
              <span key={e.period} style={{ color: e.color }}>
                EMA {e.period}
              </span>
            ))}
            {data.rsi && <span className={styles.rsiHint}>RSI {data.rsi.period}</span>}
            {data.macd && <span className={styles.macdHint}>MACD</span>}
            <span className={styles.triggerHint}>▲▼ triggers</span>
            <span className={styles.firedHint}>● fired</span>
          </span>
        )}
      </div>
      {err && <p className={styles.err}>{err}</p>}
      <div ref={containerRef} className={styles.chart} />
    </div>
  );
}
