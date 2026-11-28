import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCollection } from '../app/collections.ts';
import { createItem, moveItem } from '../app/items.ts';
import { claimItem } from '../app/leases.ts';
import { choosePhoneTransport } from '../app/phone.ts';
import type { Project } from '../app/project.ts';
import { fakeTailscale, TAILNET_HOST } from '../app/tailscale-testing.ts';
import type { Actor } from '../core/item.ts';
import { GATHER_MS } from '../core/notify/planner.ts';
import { openProjects } from './hub.ts';
import { formatCode } from './lan.ts';
import type { PushSender } from './push.ts';
import { createServer, type OteaServer } from './server.ts';
import { memoryProject, TOKEN } from './testing.ts';

// A phone is paired with the computer and turns notifications on from one project's page, once.
// It is told about every project the server serves, including one nobody has opened since the
// phone subscribed (field study 5: the second project never reached a real phone).

const claude: Actor = { kind: 'agent', name: 'claude' };
const T0 = Date.parse('2026-11-14T10:00:00.000Z');

function named(id: string, name: string): Project {
  const project = { ...memoryProject(), identity: { id, name } };
  addCollection(project, { name: 'tasks' });
  return project;
}

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

describe('notifications with several projects', () => {
  let alpha: Project;
  let beta: Project;
  let server: OteaServer;
  let clock: number;
  const sent: { payload: Record<string, unknown> }[] = [];
  const sender: PushSender = {
    async send(_subscription, payload) {
      sent.push({ payload: JSON.parse(payload) });
      return { result: 'sent', status: 201, detail: '' };
    },
  };

  const viaTailscale = (path: string, body: unknown, cookie?: string) => {
    const headers: Record<string, string> = {
      host: TAILNET_HOST,
      'x-forwarded-for': '100.101.102.103',
      'content-type': 'application/json',
      origin: `https://${TAILNET_HOST}`,
    };
    if (cookie) headers.cookie = cookie;
    return Promise.resolve(
      server.app.request(
        path,
        { method: 'POST', headers, body: JSON.stringify(body) },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );
  };

  beforeEach(() => {
    alpha = named('alpha-aaaaaa', 'alpha');
    beta = named('beta-bbbbbb', 'beta');
    clock = T0;
    sent.length = 0;
    server = createServer(openProjects(alpha, beta), {
      token: TOKEN,
      tailscale: fakeTailscale(),
      now: () => clock,
      notify: { sender, tickMs: 20, minuteOfDay: () => 12 * 60 },
    });
    choosePhoneTransport(server.machine, { transport: 'tailscale', tailscaleHost: TAILNET_HOST });
  });

  afterEach(() => {
    server.close();
    alpha.db.close();
    beta.db.close();
  });

  it('tells the phone what reaches its review in a project other than the one it subscribed from', async () => {
    const code = formatCode(server.phone.codes.issue().code);
    const paired = await viaTailscale('/api/pair', { code, name: 'Pixel · Chrome' });
    const cookie = /otea_device_4400=[^;]+/.exec(paired.headers.get('set-cookie') ?? '')?.[0];
    const subscribed = await viaTailscale(
      '/p/alpha-aaaaaa/api/notify/subscribe',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1', keys: browserKeys(), lang: 'es' },
      cookie,
    );
    expect(subscribed.status).toBe(201);

    const at = () => new Date(clock).toISOString();
    const id = createItem(
      beta,
      {
        collection: 'tasks',
        title: 'Ship the footer',
        fields: { description: 'Now' },
        actor: claude,
      },
      at,
    ).id;
    claimItem(beta, { id, actor: claude }, at);
    moveItem(beta, { id, to: 'in_progress', actor: claude, channel: 'cli' }, at);
    moveItem(beta, { id, to: 'review', actor: claude, channel: 'cli' }, at);
    await new Promise((resolve) => setTimeout(resolve, 100));
    clock += GATHER_MS + 1000;

    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 3000 });
    expect(sent[0]?.payload).toMatchObject({ item: id, url: `/p/beta-bbbbbb/#/i/${id}` });
  });
});
