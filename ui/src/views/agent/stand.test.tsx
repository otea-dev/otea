import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ago, item, NOW } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { Agent } from '../../presence.ts';
import { agentRows } from '../../shell/topbar-model.ts';
import { Stand } from './AgentSheet.tsx';

afterEach(() => setLanguage('en'));

const stuck = item({
  id: 'CRE-44',
  title: 'Tortuga musgosa',
  turn: 'agent',
  expiredLease: { holder: 'Kiln', expiresAt: ago(12) },
});

const kiln = (o: Partial<Agent>): Agent => ({
  name: 'Kiln',
  harness: null,
  holding: [],
  lastSeen: ago(0.5),
  live: true,
  profile: { harness: 'claude-code', model: 'opus', effort: 'high', family: 'opus' },
  ...o,
});

const stand = (presence: Agent) => {
  const row = agentRows([presence], [stuck], NOW).find((r) => r.name === presence.name);
  return renderToStaticMarkup(<Stand row={row} presence={presence} now={NOW} />);
};

// Review of #605: a connected agent whose lease ran out may still be at work on the item (the claim
// of it is refused while its session runs), so its sheet never says it is free or has no signal.
describe('what the agent sheet says of an agent whose lease ran out', () => {
  it('says a connected one may still be at work, never that it is free', () => {
    setLanguage('es');
    const html = stand(kiln({ status: 'connected' }));
    expect(html).toMatch(
      /^Conectado: su reserva de <em>Tortuga musgosa<\/em> venció a las \d\d:\d\d, pero puede seguir en ello\.$/,
    );
    expect(html).not.toMatch(/libre|sin señal/i);
    setLanguage('en');
    expect(stand(kiln({ status: 'connected' }))).toContain('may still be at work on it');
  });

  it('says no signal only of one that is not connected', () => {
    setLanguage('es');
    const html = stand(kiln({ status: 'away', live: false, lastSeen: ago(12) }));
    expect(html).toContain('Sin señal desde las');
    expect(html).toContain('<em>Tortuga musgosa</em>');
    expect(html).not.toContain('Conectado');
  });
});
