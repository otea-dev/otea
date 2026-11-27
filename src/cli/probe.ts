// 'slow': something holds the port but did not answer in time (or answered with a server error), so
// it may still be a busy Otea server; 'down': nothing answers there, or something else does.
export type Probe = 'ours' | 'other' | 'down' | 'slow';

// How long a probe waits for an answer. OTEA_PROBE_TIMEOUT_MS may shorten it (a test that probes a
// server that never answers need not wait the whole of it each time), never lengthen it. A shorter
// wait only reads more servers as 'slow', which keeps their record and ends nothing.
export const PROBE_TIMEOUT_MS = 2000;
const MIN_PROBE_TIMEOUT_MS = 200;
export function probeTimeoutOf(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const given = env.OTEA_PROBE_TIMEOUT_MS ? Number(env.OTEA_PROBE_TIMEOUT_MS) : Number.NaN;
  return Number.isFinite(given)
    ? Math.min(PROBE_TIMEOUT_MS, Math.max(MIN_PROBE_TIMEOUT_MS, given))
    : PROBE_TIMEOUT_MS;
}

// Whether the server at a sign-in link is this Otea home's: it takes the token and sends the browser
// on to a page of its own (a project's, or `/`); another home's server refuses the token.
export async function probeSignIn(signInUrl: string): Promise<Probe> {
  try {
    const response = await fetch(signInUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(probeTimeoutOf()),
    });
    await response.body?.cancel();
    const location = response.headers.get('location') ?? '';
    if (response.status === 302 && location.startsWith('/')) return 'ours';
    if (response.status >= 500) return 'slow';
    return response.status === 401 ? 'other' : 'down';
  } catch (error) {
    // A refused connection is a definite no; a timeout or a reset is not.
    const code = (error as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED' ? 'down' : 'slow';
  }
}
