import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerBandeja, askOnBandeja, captureToBandeja, takeBandeja } from '../app/bandeja.ts';
import { BETWEEN_ITEMS_MS } from '../app/board-workers.ts';
import { addCollection } from '../app/collections.ts';
import { postPersonMessage, readAsSecretary, sayAsSecretary } from '../app/conversation.ts';
import { createItem, moveItem } from '../app/items.ts';
import { claimItem, releaseItem } from '../app/leases.ts';
import { listTargets } from '../app/notify-targets.ts';
import { choosePhoneTransport } from '../app/phone.ts';
import { listAgents, seeAgent, waitBeat } from '../app/presence.ts';
import type { Project } from '../app/project.ts';
import { declareSecretary } from '../app/secretary.ts';
import { fakeTailscale, TAILNET_HOST } from '../app/tailscale-testing.ts';
import { LISTEN_WINDOW_MS } from '../core/agent-status.ts';
import type { Actor } from '../core/item.ts';
import { DEFAULT_PREFS, GATHER_MS, ITEM_COOLDOWN_MS, SPACING_MS } from '../core/notify/planner.ts';
import { UNHEARD_GRACE_MS } from '../core/notify/signals.ts';
import { formatCode } from './lan.ts';
import type { PushOutcome, PushSender, PushSubscriptionKeys } from './push.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// Notifications as the server runs them: the subscription API, who is told what and when, and
// what happens to subscriptions that go away. The push itself is a fake sender; push.test.ts
// covers the real one.

const claude: Actor = { kind: 'agent', name: 'claude' };
const PHONE_ON_TAILNET = '100.101.102.103';
const T0 = Date.parse('2026-11-14T10:00:00.000Z');

type Call = { method?: string; body?: unknown; cookie?: string | undefined; origin?: string };

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

