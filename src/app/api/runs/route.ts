import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

const LOG_ROOT = process.env.LOG_ROOT ?? "/home/azureuser/claudetrades";

// Per-bot subdirectory is tried first (where cron writes); top-level is
// kept as a legacy fallback.
const LOG_CANDIDATES: Record<string, string[]> = {
  copytrade: ["copytrade/copytrade.log", "copytrade.log"],
  "earnings-trade": ["earnings-trade/earnings-trade.log", "earnings-trade.log"],
  "indicator-alert-bot": [
    "indicator-alert-bot/indicator-alert-bot.log",
    "indicator-alert-bot.log",
    "claudetrades/indicator-alert-bot/indicator-alert-bot.log",
  ],
};

export interface RunRecord {
  job: "copytrade" | "earnings-trade" | "indicator-alert-bot";
  timestamp: string;
  status: "success" | "fail";
  // Per-run extracted counters
  submitted: number;
  watched: number;
  failed: number;
  // Source pulls (mostly populated for copytrade main cycles)
  quiver: number;
  capitolTrades: number;
  confirmed: number;
  // Earnings-trade only
  screened: number;
  buyRated: number;
  // Short human summary for tooltip
  summary: string;
  /** ok | below_min_balance | account_unreachable | paused */
  balanceLimit?: string;
  portfolioValue?: number;
}

interface AggregateBuckets {
  submitted: number;
  watched: number;
  failed: number;
  quiver: number;
  capitolTrades: number;
  confirmed: number;
  screened: number;
  buyRated: number;
}

const emptyAgg = (): AggregateBuckets => ({
  submitted: 0, watched: 0, failed: 0,
  quiver: 0, capitolTrades: 0, confirmed: 0,
  screened: 0, buyRated: 0,
});

const TS_RE = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?)/;

/** Bot logs use naive UTC timestamps on the VM; mark as Z so browsers convert to local. */
function parseTimestamp(line: string): string | null {
  const m = TS_RE.exec(line);
  if (!m) return null;
  let s = m[1].replace(",", ".").replace(" ", "T");
  if (!/[zZ]$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s += "Z";
  }
  return s;
}

function parseBalanceFromText(text: string): Pick<RunRecord, "balanceLimit" | "portfolioValue"> {
  const lim = text.match(/balance_limit=(\w+)/);
  const port = text.match(/portfolio=\$?([\d,]+\.?\d*)/);
  return {
    balanceLimit: lim?.[1],
    portfolioValue: port ? parseFloat(port[1].replace(/,/g, "")) : undefined,
  };
}

function parseBalanceFromBuffer(buffer: string[]): Pick<RunRecord, "balanceLimit" | "portfolioValue"> {
  for (let i = buffer.length - 1; i >= 0; i--) {
    const hit = parseBalanceFromText(buffer[i]);
    if (hit.balanceLimit) return hit;
  }
  return {};
}

