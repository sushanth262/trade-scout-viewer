"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/components/ui/Card";
import MetricCard from "@/components/ui/MetricCard";
import InfoTip from "@/components/ui/InfoTip";
import type { BotPositionRow } from "@/app/api/bot-trades-analysis/route";
import {
  buildPerformanceSnapshot,
  colorForBot,
  formatUsd,
} from "@/lib/bot-performance-metrics";
import styles from "./BotPerformanceCharts.module.css";

type Group = { bot: string; positions: BotPositionRow[] };

function PlTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload?: { name?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label ?? payload[0]?.payload?.name}</div>
      <div className={v >= 0 ? styles.positive : styles.negative}>
        {v >= 0 ? "+" : ""}
        {formatUsd(v)}
      </div>
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{row.name}</div>
      <div>{formatUsd(row.value)}</div>
    </div>
  );
}

function TickerTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: { ticker: string; unrealizedPl: number; gainPct: number | null } }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{row.ticker}</div>
      <div className={row.unrealizedPl >= 0 ? styles.positive : styles.negative}>
        P&amp;L {row.unrealizedPl >= 0 ? "+" : ""}
        {formatUsd(row.unrealizedPl)}
      </div>
      {row.gainPct != null && Number.isFinite(row.gainPct) && (
        <div className={row.gainPct >= 0 ? styles.positive : styles.negative}>
          {row.gainPct >= 0 ? "+" : ""}
          {row.gainPct.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

export default function BotPerformanceCharts({ groups }: { groups: Group[] }) {
  const snap = useMemo(() => buildPerformanceSnapshot(groups), [groups]);
  const { overall } = snap;

  const winRate =
    overall.winners + overall.losers > 0
      ? `${Math.round((overall.winners / (overall.winners + overall.losers)) * 100)}% winners`
      : undefined;

  const returnDelta =
    overall.returnPct != null
      ? `${overall.returnPct >= 0 ? "+" : ""}${overall.returnPct.toFixed(2)}% on cost`
      : undefined;

  const moversData = useMemo(() => {
    const seen = new Set<string>();
    const rows: { ticker: string; pl: number; gainPct: number | null; fill: string }[] = [];
    for (const r of [...snap.topGainers, ...snap.topLosers]) {
      if (seen.has(r.ticker)) continue;
      seen.add(r.ticker);
      rows.push({
        ticker: r.ticker,
        pl: Math.round(r.unrealizedPl),
        gainPct: r.gainPct,
        fill: r.unrealizedPl >= 0 ? "#15803d" : "#b91c1c",
      });
    }
    return rows.sort((a, b) => b.pl - a.pl);
  }, [snap.topGainers, snap.topLosers]);

  if (overall.positionCount === 0) {
    return null;
  }

  return (
    <section className={styles.dashboard} aria-label="Portfolio performance">
      <div className={styles.metrics}>
        <MetricCard
          label="Invested (cost)"
          value={formatUsd(overall.costBasis)}
          help="Sum of qty × entry price across attributed open positions."
          tint="info"
        />
        <MetricCard
          label="Market value"
          value={formatUsd(overall.marketValue)}
          help="Current notional from Alpaca market value or qty × last price."
        />
        <MetricCard
          label="Unrealized P&L"
          value={`${overall.unrealizedPl >= 0 ? "+" : ""}${formatUsd(overall.unrealizedPl)}`}
          delta={returnDelta}
          deltaType={overall.unrealizedPl >= 0 ? "up" : "down"}
          tint={overall.unrealizedPl >= 0 ? "success" : "danger"}
        />
        <MetricCard
          label="Open positions"
          value={overall.positionCount}
          delta={winRate}
          deltaType="neutral"
          help={`${overall.winners} up · ${overall.losers} down · ${overall.flat} flat (by gain %).`}
        />
        <MetricCard
          label="Avg return"
          value={
            overall.returnPct != null
              ? `${overall.returnPct >= 0 ? "+" : ""}${overall.returnPct.toFixed(2)}%`
              : "—"
          }
          deltaType={overall.returnPct != null && overall.returnPct >= 0 ? "up" : "down"}
          help="Unrealized P&L ÷ cost basis for positions with known entry."
        />
      </div>

      <div className={styles.chartsGrid}>
        <Card className={styles.chartCard}>
          <h2 className={styles.chartTitle}>
            Capital allocation by bot
            <InfoTip text="Share of current market value attributed to each bot (trade-log ownership)." />
          </h2>
          <p className={styles.chartHint}>Where invested capital sits today</p>
          {snap.allocation.length === 0 ? (
            <div className={styles.emptyChart}>No market value data</div>
          ) : (
            <>
              <div className={styles.chartBody}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={snap.allocation}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={2}
                    >
                      {snap.allocation.map((entry) => (
                        <Cell key={entry.bot} fill={colorForBot(entry.bot)} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.legendRow}>
                {snap.allocation.map((a) => (
                  <span key={a.bot} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ background: colorForBot(a.bot) }} />
                    {a.name} {formatUsd(a.value, true)}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className={styles.chartCard}>
          <h2 className={styles.chartTitle}>
            Unrealized P&amp;L by bot
            <InfoTip text="Total open profit or loss per bot after deduplicating shared Alpaca symbols." />
          </h2>
          <p className={styles.chartHint}>Gain vs loss contribution by strategy</p>
          {snap.plByBot.length === 0 ? (
            <div className={styles.emptyChart}>No P&amp;L data</div>
          ) : (
            <div className={styles.chartBody}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snap.plByBot} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(v, true)} />
                  <Tooltip content={<PlTooltip />} />
                  <Bar dataKey="pl" radius={[4, 4, 0, 0]}>
                    {snap.plByBot.map((entry) => (
                      <Cell key={entry.bot} fill={entry.pl >= 0 ? "#15803d" : "#b91c1c"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className={styles.chartCard}>
        <h2 className={styles.chartTitle}>
          Top movers (unrealized)
          <InfoTip text="Largest open winners and losers by dollar P&L across all bots." />
        </h2>
        <p className={styles.chartHint}>Stock-level gain and loss — green up, red down</p>
        {moversData.length === 0 ? (
          <div className={styles.emptyChart}>No position-level P&amp;L</div>
        ) : (
          <div className={`${styles.chartBody} ${styles.chartBodyTall}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={moversData}
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(v, true)} />
                <YAxis type="category" dataKey="ticker" width={52} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as (typeof moversData)[0] | undefined;
                    if (!row) return null;
                    return (
                      <div className={styles.tooltip}>
                        <div className={styles.tooltipLabel}>{row.ticker}</div>
                        <div className={row.pl >= 0 ? styles.positive : styles.negative}>
                          {row.pl >= 0 ? "+" : ""}
                          {formatUsd(row.pl)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="pl" radius={[0, 4, 4, 0]}>
                  {moversData.map((row) => (
                    <Cell key={row.ticker} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className={styles.chartCard}>
        <h2 className={styles.chartTitle}>
          Largest exposures
          <InfoTip text="Top symbols by current market value in the open book." />
        </h2>
        <p className={styles.chartHint}>Notional invested per ticker</p>
        {snap.exposure.length === 0 ? (
          <div className={styles.emptyChart}>No exposure data</div>
        ) : (
          <div className={styles.chartBody}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snap.exposure} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="ticker"
                  tick={{ fontSize: 10 }}
                  angle={-35}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(v, true)} />
                <Tooltip
                  formatter={(v) => formatUsd(Number(v ?? 0))}
                  labelFormatter={(l) => String(l)}
                />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </section>
  );
}


