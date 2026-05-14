import { createHmac, timingSafeEqual } from "crypto";

export function signAlertAction(alertId: string, action: string, secret: string): string {
  return createHmac("sha256", secret).update(`${alertId}|${action}`, "utf8").digest("hex");
}

export function verifyAlertAction(
  alertId: string,
  action: string,
  token: string,
  secret: string,
): boolean {
  if (!token || !secret) return false;
  const expected = signAlertAction(alertId, action, secret);
  try {
    const a = Buffer.from(token, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
