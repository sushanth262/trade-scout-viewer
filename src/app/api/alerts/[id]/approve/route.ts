import { NextRequest, NextResponse } from "next/server";
import { getContainer, AlertState } from "@/lib/cosmos";
import { verifyAlertAction } from "@/lib/alert-hmac";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const ticker = sp.get("ticker");
  const token = sp.get("token");
  const action = sp.get("action");
  const secret = process.env.ALERT_HMAC_SECRET;

  if (!ticker || !token || (action !== "approve" && action !== "reject")) {
    return new NextResponse("Missing ticker, token, or valid action (approve|reject).", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!secret) {
    return new NextResponse("Server is not configured for alert approvals (ALERT_HMAC_SECRET).", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (!verifyAlertAction(id, action, token, secret)) {
    return new NextResponse("Invalid or expired approval link.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const container = await getContainer("trades");
    const { resource: existing } = await container.item(id, ticker.toUpperCase()).read<AlertState>();
    if (!existing || existing.kind !== "alert_state") {
      return new NextResponse("Alert not found.", { status: 404, headers: { "content-type": "text/plain" } });
    }
    if (existing.status !== "pending") {
      return new NextResponse(`Alert is already ${existing.status}.`, {
        status: 409,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const now = new Date().toISOString();
    const next: AlertState = {
      ...existing,
      status: action === "approve" ? "approved" : "rejected",
      approved_at: action === "approve" ? now : existing.approved_at,
    };
    await container.items.upsert(next);
    return new NextResponse(
      action === "approve"
        ? "Approved. The indicator bot will place the order on its next run if action is BUY/SELL."
        : "Rejected. No order will be placed.",
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  } catch (e) {
    console.error("approve GET:", e);
    return new NextResponse("Failed to update alert.", { status: 500, headers: { "content-type": "text/plain" } });
  }
}
