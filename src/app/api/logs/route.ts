import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { getContainer, LogEntry } from "@/lib/cosmos";
import { isLocalRequest, rejectExternal } from "@/lib/localhost-only";

const LOG_ROOT = process.env.LOG_ROOT ?? "/home/azureuser/claudetrades";

// Per-bot subdirectory is tried first because cron writes there. The
// top-level paths are kept as fallback for legacy / symlinked deployments.
const ALLOWED_LOGS: Record<string, string[]> = {
  "earnings-trade": ["earnings-trade/earnings-trade.log", "earnings-trade.log"],
  copytrade: ["copytrade/copytrade.log", "copytrade.log"],
  "indicator-alert-bot": [
    "indicator-alert-bot/indicator-alert-bot.log",
    "indicator-alert-bot.log",
    "claudetrades/indicator-alert-bot/indicator-alert-bot.log",
  ],
  cosmos: ["cosmos_sync.log"],
};

const TS_RE = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?)/;

function parseTimestamp(line: string): string | null {
  const m = TS_RE.exec(line);
  if (!m) return null;
  return m[1].replace(",", ".").replace(" ", "T");
}

function parseLevel(line: string): string {
  if (/\bERROR\b/.test(line)) return "ERROR";
  if (/\bWARNING\b/.test(line)) return "WARNING";
  if (/\bDEBUG\b/.test(line)) return "DEBUG";
  if (/\bINFO\b/.test(line)) return "INFO";
  return "";
}

function entryId(bot: string, timestamp: string, line: string): string {
  const h = createHash("sha1").update(`${bot}|${timestamp}|${line}`).digest("hex").slice(0, 24);
  return `${bot}-${h}`;
}

async function resolveLogPath(name: string): Promise<{ fullPath: string | null; relPath: string }> {
  const candidates = ALLOWED_LOGS[name];
  if (!candidates) return { fullPath: null, relPath: "" };
  for (const c of candidates) {
    const p = join(LOG_ROOT, c);
    try {
      await stat(p);
      return { fullPath: p, relPath: c };
    } catch { /* try next */ }
  }
  return { fullPath: null, relPath: candidates[0] };
}

async function readLocalEntries(
  name: string,
  cutoffIso: string | null,
): Promise<{ entries: LogEntry[]; relPath: string; sizeBytes: number; fullPath: string | null }> {
  const { fullPath, relPath } = await resolveLogPath(name);
  if (!fullPath) return { entries: [], relPath, sizeBytes: 0, fullPath: null };
  const info = await stat(fullPath);
  const raw = await readFile(fullPath, "utf-8");
  const out: LogEntry[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const ts = parseTimestamp(line);
    const isoTs = ts ?? "";
    if (cutoffIso && isoTs && isoTs < cutoffIso) continue;
    out.push({
      id: entryId(name, isoTs, line),
      kind: "logline",
      ticker: name,
      bot: name,
      timestamp: isoTs,
      level: parseLevel(line),
      line,
      ingestedAt: "",
    });
  }
  return { entries: out, relPath, sizeBytes: info.size, fullPath };
}

