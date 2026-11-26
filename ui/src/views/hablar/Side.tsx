import { useApp } from '../../app/context.tsx';
import type { Card, Chip, Filter } from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { AgentMark, Seg } from '../../kit/index.ts';
import { NodeGlyph } from '../../lanes/NodeGlyph.tsx';
import { noteTime } from '../detail/notes.ts';
import { Bandeja, type BandejaProps } from './Bandeja.tsx';

// «Lo que salió»: what the conversation produced, a card each. A request lists its items with how
// each stands (and says «te pregunta» when an agent waits for your answer); a consultation shows
// the question and its answer in a line. A card takes you back to its moment in the conversation.

function Kid({ chip }: { chip: Chip }) {
  const app = useApp();
  const body = (
    <>
      {chip.look ? (
        <NodeGlyph look={chip.look} size={14} />
      ) : (
        <i className="hb-draft" aria-hidden="true" />
      )}
      <span className="hb-id">{chip.id}</span>
      {chip.title ? (
        <span className="hb-kt" data-tip={chip.title}>
          {chip.title}
        </span>
      ) : null}
      <span className="hb-kst" data-state={chip.state}>
        {chip.agent ? <AgentMark name={chip.agent} decorative /> : null}
        {t(chip.state)}
      </span>
    </>
  );
  return chip.look ? (
    <button type="button" className="hb-kid" onClick={() => app.openItem(chip.id)}>
      {body}
    </button>
  ) : (
    <div className="hb-kid">{body}</div>
  );
}

function CardView({ card, now, onGo }: { card: Card; now: number; onGo: (root: number) => void }) {
  return (
    <article className="hb-card" data-kind={card.kind} data-asks={card.asks || undefined}>
      <div className="hb-meta">
        <span className="hb-kind static" data-kind={card.kind}>
          {t(`hablar.kind.${card.kind}`)}
        </span>
        <time dateTime={card.at}>{noteTime(card.at, now)}</time>
      </div>
      <button
        type="button"
        className="hb-ct"
        aria-label={`${t('hablar.out.go')}: ${card.title}`}
        onClick={() => onGo(card.root)}
      >
        {card.title}
      </button>
      {card.answer ? <p className="hb-ans">{card.answer}</p> : null}
      {card.taking ? <p className="hb-taking">{t('hablar.out.taking')}</p> : null}
      {card.chips.length > 0 ? (
        <div className="hb-kids">
          {card.chips.map((chip) => (
            <Kid key={chip.id} chip={chip} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function Side({
  cards,
  counts,
  filter,
  onFilter,
  onGo,
  now,
  bandeja,
}: {
  cards: readonly Card[];
  counts: Record<Filter, number>;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  onGo: (root: number) => void;
  now: number;
  // The Bandeja's notes as the page read them, and the one lit by a link.
  bandeja: BandejaProps;
}) {
  return (
    <div className="hb-out">
      <h2 className="hb-h">{t('hablar.out')}</h2>
      <p className="hb-hdek">{t('hablar.out.dek')}</p>
      <Bandeja {...bandeja} />
      <Seg
        className="hb-filter"
        label={t('hablar.filter')}
        value={filter}
        onChange={onFilter}
        options={(['all', 'request', 'consultation'] as const).map((value) => ({
          value,
          label: (
            <>
              {t(`hablar.filter.${value}`)}
              <small>{counts[value]}</small>
            </>
          ),
        }))}
      />
      {cards.length === 0 ? (
        <p className="hb-none">{t(filter === 'all' ? 'hablar.out.empty' : 'hablar.out.none')}</p>
      ) : (
        <div className="hb-cards">
          {cards.map((card) => (
            <CardView key={card.root} card={card} now={now} onGo={onGo} />
          ))}
        </div>
      )}
    </div>
  );
}
