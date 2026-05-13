/**
 * All timestamps in Cosmos / the bots are stored as UTC ISO-8601.
 * The UI renders them in the browser's local time zone using these helpers,
 * and includes a short timezone label so users always know which zone they
 * are looking at.
 */

const _localFmt = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat(undefined, {
      year: "2-digit",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    })
  : null;

const _shortFmt = typeof Intl !== "undefined"
  ? new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    })
  : null;

/** "May 13, 09:00:12 PDT" — for table cells. */
export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return _shortFmt ? _shortFmt.format(d) : d.toLocaleString();
}

/** "May 13, 26, 09:00:12 PDT" — for tooltips/headers. */
export function formatLocalTimeLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return _localFmt ? _localFmt.format(d) : d.toLocaleString();
}

/** Best-effort short IANA-style abbreviation for the user's current zone. */
export function localTimeZoneAbbr(): string {
  if (typeof Intl === "undefined") return "";
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