function balanceSummarySuffix(bal: Pick<RunRecord, "balanceLimit" | "portfolioValue">): string {
  if (!bal.balanceLimit) return "";
  const pv =
    bal.portfolioValue != null && Number.isFinite(bal.portfolioValue)
      ? ` · portfolio $${bal.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : "";
  if (bal.balanceLimit === "ok") return ` · balance OK${pv}`;
  if (bal.balanceLimit === "below_min_balance") return ` · trading blocked (below $40k min)${pv}`;
  if (bal.balanceLimit === "account_unreachable") return " · balance check failed";
  if (bal.balanceLimit === "paused") return " · schedule paused";
  return ` · balance ${bal.balanceLimit}${pv}`;
}

async function resolveLogPath(job: string): Promise<string | null> {
  const candidates = LOG_CANDIDATES[job];
  if (!candidates) return null;
  for (const c of candidates) {
    const p = join(LOG_ROOT, c);
    try {
      await stat(p);
      return p;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Parse copytrade.log into runs of main.py.
 * A run is bracketed by the next "Cycle done" line. We attribute all
 * preceding lines (since the prior Cycle-done) to this run.
 */
function parseCopytradeRuns(raw: string): RunRecord[] {
  const lines = raw.split("\n");
  const runs: RunRecord[] = [];

  let buffer: string[] = [];
  for (const line of lines) {
    buffer.push(line);

    // monitor.py — short, non-cycle. Skip aggregation but still record as a
    // "monitor heartbeat" run if it contains the canonical line.
    if (/No open positions to monitor\./.test(line)) {
      const ts = parseTimestamp(line);
      if (ts) {
        runs.push({
          job: "copytrade",
          timestamp: ts,
          status: "success",
          submitted: 0, watched: 0, failed: 0,
          quiver: 0, capitolTrades: 0, confirmed: 0,
          screened: 0, buyRated: 0,
          summary: "monitor: no open positions",
        });
      }
      buffer = [];
      continue;
    }

    // End of main cycle
    const cycleMatch = line.match(/Cycle done.*?submitted=(\d+).*?dry_run=(\d+).*?watch_logged=(\d+).*?skipped=(\d+).*?failed=(\d+)/);
    if (cycleMatch) {
      const ts = parseTimestamp(line) ?? new Date().toISOString();
      const submitted = parseInt(cycleMatch[1], 10) || 0;
      const watched = (parseInt(cycleMatch[3], 10) || 0) + (parseInt(cycleMatch[2], 10) || 0);
      const failed = parseInt(cycleMatch[5], 10) || 0;

      // Scan buffer for source counts
      let quiver = 0, capitolTrades = 0, confirmed = 0;
      for (const b of buffer) {
        const q = b.match(/Quiver:\s*(\d+)\s*tickers/);
        if (q) quiver = Math.max(quiver, parseInt(q[1], 10));
        const c = b.match(/Capitol Trades:\s*(\d+)\s*tickers/);
        if (c) capitolTrades = Math.max(capitolTrades, parseInt(c[1], 10));
        const cm = b.match(/Combined movers:\s*\d+\s*total\s*\|\s*(\d+)\s*confirmed/);
        if (cm) confirmed = Math.max(confirmed, parseInt(cm[1], 10));
      }

      const bal = { ...parseBalanceFromText(line), ...parseBalanceFromBuffer(buffer) };
      const blocked = bal.balanceLimit === "below_min_balance" || bal.balanceLimit === "account_unreachable";
      const status: "success" | "fail" =
        blocked ? "fail" : submitted + watched > 0 || failed === 0 ? "success" : "fail";
      const summary =
        `cycle: submitted ${submitted} · watched ${watched} · failed ${failed} ` +
        `(Q:${quiver} CT:${capitolTrades} confirmed:${confirmed})` +
        balanceSummarySuffix(bal);

      runs.push({
        job: "copytrade",
        timestamp: ts,
        status,
        submitted, watched, failed,
        quiver, capitolTrades, confirmed,
        screened: 0, buyRated: 0,
        summary,
        ...bal,
      });
      buffer = [];
    }
  }

  return runs;
}

/**
 * Parse earnings-trade.log.
 * Run-completion markers:
 *   - "Screened N tickers — M rated BUY"
 *   - "No tickers with upcoming earnings — nothing to screen"
 *   - "No open positions" (monitor heartbeat)
 */
function parseEarningsTradeRuns(raw: string): RunRecord[] {
  const lines = raw.split("\n");
  const runs: RunRecord[] = [];

  let buffer: string[] = [];
  for (const line of lines) {
    buffer.push(line);

    if (/No open positions\b/.test(line)) {
      const ts = parseTimestamp(line);
      if (ts) {
        runs.push({
          job: "earnings-trade",
          timestamp: ts,
          status: "success",
          submitted: 0, watched: 0, failed: 0,
          quiver: 0, capitolTrades: 0, confirmed: 0,
          screened: 0, buyRated: 0,
          summary: "monitor: no open positions",
        });
      }
      buffer = [];
      continue;
    }

    const screenMatch = line.match(/Screened\s+(\d+)\s+tickers.*?(\d+)\s+rated\s+BUY/i);
    const emptyMatch = /No tickers with upcoming earnings/.test(line);

    if (screenMatch || emptyMatch) {
      const ts = parseTimestamp(line) ?? new Date().toISOString();
      const screened = screenMatch ? parseInt(screenMatch[1], 10) : 0;
      const buyRated = screenMatch ? parseInt(screenMatch[2], 10) : 0;

      // Source counts: Quiver / Capitol Trades / Confirmed pulled from buffer (earnings-trade does this too)
      let quiver = 0, capitolTrades = 0, confirmed = 0, failed = 0;
      for (const b of buffer) {
        const q = b.match(/Quiver:\s*(\d+)\s*tickers/);
        if (q) quiver = Math.max(quiver, parseInt(q[1], 10));
        const c = b.match(/Capitol Trades:\s*(\d+)\s*tickers/);
        if (c) capitolTrades = Math.max(capitolTrades, parseInt(c[1], 10));
        const cm = b.match(/Combined movers:\s*\d+\s*total\s*\|\s*(\d+)\s*confirmed/);
        if (cm) confirmed = Math.max(confirmed, parseInt(cm[1], 10));
        if (/\bERROR\b/.test(b) && !/HTTP Error 404/.test(b)) failed += 1;
      }

      const bal = { ...parseBalanceFromText(line), ...parseBalanceFromBuffer(buffer) };
      const blocked = bal.balanceLimit === "below_min_balance" || bal.balanceLimit === "account_unreachable";
      const status: "success" | "fail" = blocked
        ? "fail"
        : screened > 0 || emptyMatch
          ? "success"
          : failed > 0
            ? "fail"
            : "success";
      const summary = (
        screenMatch
          ? `screened ${screened} · ${buyRated} BUY-rated (Q:${quiver} CT:${capitolTrades} confirmed:${confirmed})`
          : `no upcoming earnings to screen (Q:${quiver} CT:${capitolTrades} confirmed:${confirmed})`
      ) + balanceSummarySuffix(bal);

      runs.push({
        job: "earnings-trade",
        timestamp: ts,
        status,
        submitted: 0, watched: 0, failed,
        quiver, capitolTrades, confirmed,
        screened, buyRated,
        summary,
        ...bal,
      });
      buffer = [];
    }
  }

  return runs;
}

/**
 * Parse indicator-alert-bot.log (stdout from scheduled task under claudetrades).
 * Each `Cycle done (poll interval config: N min).` line ends one poll cycle.
 */
function parseIndicatorAlertRuns(raw: string): RunRecord[] {
  const lines = raw.split("\n");
  const runs: RunRecord[] = [];
  let buffer: string[] = [];
  let lastKnownTs: string | null = null;

  for (const line of lines) {
    buffer.push(line);
    const tsLine = parseTimestamp(line);
    if (tsLine) lastKnownTs = tsLine;

    const cycleMatch = line.match(/Cycle done \(poll interval config: (\d+) min\)\./);
    if (!cycleMatch) continue;

    const ts = parseTimestamp(line) ?? lastKnownTs ?? new Date().toISOString();
    let fired = 0;
    let executed = 0;
    let failed = 0;
    for (const b of buffer) {
      if (/\bFired\s+ast-/.test(b) || /\bFired ast-/.test(b)) fired += 1;
      if (/\bExecuted\s+ast-/.test(b) || /Executed\s+ast-/.test(b)) executed += 1;
      if (/\bERROR\b/.test(b) && !/HTTP Error 404/.test(b)) failed += 1;
    }

    const bal = { ...parseBalanceFromText(line), ...parseBalanceFromBuffer(buffer) };
    const blocked = bal.balanceLimit === "below_min_balance" || bal.balanceLimit === "account_unreachable";
    const status: "success" | "fail" = blocked ? "fail" : failed > 0 ? "fail" : "success";
    const pollMin = cycleMatch[1] ?? "?";
    const summary =
      (fired || executed
        ? `alerts fired ${fired} · orders executed ${executed} · poll ${pollMin} min`
        : `cycle ok (poll ${pollMin} min)`) + balanceSummarySuffix(bal);

    runs.push({
      job: "indicator-alert-bot",
      timestamp: ts,
      status,
      submitted: executed,
      watched: fired,
      failed,
      quiver: 0,
      capitolTrades: 0,
      confirmed: 0,
      screened: 0,
      buyRated: 0,
      summary,
      ...bal,
    });
    buffer = [];
  }

  return runs;
}

function aggregate(runs: RunRecord[]): AggregateBuckets {
  const agg = emptyAgg();
  for (const r of runs) {
    agg.submitted += r.submitted;
    agg.watched += r.watched;
    agg.failed += r.failed;
    agg.quiver += r.quiver;
    agg.capitolTrades += r.capitolTrades;
    agg.confirmed += r.confirmed;
    agg.screened += r.screened;
    agg.buyRated += r.buyRated;
  }
  return agg;
}

export async function GET(req: NextRequest) {
  const hours = parseInt(req.nextUrl.searchParams.get("hours") ?? "168", 10); // default 7 days
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "300", 10);
  const cutoff = Date.now() - hours * 3600 * 1000;

  const result: {
    runs: RunRecord[];
    copytrade: AggregateBuckets;
    earningsTrade: AggregateBuckets;
    indicatorAlert: AggregateBuckets;
    files: { job: string; path: string | null; sizeBytes: number; mtime: string | null }[];
    generatedAt: string;
  } = {
    runs: [],
    copytrade: emptyAgg(),
    earningsTrade: emptyAgg(),
    indicatorAlert: emptyAgg(),
    files: [],
    generatedAt: new Date().toISOString(),
  };

  for (const job of ["copytrade", "earnings-trade", "indicator-alert-bot"] as const) {
    const path = await resolveLogPath(job);
    if (!path) {
      result.files.push({ job, path: null, sizeBytes: 0, mtime: null });
      continue;
    }
    try {
      const info = await stat(path);
      const raw = await readFile(path, "utf-8");
      result.files.push({
        job, path,
        sizeBytes: info.size,
        mtime: info.mtime.toISOString(),
      });

      const parsed =
        job === "copytrade"
          ? parseCopytradeRuns(raw)
          : job === "earnings-trade"
            ? parseEarningsTradeRuns(raw)
            : parseIndicatorAlertRuns(raw);

      // Time filter (skip records w/ unparseable timestamps as best-effort)
      const filtered = parsed.filter((r) => {
        const t = Date.parse(r.timestamp);
        return !isNaN(t) && t >= cutoff;
      });

      result.runs.push(...filtered);

      const agg = aggregate(filtered);
      if (job === "copytrade") result.copytrade = agg;
      else if (job === "earnings-trade") result.earningsTrade = agg;
      else result.indicatorAlert = agg;
    } catch (err) {
      console.error(`Failed to parse ${job} log:`, err);
      result.files.push({ job, path, sizeBytes: 0, mtime: null });
    }
  }

  // Sort runs by time and cap
  result.runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (result.runs.length > limit) {
    result.runs = result.runs.slice(-limit);
  }

  return NextResponse.json(result);
}
