import { NextRequest, NextResponse } from "next/server";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function isLocalRequest(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-for");
  const real = req.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() ?? real ?? "";

  if (LOOPBACK.has(ip)) return true;

  // Docker internal networks (172.x.x.x) are also considered local
  if (ip.startsWith("172.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;

  // If no IP header at all, the request is likely direct to the process (local)
  if (!forwarded && !real) return true;

  return false;
}

/** Same secret must be sent as header `x-viewer-write-token` (or Authorization: Bearer …) from the browser. */
export function viewerWriteTokenMatches(req: NextRequest): boolean {
  const secret = process.env.VIEWER_WRITE_TOKEN?.trim();
  if (!secret) return false;
  const h = req.headers.get("x-viewer-write-token")?.trim();
  if (h === secret) return true;
  const auth = req.headers.get("authorization")?.trim();
  return auth === `Bearer ${secret}`;
}

/**
 * Writes that should work from the public UI (behind nginx) as well as from bots on the VM.
 * - Always allowed from localhost / private Docker IPs (isLocalRequest).
 * - Or when VIEWER_WRITE_TOKEN is set and the request carries that token (recommended for HTTPS).
 * - Or when ALLOW_BROWSER_COSMOS_WRITES=true (explicit opt-in; weaker — use only on trusted networks).
 */
export function allowViewerWrite(req: NextRequest): boolean {
  if (isLocalRequest(req)) return true;
  if (process.env.ALLOW_BROWSER_COSMOS_WRITES === "true") return true;
  return viewerWriteTokenMatches(req);
}

export function rejectExternal(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Write operations are only allowed from within the VM, or set VIEWER_WRITE_TOKEN and send header x-viewer-write-token from the UI, or set ALLOW_BROWSER_COSMOS_WRITES=true (trusted networks only).",
    },
    { status: 403 }
  );
}
