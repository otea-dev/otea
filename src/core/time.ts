// A timestamp as every text of the CLI and the MCP tools says it: "2026-11-12 10:04 UTC". One
// clock for every agent and person, wherever each runs; --json keeps the full ISO timestamp.
export function timeText(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// What the person's own clock reads at `now`, with its offset and zone: "09:00 (UTC-3,
// America/Argentina/Buenos_Aires)". The texts stay in UTC; this is for the agent that talks with the
// person (the assistant), so it says times as they read them. `zone` defaults to this computer's.
export function clockText(now: number, zone?: string): string {
  const named = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = (timeZoneName: 'shortOffset' | undefined) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: named,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timeZoneName ? { timeZoneName } : {}),
    }).formatToParts(now);
  const time = parts(undefined)
    .filter(({ type }) => type === 'hour' || type === 'minute')
    .map(({ value }) => value)
    .join(':');
  const offset =
    parts('shortOffset')
      .find(({ type }) => type === 'timeZoneName')
      // Newer ICU writes a zero offset as «GMT+0», older as «GMT»: both read «UTC».
      ?.value.replace(/^GMT(?:[+-]0+(?::00)?)?$/, 'GMT')
      .replace('GMT', 'UTC') ?? 'UTC';
  return `${time} (${offset}, ${named})`;
}
