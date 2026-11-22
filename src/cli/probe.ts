// 'slow': something holds the port but did not answer in time (or answered with a server error), so
// it may still be a busy Otea server; 'down': nothing answers there, or something else does.
export type Probe = 'ours' | 'other' | 'down' | 'slow';

// Whether the server at a sign-in link is this Otea home's: it takes the token and sends the browser
// on to a page of its own (a project's, or `/`); another home's server refuses the token.
export async function probeSignIn(signInUrl: string): Promise<Probe> {
  try {
    const response = await fetch(signInUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
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