async function readCosmosEntries(
  bot: string,
  cutoffIso: string,
  maxItems: number,
): Promise<LogEntry[]> {
  try {
    const container = await getContainer("logs");
    // Loglines live in the unified `trades` container, distinguished by
    // kind = "logline" and partitioned on `ticker` (set to the bot name).
    const query = {
      query:
        'SELECT TOP @max c.id, c.kind, c.ticker, c.bot, c.timestamp, c.level, c.line, c.ingestedAt ' +
        'FROM c WHERE c.kind = "logline" AND c.bot = @bot AND c.timestamp >= @cutoff ' +
        'ORDER BY c.timestamp DESC',
      parameters: [
        { name: "@bot", value: bot },
        { name: "@cutoff", value: cutoffIso },
        { name: "@max", value: maxItems },
      ],
    };
    const { resources } = await container.items.query<LogEntry>(query, {
      partitionKey: bot,
    }).fetchAll();
    return resources;
  } catch (err) {
    console.warn(`Cosmos log query failed for ${bot}:`, err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const name = sp.get("name") ?? "earnings-trade";
  const days = Math.max(0, parseFloat(sp.get("days") ?? "3"));
  const tail = parseInt(sp.get("tail") ?? "0", 10); // 0 = no cap
  const search = (sp.get("search") ?? "").trim();
  const level = (sp.get("level") ?? "").trim();
  const includeCosmos = sp.get("cosmos") !== "false"; // default true

  if (!ALLOWED_LOGS[name]) {
    return NextResponse.json({ error: `Unknown log: ${name}` }, { status: 400 });
  }

  const cutoffIso = days > 0
    ? new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 23)
    : null;

  let local: { entries: LogEntry[]; relPath: string; sizeBytes: number; fullPath: string | null } = {
    entries: [], relPath: "", sizeBytes: 0, fullPath: null,
  };
  try {
    local = await readLocalEntries(name, cutoffIso);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  let cosmos: LogEntry[] = [];
  if (includeCosmos && cutoffIso) {
    cosmos = await readCosmosEntries(name, cutoffIso, 5000);
  }

  // Merge, dedupe by id, prefer cosmos record if both present
  const byId = new Map<string, LogEntry>();
  for (const e of local.entries) byId.set(e.id, e);
  for (const e of cosmos) byId.set(e.id, e);

  let entries = Array.from(byId.values());

  if (level) entries = entries.filter((e) => e.level === level.toUpperCase());
  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter((e) => e.line.toLowerCase().includes(q));
  }

  // Sort chronological ascending (timestamps without parse come last)
  entries.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
  });

  const total = entries.length;
  if (tail > 0 && entries.length > tail) entries = entries.slice(-tail);

  return NextResponse.json({
    name,
    file: local.relPath,
    fileResolved: local.fullPath,
    logRoot: LOG_ROOT,
    sizeBytes: local.sizeBytes,
    totalLines: total,
    days,
    sources: {
      local: local.entries.length,
      cosmos: cosmos.length,
    },
    // Back-compat field: raw lines, used by current UI
    lines: entries.map((e) => e.line),
    entries,
  });
}

interface RawIngestEntry {
  bot?: string;
  timestamp?: string;
  level?: string;
  line?: string;
}

export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const body: RawIngestEntry | RawIngestEntry[] = await req.json();
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return NextResponse.json({ created: 0 });

    const container = await getContainer("logs");
    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;

    for (const item of items) {
      const bot = (item.bot ?? "").trim();
      const line = (item.line ?? "").trim();
      if (!bot || !line) { skipped++; continue; }

      const ts = item.timestamp || parseTimestamp(line) || "";
      const level = (item.level ?? parseLevel(line)).toUpperCase();
      const doc: LogEntry = {
        id: entryId(bot, ts, line),
        kind: "logline",
        ticker: bot, // partition key value
        bot,
        timestamp: ts,
        level,
        line,
        ingestedAt: now,
      };
      await container.items.upsert(doc);
      created++;
    }

    return NextResponse.json({ created, skipped });
  } catch (err) {
    console.error("logs POST error:", err);
    return NextResponse.json({ error: "Failed to ingest logs" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isLocalRequest(req)) return rejectExternal();
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.max(1, parseFloat(sp.get("olderThanDays") ?? "7"));
    const cutoffIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const container = await getContainer("logs");
    let deleted = 0;
    const errors: string[] = [];

    // Loglines are stored in the unified `trades` container with kind="logline".
    // Partition key for deletes is `ticker` (the bot name).
    const query = {
      query:
        'SELECT c.id, c.ticker FROM c WHERE c.kind = "logline" AND c.timestamp < @cutoff',
      parameters: [{ name: "@cutoff", value: cutoffIso }],
    };
    const iterator = container.items.query<{ id: string; ticker: string }>(
      query,
      { maxItemCount: 200 },
    );
    while (iterator.hasMoreResults()) {
      const { resources } = await iterator.fetchNext();
      for (const r of resources) {
        try {
          await container.item(r.id, r.ticker).delete();
          deleted++;
        } catch (e) {
          errors.push(`${r.id}: ${String(e).slice(0, 80)}`);
        }
      }
    }

    return NextResponse.json({ deleted, cutoffIso, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error("logs DELETE error:", err);
    return NextResponse.json({ error: "Failed to prune logs" }, { status: 500 });
  }
}
