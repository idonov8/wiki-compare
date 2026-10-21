/**
 * A per-visitor allowance for the paths that spend money: a fresh comparison and
 * a generated explanation.
 *
 * In memory, so each server instance counts on its own and a cold start forgets.
 * That is enough to stop one tab from looping on an endpoint, which is the abuse
 * this is for; it is not a quota anyone could be billed against.
 */
const windows = new Map<string, number[]>();

export function visitorKey(headers: Headers): string {
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Whether `key` may spend once more within `limit` uses per `windowMs`. Records
 *  the use when it may. */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) {
    for (const [k, times] of windows) {
      if (!times.some((t) => now - t < windowMs)) windows.delete(k);
    }
  }
  return true;
}
