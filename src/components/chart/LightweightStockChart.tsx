"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type SeriesMarker,
  type Time,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import styles from "./LightweightStockChart.module.css";

export type ChartDataPayload = {
  ticker: string;
  timeframe: string;
  source: string;
  emaPeriods: { fast: number; slow: number };
  candles: CandlestickData<Time>[];
  emaFast: LineData<Time>[];
  emaSlow: LineData<Time>[];
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
};

type Props = {
  ticker: string;
  basePath: string;
  timeframe: string;
  lookbackDays: number;
  refreshKey?: number;
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

export function LightweightStockChart({ ticker, basePath, timeframe, lookbackDays, refreshKey = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [data, setData] = useState<ChartDataPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({
      ticker,
      timeframe,
      days: String(lookbackDays),
    });
    fetch(`${basePath}/api/chart-data?${q}`)
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
  }, [ticker, basePath, timeframe, lookbackDays, refreshKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !data?.candles.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleRef.current = null;
    }

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
      height: 520,
    });
    chartRef.current = chart;

    const candles = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });
    candleRef.current = candles;
    candles.setData(data.candles);

    if (data.emaFast.length) {
      const fast = chart.addLineSeries({
        color: "#d9f854",
        lineWidth: 2,
        title: `EMA ${data.emaPeriods.fast}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      fast.setData(data.emaFast);
    }

    if (data.emaSlow.length) {
      const slow = chart.addLineSeries({
        color: "#2962ff",
        lineWidth: 2,
        title: `EMA ${data.emaPeriods.slow}`,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      slow.setData(data.emaSlow);
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
      candleRef.current = null;
    };
  }, [data, timeframe]);

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.badge}>
          {loading ? "Loading…" : data ? `Bars: ${data.source}` : "—"}
        </span>
        {data && (
          <span className={styles.legend}>
            <span className={styles.emaFast}>EMA {data.emaPeriods.fast}</span>
            <span className={styles.emaSlow}>EMA {data.emaPeriods.slow}</span>
            <span className={styles.triggerHint}>▲▼ rule triggers</span>
            <span className={styles.firedHint}>● fired alerts</span>
          </span>
        )}
      </div>
      {err && <p className={styles.err}>{err}</p>}
      <div ref={containerRef} className={styles.chart} />
    </div>
  );
}
