const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" / "in 2 days", at the coarsest unit that still says something. */
export function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    abs < 3_600_000
      ? ["minute", 60_000]
      : abs < 86_400_000
        ? ["hour", 3_600_000]
        : ["day", 86_400_000];
  return RELATIVE.format(Math.round(ms / size), unit);
}
