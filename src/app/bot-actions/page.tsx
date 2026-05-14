"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { viewerWriteHeaders } from "@/lib/viewer-write-client";
import type { BotScheduleDoc, ScheduledBotId } from "@/lib/bot-schedule";
import { Square, Play, OctagonPause } from "lucide-react";
import styles from "./page.module.css";

const LABELS: Record<ScheduledBotId, { title: string; hint: string }> = {
  copytrade: {
    title: "copytrade",
    hint: "Capitol Trades scrape + mirror cycle (`main.py`). Monitor cron still runs.",
  },
  "earnings-trade": {
    title: "earnings-trade",
    hint: "Earnings screen + trade (`main.py --screen --trade`). Monitor cron still runs.",
  },
  "indicator-alert-bot": {
    title: "indicator-alert-bot",
    hint: "Technical rules + alert email (`indicator-alert-bot.py`). Full cycle idle when stopped.",
  },
};

export default function BotActionsPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const [schedules, setSchedules] = useState<BotScheduleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<ScheduledBotId | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`${basePath}/api/bot-schedule`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { schedules: BotScheduleDoc[] };
      setSchedules(j.schedules ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    load();
  }, [load]);

  const setPaused = async (bot: ScheduledBotId, paused: boolean) => {
    setBusy(bot);
    setErr(null);
    try {
      const r = await fetch(`${basePath}/api/bot-schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...viewerWriteHeaders() },
        body: JSON.stringify({ bot, paused }),
      });
      if (!r.ok) {
        let msg = await r.text();
        try {
          const j = JSON.parse(msg) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* raw */
        }
        throw new Error(msg || r.statusText);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Bot actions</h1>
      <p className={styles.subtitle}>
        Start or stop scheduled trading cycles. Cron on the VM still invokes each job on schedule; when stopped,
        the bot exits immediately after writing an empty run to its log so Job Runs stays in sync.
      </p>

      {err ? <p className={styles.err}>{err}</p> : null}

      <p className={styles.note}>
        Writes require the same auth as Watchlist (localhost,{" "}
        <code style={{ fontSize: "11px" }}>ALLOW_BROWSER_COSMOS_WRITES</code>, or{" "}
        <code style={{ fontSize: "11px" }}>x-viewer-write-token</code>).
      </p>

      {loading ? (
        <Card>
          <div className={styles.loading}>
            <div className={styles.spinner} />
            Loading schedule…
          </div>
        </Card>
      ) : (
        <div className={styles.grid}>
          {schedules.map((s) => {
            const meta = LABELS[s.bot];
            const paused = Boolean(s.paused);
            return (
              <Card key={s.bot}>
                <div className={styles.cardTitle}>{meta.title}</div>
                <div className={styles.cardMeta}>{meta.hint}</div>
                <div className={styles.statusRow}>
                  <span>Schedule</span>
                  <span className={`${styles.badge} ${paused ? styles.badgeStop : styles.badgeRun}`}>
                    {paused ? "Stopped" : "Running"}
                  </span>
                </div>
                {s.updated_at ? (
                  <div className={styles.cardMeta}>Updated {s.updated_at.slice(0, 19).replace("T", " ")} UTC</div>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnStart}`}
                    disabled={busy === s.bot || !paused}
                    onClick={() => setPaused(s.bot, false)}
                  >
                    <Play size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                    Start
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnStop}`}
                    disabled={busy === s.bot || paused}
                    onClick={() => setPaused(s.bot, true)}
                  >
                    <OctagonPause size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
                    Stop
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)" }}>
          <Square size={16} />
          Bots read state from <code>/api/bot-schedule</code> using <code>TRADE_SCOUT_API</code> (include{" "}
          <code>/scout</code> if your viewer uses a base path).
        </div>
      </Card>
    </div>
  );
}
