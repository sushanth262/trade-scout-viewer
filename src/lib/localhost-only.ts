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

export function rejectExternal(): NextResponse {
  return NextResponse.json(
    { error: "Write operations are only allowed from within the VM" },
    { status: 403 }
  );
}
