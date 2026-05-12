import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

const LOG_ROOT = process.env.LOG_ROOT ?? "/home/azureuser/claudetrades";

const ALLOWED_LOGS: Record<string, string[]> = {
  "earnings-trade": ["earnings-trade.log", "earnings-trade/earnings-trade.log"],
  copytrade: ["copytrade.log", "copytrade/copytrade.log"],
  cosmos: ["cosmos_sync.log"],
};

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "earnings-trade";
  const tail = parseInt(req.nextUrl.searchParams.get("tail") ?? "200", 10);
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const level = req.nextUrl.searchParams.get("level") ?? "";

  const candidates = ALLOWED_LOGS[name];
  if (!candidates) {
    return NextResponse.json({ error: `Unknown log: ${name}` }, { status: 400 });
  }

  let fullPath = "";
  let relPath = candidates[0];
  for (const c of candidates) {
    const p = join(LOG_ROOT, c);
    try {
      await stat(p);
      fullPath = p;
      relPath = c;
      break;
    } catch { /* try next */ }
  }
  if (!fullPath) {
    return NextResponse.json({ name, file: relPath, sizeBytes: 0, totalLines: 0, lines: [] });
  }

  try {
    const info = await stat(fullPath);
    const raw = await readFile(fullPath, "utf-8");
    let lines = raw.split("\n").filter((l) => l.trim() !== "");

    if (level) {
      lines = lines.filter((l) => l.includes(level.toUpperCase()));
    }
    if (search) {
      const q = search.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(q));
    }

    const total = lines.length;
    const sliced = lines.slice(-Math.min(tail, 2000));

    return NextResponse.json({
      name,
      file: relPath,
      sizeBytes: info.size,
      totalLines: total,
      lines: sliced,
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return NextResponse.json({ name, file: relPath, sizeBytes: 0, totalLines: 0, lines: [] });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