describe('notifications on the server', () => {
  let project: Project;
  let server: OteaServer;
  let clock: number;
  let answer: PushOutcome;
  const logged: string[] = [];
  const sent: { subscription: PushSubscriptionKeys; payload: Record<string, unknown> }[] = [];
  const sender: PushSender = {
    async send(subscription, payload) {
      sent.push({ subscription, payload: JSON.parse(payload) });
      return answer;
    },
  };

  const viaTailscale = (path: string, call: Call = {}) => {
    const { method = 'GET', body, cookie, origin = `https://${TAILNET_HOST}` } = call;
    const headers: Record<string, string> = {
      host: TAILNET_HOST,
      'x-forwarded-for': PHONE_ON_TAILNET,
    };
    if (cookie !== undefined) headers.cookie = cookie;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.origin = origin;
    }
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return Promise.resolve(
      server.app.request(path, init, { incoming: { socket: { remoteAddress: '127.0.0.1' } } }),
    );
  };
  const desk = (path: string, call: Call = {}) => {
    const { method = 'GET', body, cookie = SESSION_COOKIE } = call;
    const headers: Record<string, string> = { host: LOCAL_HOST };
    if (cookie !== undefined) headers.cookie = cookie;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers.origin = `http://${LOCAL_HOST}`;
    }
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    return Promise.resolve(server.app.request(path, init));
  };
  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code;
  const pair = async () => {
    const code = formatCode(server.phone.codes.issue().code);
    const response = await viaTailscale('/api/pair', {
      method: 'POST',
      body: { code, name: 'Pixel · Chrome' },
    });
    const cookie = /otea_device_4400=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0];
    const { device } = (await response.json()) as { device: { id: string } };
    return { cookie, device: device.id };
  };
  const endpoint = (n = 1) => `https://fcm.googleapis.com/fcm/send/phone-${n}`;
  const subscribe = (cookie: string | undefined, n = 1) =>
    viaTailscale('/p/memory-aaaaaa/api/notify/subscribe', {
      method: 'POST',
      cookie,
      body: { endpoint: endpoint(n), keys: browserKeys(), lang: 'es' },
    });
  const at = () => new Date(clock).toISOString();
  const toReview = (id: string) => {
    claimItem(project, { id, actor: claude }, at);
    moveItem(project, { id, to: 'in_progress', actor: claude, channel: 'cli' }, at);
    moveItem(project, { id, to: 'review', actor: claude, channel: 'cli' }, at);
  };
  const newTask = (title: string) =>
    createItem(
      project,
      { collection: 'tasks', title, fields: { description: 'Now' }, actor: claude },
      at,
    ).id;
  // A moment passes and the server looks again.
  const pass = async (ms: number) => {
    clock += ms;
    server.notifierOf(project.identity.id)?.scan();
    await server.notifierOf(project.identity.id)?.settled();
  };

  beforeEach(() => {
    project = memoryProject();
    addCollection(project, { name: 'tasks' });
    clock = T0;
    answer = { result: 'sent', status: 201, detail: '' };
    sent.length = 0;
    logged.length = 0;
    server = createServer(project, {
      token: TOKEN,
      tailscale: fakeTailscale(),
      now: () => clock,
      notify: {
        sender,
        tickMs: 60 * 60_000,
        minuteOfDay: () => 12 * 60,
        log: (line) => logged.push(line),
      },
    });
    choosePhoneTransport(server.machine, { transport: 'tailscale', tailscaleHost: TAILNET_HOST });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  describe('the subscription API', () => {
    it('gives a paired phone on HTTPS the key to subscribe with, and its defaults', async () => {
      const { cookie } = await pair();
      const view = await (await viaTailscale('/p/memory-aaaaaa/api/notify', { cookie })).json();
      expect(view).toEqual({
        target: 'device',
        key: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
        subscribed: false,
        lost: false,
        prefs: {
          turn: true,
          ask: true,
          replied: true,
          stuck: true,
          aside: false,
          unheard: true,
          secretary_reply: true,
          secretary_offline: true,
          askText: true,
          quiet: null,
          muted: [],
        },
      });
    });

    it('subscribes the phone, and unsubscribes it', async () => {
      const { cookie, device } = await pair();
      const subscribed = await subscribe(cookie);
      expect(subscribed.status).toBe(201);
      expect(await subscribed.json()).toMatchObject({ subscribed: true });
      expect(listTargets(server.machine)).toEqual([
        expect.objectContaining({
          device,
          lang: 'es',
          push: expect.objectContaining({ endpoint: endpoint() }),
        }),
      ]);

      const left = await viaTailscale('/p/memory-aaaaaa/api/notify/unsubscribe', {
        method: 'POST',
        cookie,
        body: {},
      });
      expect(await left.json()).toMatchObject({ subscribed: false });
      expect(listTargets(server.machine)).toEqual([]);
    });

    it('refuses an endpoint that is not a browser’s push service, and keys that do not read', async () => {
      const { cookie } = await pair();
      const local = await viaTailscale('/p/memory-aaaaaa/api/notify/subscribe', {
        method: 'POST',
        cookie,
        body: { endpoint: 'https://192.168.1.20/hook', keys: browserKeys(), lang: 'es' },
      });
      expect(local.status).toBe(400);
      const bad = await viaTailscale('/p/memory-aaaaaa/api/notify/subscribe', {
        method: 'POST',
        cookie,
        body: { endpoint: endpoint(), keys: { p256dh: 'AAAA', auth: 'AAAA' }, lang: 'es' },
      });
      expect(bad.status).toBe(400);
      expect(listTargets(server.machine)).toEqual([]);
    });

    it('refuses a subscription from another origin or from a device not paired', async () => {
      const { cookie } = await pair();
      const cross = await viaTailscale('/p/memory-aaaaaa/api/notify/subscribe', {
        method: 'POST',
        cookie,
        origin: 'https://evil.example',
        body: { endpoint: endpoint(), keys: browserKeys(), lang: 'es' },
      });
      expect(cross.status).toBe(403);
      expect((await subscribe(undefined)).status).toBe(401);
    });

    it('keeps the kinds and the quiet hours the phone chose', async () => {
      const { cookie } = await pair();
      await subscribe(cookie);
      const prefs = {
        ...DEFAULT_PREFS,
        replied: false,
        aside: true,
        quiet: { from: '23:00', to: '07:00' },
        muted: ['other-bbbbbb'],
      };
      const saved = await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs, lang: 'en' },
      });
      expect(await saved.json()).toMatchObject({ prefs });
      const wrong = await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs: { ...prefs, quiet: { from: '25:00', to: '07:00' } }, lang: 'en' },
      });
      expect(wrong.status).toBe(400);
      const { muted: _, ...unmuted } = prefs;
      const partial = await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs: unmuted, lang: 'en' },
      });
      expect(partial.status).toBe(400);
    });

    it('shows the desk what each paired device is told, or that it is told nothing', async () => {
      const { cookie, device } = await pair();
      const quiet = await pair();
      await subscribe(cookie);
      await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs: { ...DEFAULT_PREFS, stuck: false, muted: ['other-bbbbbb'] }, lang: 'es' },
      });

      const lan = (await (await desk('/p/memory-aaaaaa/api/lan')).json()) as {
        devices: { id: string; notify: unknown }[];
      };

      expect(lan.devices.find(({ id }) => id === device)?.notify).toEqual({
        ...DEFAULT_PREFS,
        stuck: false,
        muted: ['other-bbbbbb'],
      });
      expect(lan.devices.find(({ id }) => id === quiet.device)?.notify).toBeNull();
    });

    // TS-3: a subscription dropped without the phone choosing it (its push service said gone, or the
    // phone found it lost) is remembered, so the phone says it stopped getting them, with its choices.
    it('tells the phone its subscription was lost, until it turns them on again or off', async () => {
      const { cookie, device } = await pair();
      await subscribe(cookie);
      const prefs = { ...DEFAULT_PREFS, stuck: false };
      await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs, lang: 'es' },
      });
      const notify = async () =>
        (await viaTailscale('/p/memory-aaaaaa/api/notify', { cookie })).json();
      const lan = async () =>
        (
          (await (await desk('/p/memory-aaaaaa/api/lan')).json()) as {
            devices: { id: string; notify: unknown }[];
          }
        ).devices.find(({ id }) => id === device)?.notify;

      answer = { result: 'gone', status: 410, detail: '' };
      await desk(`/api/devices/${device}/test-push`, { method: 'POST', body: {} });
      expect(await notify()).toMatchObject({ subscribed: false, lost: true, prefs });
      expect(listTargets(server.machine)).toEqual([]);
      expect(await lan()).toBeNull();

      answer = { result: 'sent', status: 201, detail: '' };
      expect(await (await subscribe(cookie, 2)).json()).toMatchObject({
        subscribed: true,
        lost: false,
        prefs,
      });

      const reported = await viaTailscale('/p/memory-aaaaaa/api/notify/lost', {
        method: 'POST',
        cookie,
        body: {},
      });
      expect(await reported.json()).toMatchObject({ subscribed: false, lost: true, prefs });
      expect(listTargets(server.machine)).toEqual([]);

      const off = await viaTailscale('/p/memory-aaaaaa/api/notify/unsubscribe', {
        method: 'POST',
        cookie,
        body: {},
      });
      expect(await off.json()).toMatchObject({ subscribed: false, lost: false });
    });

    it('unsubscribes a phone when it is unpaired', async () => {
      const { cookie, device } = await pair();
      await subscribe(cookie);
      const revoked = await desk(`/p/memory-aaaaaa/api/devices/${device}/revoke`, {
        method: 'POST',
        body: {},
      });
      expect(revoked.status).toBe(200);
      expect(listTargets(server.machine)).toEqual([]);
    });

    it('keeps the desktop app’s prefs for this computer’s signed-in browser only', async () => {
      expect(await (await desk('/p/memory-aaaaaa/api/notify')).json()).toMatchObject({
        target: 'desktop',
        key: null,
      });
      const prefs = { ...DEFAULT_PREFS, stuck: false };
      const saved = await desk('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        body: { prefs, lang: 'es' },
      });
      expect(await saved.json()).toMatchObject({ target: 'desktop', prefs });
      const unsigned = await desk('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie: '',
        body: { prefs, lang: 'es' },
      });
      expect(unsigned.status).toBe(401);
    });

    it('lets only this computer listen to the desktop app’s notices', async () => {
      const { cookie } = await pair();
      expect((await viaTailscale('/p/memory-aaaaaa/api/notify/stream', { cookie })).status).toBe(
        403,
      );
    });
  });

  describe('on the local network’s plain HTTP', () => {
    it('gives no key and says notifications need HTTPS', async () => {
      server.close();
      server = createServer(project, {
        token: TOKEN,
        lan: { addresses: ['192.168.1.20'] },
        notify: { sender },
      });
      const lan = (path: string, call: Call = {}) => {
        const headers: Record<string, string> = { host: '192.168.1.20:4400' };
        if (call.cookie) headers.cookie = call.cookie;
        if (call.body !== undefined) {
          headers['content-type'] = 'application/json';
          headers.origin = 'http://192.168.1.20:4400';
        }
        const init = {
          method: call.method ?? 'GET',
          headers,
          ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
        };
        return Promise.resolve(
          server.app.request(path, init, {
            incoming: { socket: { remoteAddress: '192.168.1.30' } },
          }),
        );
      };
      const code = formatCode(server.phone.codes.issue().code);
      const paired = await lan('/api/pair', { method: 'POST', body: { code, name: 'Phone' } });
      const cookie = /otea_device_4400=[^;]+/.exec(paired.headers.get('set-cookie') ?? '')?.[0];

      expect(await (await lan('/p/memory-aaaaaa/api/notify', { cookie })).json()).toMatchObject({
        key: null,
      });
      const refused = await lan('/p/memory-aaaaaa/api/notify/subscribe', {
        method: 'POST',
        cookie,
        body: { endpoint: endpoint(), keys: browserKeys(), lang: 'es' },
      });
      expect(refused.status).toBe(409);
      expect(await errorOf(refused)).toBe('push_needs_https');
    });
  });

  describe('who is told what', () => {
    let first: string;

    beforeEach(async () => {
      first = newTask('Ship the login');
      const { cookie } = await pair();
      await subscribe(cookie);
    });

    // G1: one source that throws used to end the whole look, silently.
    it('still tells what an item needs when the Bandeja’s source throws, and logs it', async () => {
      project.db.exec('DROP TABLE bandeja_questions');
      project.db.exec('DROP TABLE bandeja_attachments');
      project.db.exec('DROP TABLE bandeja_entries');

      toReview(first);
      await pass(1000);
      await pass(GATHER_MS);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.payload).toMatchObject({ item: first });
      expect(logged.some((line) => /Bandeja/.test(line))).toBe(true);
    });

    it('pushes to the phone when something becomes yours, after a moment, once', async () => {
      toReview(first);
      await pass(1000);
      expect(sent).toEqual([]);
      await pass(GATHER_MS);
      expect(sent).toEqual([
        {
          subscription: expect.objectContaining({ endpoint: endpoint() }),
          payload: {
            title: 'memory · Te toca',
            body: `${first} · Ship the login`,
            tag: `otea-item-memory-aaaaaa-${first}`,
            url: `/p/memory-aaaaaa/#/i/${first}`,
            item: first,
          },
        },
      ]);
      await pass(GATHER_MS);
      expect(sent).toHaveLength(1);
    });

    it('tells nothing of what was already yours when the phone subscribed', async () => {
      server.close();
      toReview(first);
      server = createServer(project, {
        token: TOKEN,
        tailscale: fakeTailscale(),
        now: () => clock,
        notify: { sender, tickMs: 60 * 60_000 },
      });
      await pass(GATHER_MS);
      await pass(GATHER_MS);
      expect(sent).toEqual([]);
    });

    it('says an item got stuck when its agent goes quiet with the lease', async () => {
      claimItem(project, { id: first, actor: { kind: 'agent', name: 'codex' }, ttlMs: 60_000 }, at);
      await pass(1000);
      await pass(60_000);
      await pass(GATHER_MS);
      expect(sent.map(({ payload }) => payload.title)).toEqual([
        'memory · Se atascó · codex no responde',
      ]);
    });

    it('leaves out a kind the phone turned off', async () => {
      const { cookie } = await pair();
      await subscribe(cookie, 2);
      await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs: { ...DEFAULT_PREFS, turn: false }, lang: 'es' },
      });
      toReview(first);
      await pass(1000);
      await pass(GATHER_MS);
      expect(sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint(1)]);
    });

    const choose = (cookie: string | undefined, prefs: Partial<typeof DEFAULT_PREFS>) =>
      viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs: { ...DEFAULT_PREFS, ...prefs }, lang: 'es' },
      });

    it('tells nothing from a project the phone muted', async () => {
      const { cookie } = await pair();
      await subscribe(cookie, 2);
      await choose(cookie, { muted: ['memory-aaaaaa'] });
      toReview(first);
      await pass(1000);
      await pass(GATHER_MS);
      expect(sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint(1)]);
    });

    it('tells that an agent set an item aside only to a phone that asked for it', async () => {
      const { cookie } = await pair();
      await subscribe(cookie, 2);
      await choose(cookie, { aside: true });
      claimItem(project, { id: first, actor: claude }, at);
      await pass(1000);
      releaseItem(project, { id: first, actor: claude, later: true }, at);
      await pass(1000);
      await pass(GATHER_MS);
      expect(sent).toEqual([
        expect.objectContaining({
          subscription: expect.objectContaining({ endpoint: endpoint(2) }),
          payload: expect.objectContaining({ title: 'memory · claude lo dejó para después' }),
        }),
      ]);
    });

    describe('a question on a Bandeja note', () => {
      const stamp = () => new Date(clock).toISOString();
      const ask = () => {
        const { entry } = captureToBandeja(
          project,
          { text: 'El botón Aprobar queda tapado en el celu' },
          stamp,
        );
        takeBandeja(project, { id: entry.id, agent: 'lia' }, stamp);
        askOnBandeja(
          project,
          {
            id: entry.id,
            agent: 'lia',
            text: '¿Solo Aprobar o todas las acciones fijas?',
            options: ['Solo Aprobar', 'Todas'],
          },
          stamp,
        );
        return entry.id;
      };

      it('tells the person like an item’s question, with its options, and opens Hablar at the note', async () => {
        await pass(1000);
        ask();
        await pass(1000);
        await pass(GATHER_MS);
        expect(sent).toEqual([
          {
            subscription: expect.objectContaining({ endpoint: endpoint() }),
            payload: {
              title: 'memory · lia te pregunta · B-1',
              body: '¿Solo Aprobar o todas las acciones fijas?\n1) Solo Aprobar  2) Todas',
              tag: 'otea-bandeja-memory-aaaaaa-B-1',
              url: '/p/memory-aaaaaa/#/hablar/B-1',
              item: null,
            },
          },
        ]);
        // Told once; answered, it is gone and nothing more is said.
        await pass(ITEM_COOLDOWN_MS * 2);
        await pass(GATHER_MS);
        expect(sent).toHaveLength(1);
      });

      // G1 review: two failed looks in a row must not make the question new when it reads again.
      it('does not tell it again when its source failed twice and then read again', async () => {
        await pass(1000);
        ask();
        await pass(1000);
        await pass(GATHER_MS);
        expect(sent).toHaveLength(1);

        project.db.exec('ALTER TABLE bandeja_entries RENAME TO bandeja_entries_away');
        await pass(1000);
        await pass(1000);
        project.db.exec('ALTER TABLE bandeja_entries_away RENAME TO bandeja_entries');
        await pass(ITEM_COOLDOWN_MS * 2);
        await pass(GATHER_MS);

        expect(sent).toHaveLength(1);
      });

      it('respects the phone’s ask switch, and keeps the question out when the person hid the text', async () => {
        const { cookie } = await pair();
        await subscribe(cookie, 2);
        await choose(cookie, { ask: false });
        const second = await pair();
        await subscribe(second.cookie, 3);
        await choose(second.cookie, { askText: false });
        await pass(1000);
        ask();
        await pass(1000);
        await pass(GATHER_MS);

        const by = (n: number) =>
          sent.find(({ subscription }) => subscription.endpoint === endpoint(n));
        expect(by(2)).toBeUndefined();
        expect(by(1)?.payload.title).toBe('memory · lia te pregunta · B-1');
        expect(by(3)?.payload).toMatchObject({
          title: 'memory · lia te pregunta',
          url: '/p/memory-aaaaaa/#/hablar/B-1',
        });
        expect(JSON.stringify(by(3)?.payload)).not.toContain('Solo Aprobar');
      });

      it('tells nothing for a note that is only waiting, or already answered', async () => {
        await pass(1000);
        const id = ask();
        await pass(1000);
        await pass(GATHER_MS);
        const tag = sent[0]?.payload.tag;
        sent.length = 0;
        answerBandeja(project, { id, option: 1 }, stamp);
        await pass(1000);
        await pass(GATHER_MS);
        captureToBandeja(project, { text: 'another one' }, stamp);
        await pass(1000);
        await pass(GATHER_MS);
        // The answered question's notice is closed on the phone; nothing else is told.
        expect(sent.map(({ payload }) => payload)).toEqual([{ close: tag }]);
      });
    });

    describe('the secretary', () => {
      const stamp = () => new Date(clock).toISOString();
      const hear = () => seeAgent(project.db, { agent: 'sage', channel: 'cli' }, stamp);
      const person = (text: string) => postPersonMessage(project, { text }, stamp).message;
      const say = (text: string, replyTo: number) =>
        sayAsSecretary(project, { agent: 'sage', text, replyTo }, stamp).message;
      // The first look of a server that watches is its starting point: the secretary is there
      // before the phone looks, and what follows is news.
      const watching = async () => {
        declareSecretary(project.db, 'sage', stamp);
        hear();
        await pass(1000);
      };

      it('tells a reply once, with its first line, and opens Hablar at that turn', async () => {
        await watching();
        const asked = person('¿Cómo va CAM-12?');
        const reply = say('Va bien, lo reviso hoy.\nY mañana el resto.', asked.id);
        expect(reply.root).toBe(asked.id);
        await pass(1000);
        expect(sent).toEqual([]);
        await pass(GATHER_MS);
        expect(sent).toEqual([
          {
            subscription: expect.objectContaining({ endpoint: endpoint() }),
            payload: {
              title: 'memory · sage te respondió',
              body: 'Va bien, lo reviso hoy.',
              tag: `otea-hablar-reply-memory-aaaaaa-${asked.id}`,
              url: `/p/memory-aaaaaa/#/hablar/${asked.id}`,
              item: null,
            },
          },
        ]);
        await pass(GATHER_MS);
        await pass(SPACING_MS);
        expect(sent).toHaveLength(1);
      });

      // G1 (SPEC decision 7: an agent's question pushes): the secretary asking with options to tap
      // is a question the person must answer; its news and plain notices are not pushed.
      it('tells a question of its own with options, once, opening Hablar at it; its plain notices stay quiet', async () => {
        await watching();
        sayAsSecretary(project, { agent: 'sage', text: 'CAM-12 is ready for review.' }, stamp);
        await pass(1000);
        await pass(GATHER_MS);
        expect(sent).toEqual([]);

        const asked = sayAsSecretary(
          project,
          { agent: 'sage', text: 'Ship it today?', options: ['Yes', 'Wait'] },
          stamp,
        ).message;
        await pass(1000);
        await pass(GATHER_MS);

        expect(sent).toEqual([
          {
            subscription: expect.objectContaining({ endpoint: endpoint() }),
            payload: {
              title: 'memory · sage te pregunta',
              body: 'Ship it today?\n1) Yes  2) Wait',
              tag: `otea-hablar-ask-memory-aaaaaa-${asked.root}`,
              url: `/p/memory-aaaaaa/#/hablar/${asked.root}`,
              item: null,
            },
          },
        ]);
        await pass(GATHER_MS);
        await pass(SPACING_MS);
        expect(sent).toHaveLength(1);
      });

      it('keeps the reply out of the notice when the person hid the text', async () => {
        const { cookie } = await pair();
        await subscribe(cookie, 2);
        await choose(cookie, { askText: false });
        await watching();
        say('Esto es privado', person('hola').id);
        await pass(1000);
        await pass(GATHER_MS);
        const hidden = sent.find(({ subscription }) => subscription.endpoint === endpoint(2));
        const shown = sent.find(({ subscription }) => subscription.endpoint === endpoint(1));
        expect(shown?.payload.body).toBe('Esto es privado');
        expect(hidden?.payload.title).toBe('memory · sage te respondió');
        expect(JSON.stringify(hidden?.payload)).not.toContain('privado');
      });

      it('says nothing of a reply to a phone that turned replies off', async () => {
        const { cookie } = await pair();
        await subscribe(cookie, 2);
        await choose(cookie, { secretary_reply: false });
        await watching();
        say('Listo', person('hola').id);
        await pass(1000);
        await pass(GATHER_MS);
        expect(sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint(1)]);
      });

      // Field study 7: «5 cosas te esperan» while `otea pending` said 3.
      it('counts a mixed burst as pending does: what waits, with the secretary’s replies named apart', async () => {
        await watching();
        toReview(first);
        toReview(newTask('Two'));
        toReview(newTask('Three'));
        say('Bien.', person('¿Cómo va?').id);
        say('Y además esto.', person('¿Y lo otro?').id);
        await pass(1000);
        await pass(GATHER_MS);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.payload.title).toBe(
          '3 cosas te esperan y 2 respuestas de tu secretario en memory',
        );
      });

      describe('a notice that stops being true', () => {
        const approve = (id: string) =>
          moveItem(
            project,
            { id, to: 'done', actor: { kind: 'human', name: 'ana' }, channel: 'ui' },
            at,
          );

        it('is closed on the phone once the item left review, with no visible notice of its own', async () => {
          await watching();
          toReview(first);
          await pass(1000);
          await pass(GATHER_MS);
          expect(sent).toHaveLength(1);
          const tag = sent[0]?.payload.tag;
          approve(first);
          await pass(1000);
          expect(sent).toHaveLength(2);
          expect(sent[1]).toEqual({
            subscription: expect.objectContaining({ endpoint: endpoint() }),
            payload: { close: tag },
          });
          await pass(GATHER_MS);
          expect(sent).toHaveLength(2);
        });

        it('replaces the group notice with the count of what still waits, then closes it', async () => {
          await watching();
          const ids = [first, newTask('Two'), newTask('Three')];
          for (const id of ids) toReview(id);
          await pass(1000);
          await pass(GATHER_MS);
          expect(sent).toHaveLength(1);
          const tag = sent[0]?.payload.tag;
          expect(sent[0]?.payload.title).toBe('3 cosas te tocan en memory');

          approve(ids[0] as string);
          await pass(1000);
          expect(sent[1]?.payload).toMatchObject({
            title: '2 cosas te tocan en memory',
            body: 'Two · Three',
            tag,
          });

          approve(ids[1] as string);
          await pass(1000);
          expect(sent[2]?.payload).toMatchObject({
            title: '1 cosa te toca en memory',
            body: 'Three',
            tag,
          });

          approve(ids[2] as string);
          await pass(1000);
          expect(sent[3]?.payload).toEqual({ close: tag });
          expect(sent).toHaveLength(4);
        });
      });

      describe('when it is offline with messages waiting', () => {
        const OFFLINE_AFTER_MS = 31 * 60_000;

        it('tells once, after the threshold, with how many wait', async () => {
          await watching();
          person('uno');
          person('dos');
          await pass(OFFLINE_AFTER_MS);
          await pass(GATHER_MS);
          expect(sent).toEqual([
            expect.objectContaining({
              payload: {
                title: 'memory · Tu secretario está desconectado',
                body: 'Tus 2 mensajes esperan respuesta',
                tag: 'otea-hablar-offline-memory-aaaaaa',
                url: '/p/memory-aaaaaa/#/hablar',
                item: null,
              },
            }),
          ]);
          await pass(ITEM_COOLDOWN_MS * 2);
          await pass(GATHER_MS);
          expect(sent).toHaveLength(1);
        });

        it('tells nothing while the secretary is connected, however long they wait', async () => {
          await watching();
          person('uno');
          for (let i = 0; i < 6; i++) {
            await pass(10 * 60_000);
            hear();
          }
          await pass(GATHER_MS);
          expect(sent).toEqual([]);
        });

        it('tells nothing before the messages have waited the threshold', async () => {
          await watching();
          await pass(OFFLINE_AFTER_MS);
          person('uno');
          await pass(9 * 60_000);
          await pass(GATHER_MS);
          expect(sent).toEqual([]);
          await pass(2 * 60_000);
          await pass(GATHER_MS);
          expect(sent).toHaveLength(1);
        });

        it('tells again only after it came back and went offline with new messages', async () => {
          await watching();
          person('uno');
          await pass(OFFLINE_AFTER_MS);
          await pass(GATHER_MS);
          expect(sent).toHaveLength(1);
          // It returns and reads what waited.
          hear();
          readAsSecretary(project, { agent: 'sage' }, stamp);
          await pass(1000);
          person('dos');
          await pass(OFFLINE_AFTER_MS);
          await pass(GATHER_MS);
          await pass(ITEM_COOLDOWN_MS);
          expect(sent).toHaveLength(2);
        });

        it('says nothing to a phone that turned it off', async () => {
          const { cookie } = await pair();
          await subscribe(cookie, 2);
          await choose(cookie, { secretary_offline: false });
          await watching();
          person('uno');
          await pass(OFFLINE_AFTER_MS);
          await pass(GATHER_MS);
          expect(sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint(1)]);
        });
      });
    });

    describe('when nobody listens', () => {
      const second = () => newTask('Write the docs');
      const listen = () =>
        waitBeat(project.db, { agent: 'claude', channel: 'cli', waiter: process.pid }, () =>
          new Date(clock).toISOString(),
        ).run();

      it('tells that new work waits for an agent and none listens, once', async () => {
        const id = second();
        await pass(1000);
        await pass(UNHEARD_GRACE_MS);
        expect(sent).toEqual([]);
        await pass(GATHER_MS);
        expect(sent).toEqual([
          expect.objectContaining({
            payload: expect.objectContaining({
              title: 'memory · Hay trabajo y ningún agente conectado',
              url: `/p/memory-aaaaaa/#/i/${id}`,
            }),
          }),
        ]);
        await pass(GATHER_MS);
        expect(sent).toHaveLength(1);
      });

      it('says nothing while an agent waits in otea wait', async () => {
        listen();
        second();
        await pass(1000);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent).toEqual([]);
      });

      it('still tells while only the secretary waits: it is no listener on the boards', async () => {
        const stamp = () => new Date(clock).toISOString();
        declareSecretary(project.db, 'sage', stamp);
        waitBeat(project.db, { agent: 'sage', channel: 'cli', waiter: process.pid }, stamp).run();
        expect(listAgents(project.db, stamp).find(({ name }) => name === 'sage')).toMatchObject({
          attending: true,
          waiting: false,
        });
        const id = second();
        await pass(1000);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent).toEqual([
          expect.objectContaining({
            payload: expect.objectContaining({ url: `/p/memory-aaaaaa/#/i/${id}` }),
          }),
        ]);
      });

      it('says nothing of an item heard again within the grace', async () => {
        second();
        await pass(1000);
        await pass(60_000);
        listen();
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent).toEqual([]);
      });

      it('says nothing of what was already waiting when the server began to watch', async () => {
        await pass(1000);
        await pass(3 * UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent).toEqual([]);
      });

      // F2 (field study 3): the worker the secretary launched was busy on one item, the rest of the
      // queue was told as «nobody is listening», and a second worker was launched. A worker at work
      // on the board comes to the next item when its step ends: that is no silence to tell.
      it('says nothing of an item while an agent works another one of the board', async () => {
        const busy = { agent: 'busy', channel: 'cli', call: true } as const;
        const stamp = () => new Date(clock).toISOString();
        seeAgent(project.db, busy, stamp);
        claimItem(project, { id: first, actor: { kind: 'agent', name: 'busy' } }, at);
        expect(listAgents(project.db, stamp).find(({ name }) => name === 'busy')?.status).toBe(
          'working',
        );
        second();
        await pass(1000);
        seeAgent(project.db, busy, stamp);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent).toEqual([]);
      });

      it('tells it once that agent let the item go and went quiet', async () => {
        const busy = { agent: 'busy', channel: 'cli', call: true } as const;
        const stamp = () => new Date(clock).toISOString();
        seeAgent(project.db, busy, stamp);
        claimItem(project, { id: first, actor: { kind: 'agent', name: 'busy' } }, at);
        second();
        await pass(1000);
        releaseItem(project, { id: first, actor: { kind: 'agent', name: 'busy' } }, at);
        // Nothing of it for a long while: it is no worker of the board any more.
        await pass(BETWEEN_ITEMS_MS + LISTEN_WINDOW_MS);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        // Both items wait, and are told as one.
        expect(sent).toHaveLength(1);
      });

      it('does not tell again when a listener lapses and returns within the cooldown', async () => {
        const id = second();
        await pass(1000);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent.filter(({ payload }) => payload.item === id)).toHaveLength(1);
        listen();
        await pass(1000);
        await pass(LISTEN_WINDOW_MS);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        // Still inside the item's cooldown, counted from the first notice (about 131 s in).
        expect(clock - T0).toBeLessThan(131_000 + ITEM_COOLDOWN_MS);
        // (The item that waited before watching began is told once it is unheard anew.)
        expect(sent.filter(({ payload }) => payload.item === id)).toHaveLength(1);
      });

      it('says nothing to a phone that turned that kind off', async () => {
        const { cookie } = await pair();
        await subscribe(cookie, 2);
        await choose(cookie, { unheard: false });
        second();
        await pass(1000);
        await pass(UNHEARD_GRACE_MS);
        await pass(GATHER_MS);
        expect(sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint(1)]);
      });

      it('takes prefs from an older client that does not send the newer ones as on', async () => {
        const { cookie } = await pair();
        await subscribe(cookie, 2);
        const { unheard: _u, askText: _a, ...older } = { ...DEFAULT_PREFS, turn: false };
        const saved = await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
          method: 'POST',
          cookie,
          body: { prefs: older, lang: 'es' },
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toMatchObject({
          prefs: { turn: false, unheard: true, askText: true },
        });
      });
    });

    it('gathers what many agents hand over into one notice now and then, naming the project', async () => {
      toReview(first);
      await pass(1000);
      await pass(GATHER_MS);
      expect(sent).toHaveLength(1);
      for (const title of ['Two', 'Three', 'Four']) {
        toReview(newTask(title));
        await pass(20_000);
      }
      expect(sent).toHaveLength(1);
      await pass(SPACING_MS);
      expect(sent).toHaveLength(2);
      expect(sent[1]?.payload).toMatchObject({
        title: '3 cosas te tocan en memory',
        body: 'Two · Three · Four',
        tag: 'otea-group-memory-aaaaaa',
        url: '/p/memory-aaaaaa/#/',
      });
    });

    it('forgets a subscription the push service says is gone', async () => {
      answer = { result: 'gone', status: 410, detail: '' };
      toReview(first);
      await pass(1000);
      await pass(GATHER_MS);
      expect(sent).toHaveLength(1);
      expect(listTargets(server.machine)).toEqual([]);
    });

    it('logs each push’s outcome with the device id only, never its endpoint, keys or words', async () => {
      const outcomes: [PushOutcome, RegExp][] = [
        [{ result: 'sent', status: 201, detail: '' }, /push to device [0-9a-f]{8}: sent \(201\)/],
        [
          { result: 'failed', status: 403, detail: 'bad key' },
          /push to device [0-9a-f]{8}: refused by the push service \(403\): bad key/,
        ],
        [
          { result: 'failed', status: null, detail: 'fetch failed (ENOTFOUND)' },
          /push to device [0-9a-f]{8}: network error: fetch failed \(ENOTFOUND\)/,
        ],
        [
          { result: 'gone', status: 410, detail: '' },
          /push to device [0-9a-f]{8}: gone \(410\), subscription dropped/,
        ],
      ];
      for (const [outcome, line] of outcomes) {
        answer = outcome;
        logged.length = 0;
        const id = newTask(`Item ${outcome.status}`);
        toReview(id);
        await pass(SPACING_MS);
        await pass(SPACING_MS);
        expect(logged.join('\n')).toMatch(line);
      }
      const all = logged.join('\n');
      expect(all).not.toContain('fcm.googleapis.com');
      expect(all).not.toContain('Item');
    });
  });

  describe('a test push', () => {
    it('sends one push to the phone right away, past the quiet hours and the spacing', async () => {
      const { cookie, device } = await pair();
      await subscribe(cookie);
      const prefs = { ...DEFAULT_PREFS, quiet: { from: '00:00', to: '23:59' } };
      await viaTailscale('/p/memory-aaaaaa/api/notify/prefs', {
        method: 'POST',
        cookie,
        body: { prefs, lang: 'es' },
      });

      const fromPhone = await viaTailscale('/p/memory-aaaaaa/api/notify/test', {
        method: 'POST',
        cookie,
        body: {},
      });
      expect(fromPhone.status).toBe(200);
      expect(await fromPhone.json()).toEqual({ result: 'sent', status: 201, detail: '' });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.payload).toMatchObject({ title: 'Otea · aviso de prueba', url: '/#/' });

      const fromDesk = await desk(`/api/devices/${device}/test-push`, { method: 'POST', body: {} });
      expect(await fromDesk.json()).toEqual({ result: 'sent', status: 201, detail: '' });
      expect(sent).toHaveLength(2);
      expect(logged.join('\n')).toContain(`test push to device ${device}: sent (201)`);
    });

    it('says what the push service answered, and drops a subscription it calls gone', async () => {
      const { cookie, device } = await pair();
      await subscribe(cookie);
      answer = { result: 'failed', status: 403, detail: 'bad key' };
      const refused = await desk(`/api/devices/${device}/test-push`, { method: 'POST', body: {} });
      expect(await refused.json()).toEqual({ result: 'failed', status: 403, detail: 'bad key' });

      answer = { result: 'gone', status: 410, detail: '' };
      await desk(`/api/devices/${device}/test-push`, { method: 'POST', body: {} });
      expect(listTargets(server.machine)).toEqual([]);
    });

    it('says a device without notifications on has nothing to send to', async () => {
      const { cookie, device } = await pair();
      const fromDesk = await desk(`/api/devices/${device}/test-push`, { method: 'POST', body: {} });
      expect(await fromDesk.json()).toEqual({ result: 'off', status: null, detail: '' });
      const fromPhone = await viaTailscale('/p/memory-aaaaaa/api/notify/test', {
        method: 'POST',
        cookie,
        body: {},
      });
      expect(await fromPhone.json()).toMatchObject({ result: 'off' });
      expect(sent).toEqual([]);
      const unknown = await desk('/api/devices/nope/test-push', { method: 'POST', body: {} });
      expect(unknown.status).toBe(404);
    });
  });

  describe('the desktop app', () => {
    it('hears the same notices on its stream, in its language', async () => {
      const id = newTask('Ship the login');
      const response = await desk('/p/memory-aaaaaa/api/notify/stream?lang=en', {
        cookie: undefined,
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const until = async (needle: string) => {
        while (!text.includes(needle)) {
          const chunk = await reader?.read();
          if (!chunk || chunk.done) break;
          text += decoder.decode(chunk.value);
        }
      };
      await until('event: ready');
      toReview(id);
      await pass(1000);
      await pass(GATHER_MS);
      await until('event: notice');
      const data = /event: notice\ndata: (.+)\n/.exec(text)?.[1] ?? '{}';
      expect(JSON.parse(data)).toMatchObject({
        title: 'memory · Your turn',
        url: `/p/memory-aaaaaa/#/i/${id}`,
      });
      await reader?.cancel();
    });
  });
});
