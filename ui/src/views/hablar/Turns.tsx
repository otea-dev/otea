import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AnswerWords } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import type { BandejaEntry } from '../../bandeja.ts';
import { useCopy } from '../../components/AgentPrompt.tsx';
import { CopyGlyph } from '../../components/CopyCommand.tsx';
import {
  asksOf,
  blocksOf,
  branchOf,
  fencesOf,
  type Message,
  type MessageKind,
  otherKind,
  quotedSnippet,
  type Row as RowOf,
  splitReply,
  type TextBlock,
  type Turn,
} from '../../conversation.ts';
import { t } from '../../i18n/i18n.ts';
import { drawIn } from '../../lanes/draw-in.ts';
import { lightMarkup } from '../../lanes/light.ts';
import { NodeGlyph } from '../../lanes/NodeGlyph.tsx';
import { C } from '../../motion/curves.ts';
import { reduced } from '../../motion/reduced.ts';
import type { Item } from '../../types.ts';
import { noteTime } from '../detail/notes.ts';
import { Attachments } from './Attachments.tsx';
import { BandejaAsk } from './Bandeja.tsx';
import { AskBody, AskCard, Branch } from './Branch.tsx';
import { Plain } from './Plain.tsx';
import { SecretaryMark } from './SecretaryMark.tsx';

// The conversation on the two lanes: the secretary's on the left (a ring in its own colour), yours
// on the right (a blue disc). Each turn is what you said, what the secretary answered and, for a
// request, the branch of items that came out of it. The lanes draw with ink when the view opens, a
// new message unfolds from its node, and the secretary's lane carries light while it thinks.

const X_SEC = 16.5;
const X_YOU = 40.5;
// The lanes' names stand over the thread (HablarView: «sec» and «tú» stay in sight as it scrolls),
// so the lanes start at the top of the thread.
const HEAD = 0;

// What was already on the page when it first drew: nothing in it is new. `fresh(key)` says whether a
// message, a reply or a chip arrived since, so only that animates in.
function useFresh(keys: readonly string[]): (key: string) => boolean {
  const known = useRef<Set<string> | null>(null);
  const was = known.current;
  useEffect(() => {
    known.current = new Set(keys);
  });
  return useCallback((key: string) => was !== null && !was.has(key), [was]);
}

// A message comes out of its node: its body unfolds from the lane, the node grows. Reduced motion:
// a 160 ms crossfade in place.
function unfold(body: HTMLElement | null, node: Element | null) {
  if (!body) return;
  if (reduced()) {
    body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: C.drift });
    return;
  }
  body.animate(
    [
      { opacity: 0, transform: 'translateX(-12px) scale(0.97)', filter: 'blur(1px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0px)' },
    ],
    { duration: 480, delay: 140, easing: C.glide, fill: 'backwards' },
  );
  node?.animate(
    [
      { opacity: 0, transform: 'scale(0.3)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 440, easing: C.settle, fill: 'backwards' },
  );
}

function SecNode({ busy }: { busy: boolean }) {
  return (
    <svg
      className="nd secretary"
      width="24"
      height="24"
      viewBox="-12 -12 24 24"
      aria-hidden="true"
      data-busy={busy ? '' : undefined}
    >
      <circle className="ko" r="6" />
      <g className="lk">
        <circle className="trk" r="8.2" fill="none" strokeWidth="1.25" />
        <circle r="4.4" fill="var(--ground)" stroke="var(--sec)" strokeWidth="1.5" />
        <circle
          className="orb"
          r="8.2"
          fill="none"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeDasharray="13.9 51.5"
        />
      </g>
    </svg>
  );
}

type RowProps = {
  lane: 'secretary' | 'you';
  // The body's identity: a new one is a new body (a thinking row becoming the reply).
  bodyKey: string;
  fresh: boolean;
  busy?: boolean;
  // On its way out: it folds away into its node's line, the way it came.
  leaving?: boolean;
  className?: string | undefined;
  children: ReactNode;
};

// A row that goes folds shut over its own height, its words fading first; reduced motion: a 160 ms
// crossfade, then it is gone.
function fold(row: HTMLElement) {
  if (reduced()) {
    row.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      easing: C.drift,
      fill: 'forwards',
    });
    return;
  }
  const height = row.offsetHeight;
  row.style.overflow = 'hidden';
  row.animate(
    [
      { height: `${height}px`, opacity: 1 },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
    ],
    { duration: 460, easing: C.glide, fill: 'forwards' },
  );
}

function Row({
  lane,
  bodyKey,
  fresh,
  busy = false,
  leaving = false,
  className,
  children,
}: RowProps) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (leaving && row.current) fold(row.current);
  }, [leaving]);
  return (
    <div
      ref={row}
      className={['hb-row', lane, className].filter(Boolean).join(' ')}
      style={{ '--x': `${lane === 'secretary' ? X_SEC : X_YOU}px` } as CSSProperties}
    >
      {lane === 'secretary' ? <SecNode busy={busy} /> : <NodeGlyph look="yours" />}
      <Body key={bodyKey} fresh={fresh}>
        {children}
      </Body>
    </div>
  );
}

function Body({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when it first appears
  useLayoutEffect(() => {
    if (fresh) unfold(body.current, body.current?.parentElement?.querySelector('.nd') ?? null);
  }, []);
  return (
    <div className="hb-body" ref={body}>
      {children}
    </div>
  );
}

// What was there a moment ago and is gone now stays a little longer, then goes (`leaving`): the
// question you just answered shows what you answered before it folds away, instead of vanishing
// under your finger.
function useLingering<T extends { id: string }>(
  current: readonly T[],
  stay = 1800,
): { item: T; leaving: boolean }[] {
  const seen = useRef(new Map<string, T>());
  const [gone, setGone] = useState<ReadonlyMap<string, { item: T; leaving: boolean }>>(new Map());
  const ids = current.map((item) => item.id).join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of items changes
  useEffect(() => {
    const now = new Set(current.map((item) => item.id));
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [id, item] of seen.current) {
      if (now.has(id)) continue;
      seen.current.delete(id);
      setGone((was) => new Map(was).set(id, { item, leaving: false }));
      timers.push(
        setTimeout(() => setGone((was) => new Map(was).set(id, { item, leaving: true })), stay),
        setTimeout(
          () =>
            setGone((was) => {
              const next = new Map(was);
              next.delete(id);
              return next;
            }),
          stay + 520,
        ),
      );
    }
    for (const item of current) seen.current.set(item.id, item);
    // A timer is let run to its end: the held item must go even if the page re-renders meanwhile.
    return undefined;
  }, [ids]);
  const live = current.map((item) => ({ item, leaving: false }));
  const held = [...gone.values()].filter(
    ({ item }) => !current.some((each) => each.id === item.id),
  );
  return [...live, ...held];
}

// The kind of a turn, as a label that is also the correction: one tap turns a request into a
// consultation and back.
function KindLabel({
  turn,
  onKind,
}: {
  turn: Turn;
  onKind: (turn: Turn, kind: MessageKind) => void;
}) {
  if (turn.kind === null) return null;
  const kind = turn.kind;
  const other = otherKind(kind);
  const word = (k: MessageKind) => t(`hablar.kind.${k}`);
  return (
    <button
      type="button"
      className="hb-kind"
      data-kind={kind}
      aria-label={t('hablar.kind.fix', {
        kind: word(kind),
        snippet: quotedSnippet(turn.person[0]?.text ?? turn.messages[0]?.text ?? '', 50),
        other: word(other),
      })}
      onClick={() => onKind(turn, other)}
    >
      <span>{word(kind)}</span>
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
        <path d="M2 3.5h6M6.2 1.7 8 3.5 6.2 5.3M8 6.5H2M3.8 4.7 2 6.5l1.8 1.8" />
      </svg>
    </button>
  );
}

function PersonMessage({
  message,
  now,
  extra,
}: {
  message: Message;
  now: number;
  extra?: ReactNode;
}) {
  return (
    <>
      <div className="hb-who">
        <span className="mk you">{t('mark.you')}</span>
        <time dateTime={message.at}>{noteTime(message.at, now)}</time>
        {message.delivery === 'pending' && message.heardAt === null ? (
          <span className="hb-pend">{t('hablar.pending')}</span>
        ) : null}
        {extra}
      </div>
      <div className="hb-mine">
        {message.text === '' ? null : <Plain text={message.text} />}
        <Attachments files={message.attachments} />
      </div>
    </>
  );
}

// What you chose or answered: your own row, «Elegiste: …» (and on which item or note, when it only
// records an answer to an agent's question).
function Chose({ message, now, asked }: { message: Message; now: number; asked: Message | null }) {
  const { choice } = message;
  if (choice === null) return null;
  const words =
    choice.mode === 'delegated'
      ? t('hablar.chose.delegated')
      : t(choice.mode === 'option' ? 'hablar.chose.option' : 'hablar.chose.text', {
          text: message.text,
        });
  return (
    <>
      <div className="hb-who">
        <span className="mk you">{t('mark.you')}</span>
        <time dateTime={message.at}>{noteTime(message.at, now)}</time>
        {message.delivery === 'pending' && message.heardAt === null ? (
          <span className="hb-pend">{t('hablar.pending')}</span>
        ) : null}
      </div>
      <div className="hb-mine hb-chose" data-mode={choice.mode}>
        <Plain text={words} />
        {choice.about === null ? null : (
          <span className="hb-on">
            {t('hablar.chose.on', { about: choice.about })}
            {choice.asked ? ` · «${quotedSnippet(choice.asked, 60)}»` : ''}
          </span>
        )}
        {choice.about === null && asked?.text ? (
          <span className="hb-on">«{quotedSnippet(asked.text, 60)}»</span>
        ) : null}
      </div>
    </>
  );
}

// The secretary's reply: a one-line conclusion in the voice's serif and, under it, the rest; a long
// rest folds behind «ver más» (the secretary's rule is a line, then at most 3 short ones: FOLD_LINES
// and FOLD_CHARS in conversation.ts guard for when it is longer).
function Reply({
  message,
  now,
  head,
  answers,
  onGo,
}: {
  message: Message;
  now: number;
  head: ReactNode;
  // The older message it answers, when it is not the one right above it.
  answers: Message | null;
  onGo: (root: number) => void;
}) {
  // The texts to paste (fenced blocks) are drawn apart and never folded; the words are the reply.
  const parts = useMemo(() => blocksOf(message.text), [message.text]);
  const reply = useMemo(() => splitReply(parts.rest), [parts.rest]);
  const [open, setOpen] = useState(false);
  // Why it is not verified, said in words on a tap (a tooltip cannot be opened on a phone).
  const [why, setWhy] = useState(false);
  const id = `hb-more-${message.id}`;
  return (
    <>
      <div className="hb-who">
        <SecretaryMark />
        <span className="hb-name">
          {message.author === 'secretary' ? t('hablar.secretary') : message.by}
        </span>
        <time dateTime={message.at}>{noteTime(message.at, now)}</time>
        {message.author === 'secretary' && message.unverified ? (
          <button
            type="button"
            className="hb-unverified"
            aria-expanded={why}
            onClick={() => setWhy(!why)}
          >
            {t('hablar.unverified')}
          </button>
        ) : null}
        {head}
      </div>
      {why ? <p className="hb-unverified-why">{t('hablar.unverified.why')}</p> : null}
      {answers === null ? null : (
        <button type="button" className="hb-re" onClick={() => onGo(answers.root)}>
          {t('hablar.re', { snippet: quotedSnippet(answers.text, 60) })}
        </button>
      )}
      {reply.lead === '' ? null : (
        <p className="hb-bluf">
          <Plain text={reply.lead} />
        </p>
      )}
      {reply.rest === '' ? null : reply.folds ? (
        <>
          <div className="hb-fold" data-open={open ? '' : undefined}>
            <div id={id} className="hb-more" aria-hidden={open ? undefined : true} inert={!open}>
              <Prose text={reply.rest} />
            </div>
          </div>
          <button
            type="button"
            className="hb-toggle"
            aria-expanded={open}
            aria-controls={id}
            // The words say «ver más»; the name says of what, since a page has many.
            aria-label={`${open ? t('hablar.less') : t('hablar.more')}: ${reply.lead}`}
            onClick={() => setOpen(!open)}
          >
            {open ? t('hablar.less') : t('hablar.more')}
          </button>
        </>
      ) : (
        <div className="hb-more-open">
          <Prose text={reply.rest} />
        </div>
      )}
      {parts.blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the blocks of a said message never move
        <PasteBlock key={index} block={block} />
      ))}
      <Attachments files={message.attachments} />
    </>
  );
}

// Words and, where the reply fenced some, its code drawn as code.
function Prose({ text }: { text: string }) {
  const parts = useMemo(() => fencesOf(text), [text]);
  if (parts.length === 1 && !parts[0]?.code) return <Plain text={text} />;
  return (
    <>
      {parts.map((part, index) =>
        part.code ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a said message never move
          <pre key={index} className="hb-code">
            {part.text}
          </pre>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a said message never move
          <Plain key={index} text={part.text} />
        ),
      )}
    </>
  );
}

// A text for another session to read, as the secretary pasted it: its caption, the text in a box
// that scrolls on its own, and a button that copies all of it.
function PasteBlock({ block }: { block: TextBlock }) {
  const [copied, copy] = useCopy(block.text);
  return (
    <div className="hb-block">
      <div className="hb-bhead">
        <span className="hb-bn" aria-hidden="true">
          {block.number}
        </span>
        {/* The number is the badge's: «1. Trabajador…» reads «Trabajador…» beside it. */}
        <span className="hb-bcap">{block.caption || t('hablar.block')}</span>
        <button type="button" className="hb-bcopy" onClick={copy}>
          <CopyGlyph />
          {copied ? t('hablar.block.copied') : t('hablar.block.copy')}
        </button>
      </div>
      <pre className="hb-bpre">{block.text}</pre>
    </div>
  );
}

// How long the secretary may hold a message it read before the desk says it has not answered: a
// session that is stuck, or that ended the way a closed laptop does, would otherwise read «pensando…»
// for as long as the person watched (field study 4: ten minutes).
export const SILENT_AFTER_MS = 4 * 60_000;

// When the secretary took the turn's last message of the person's: heard, else read, else said.
function thinkingSince(turns: readonly Turn[], root: number): string {
  const last = turns.find((turn) => turn.root === root)?.messages.at(-1);
  return last?.heardAt ?? last?.readAt ?? last?.at ?? new Date(0).toISOString();
}

function Thinking({
  since,
  now,
  listening,
}: {
  since: string;
  now: number;
  // The secretary is in its wait: it holds nothing, so it is never «pensando…».
  listening: boolean;
}) {
  const silent = listening || now - Date.parse(since) >= SILENT_AFTER_MS;
  return (
    <>
      <div className="hb-who">
        <SecretaryMark />
        <span className="hb-name">{t('hablar.secretary')}</span>
      </div>
      {silent ? (
        <div className="hb-thinking hb-silent" role="status">
          <p>{t('hablar.silent')}</p>
          <p className="hb-silent-do">{t('hablar.silent.do')}</p>
        </div>
      ) : (
        <div className="hb-thinking" role="status">
          <span className="bar" aria-hidden="true" />
          {t('hablar.thinking')}
        </div>
      )}
    </>
  );
}

type EntryProps = {
  row: RowOf;
  items: ReadonlyMap<string, Item>;
  now: number;
  fresh: (key: string) => boolean;
  found: boolean;
  // The first row drawn of its turn: where a link to the turn lands.
  begins: boolean;
  onKind: (turn: Turn, kind: MessageKind) => void;
  onGo: (root: number) => void;
  onAnswer: (message: Message, given: AnswerWords) => Promise<void>;
  onRetract: (message: Message) => Promise<void>;
};

// One message of the thread, where it was said. The turn it belongs to only lends it what it
// shares: the kind label (always on the person's own first message: it is what they said that the
// kind sorts, never what the secretary answered) and the branch of items that came out of it
// (under that first reply).
function Entry({
  row,
  items,
  now,
  fresh,
  found,
  begins,
  onKind,
  onGo,
  onAnswer,
  onRetract,
}: EntryProps) {
  const { message, turn } = row;
  const label = <KindLabel turn={turn} onKind={onKind} />;
  let body: ReactNode;
  if (row.type === 'person') {
    const first = turn.person[0]?.id === message.id;
    body = (
      <Row lane="you" bodyKey={`m${message.id}`} fresh={fresh(`m${message.id}`)}>
        <PersonMessage message={message} now={now} extra={first ? label : null} />
      </Row>
    );
  } else if (row.type === 'choice') {
    body = (
      <Row lane="you" bodyKey={`m${message.id}`} fresh={fresh(`m${message.id}`)}>
        <Chose message={message} now={now} asked={row.asked} />
      </Row>
    );
  } else {
    const chips = row.head ? branchOf(turn, items, now) : [];
    body = (
      <Row
        lane="secretary"
        bodyKey={`r${message.id}`}
        fresh={fresh(`r${message.id}`)}
        className={chips.length > 0 ? 'has-branch' : undefined}
      >
        <Reply message={message} now={now} head={null} answers={row.answers} onGo={onGo} />
        {row.question === 'open' ? (
          <AskBody
            bare
            by={message.by}
            about=""
            text={message.text}
            options={message.options}
            recommended={message.recommended ?? undefined}
            {...(message.action === null
              ? {}
              : {
                  action: {
                    kind: message.action.kind,
                    item: message.action.item,
                    note: message.action.note,
                    to: message.action.to,
                  },
                })}
            optionText={message.optionText}
            retract={() => onRetract(message)}
            send={(given) => onAnswer(message, given)}
          />
        ) : row.question === 'closed' ? (
          <p className="hb-said hb-closed">
            {t(message.closed?.why === 'withdrawn' ? 'hablar.ask.withdrawn' : 'hablar.ask.settled')}
          </p>
        ) : null}
        {row.head ? <Branch chips={chips} fresh={(id) => fresh(`c${turn.root}:${id}`)} /> : null}
      </Row>
    );
  }
  // Each message is an article named by who said it and when, so a screen reader can move from one
  // to the next by heading and says whose words it is on landing.
  const who =
    message.author === 'person'
      ? t('mark.you')
      : message.author === 'secretary'
        ? t('hablar.secretary')
        : message.by;
  const heading = `hb-h-${message.id}`;
  return (
    <article
      className="hb-turn"
      id={begins ? `hb-turn-${turn.root}` : undefined}
      aria-labelledby={heading}
      data-k={`m:${message.id}`}
      data-found={found ? '' : undefined}
    >
      <h2 id={heading} className="visually-hidden">
        {who}, {noteTime(message.at, now)}
      </h2>
      {body}
    </article>
  );
}

// Where the lanes' light and lines go, measured from the nodes on the page.
type Geometry = { H: number; you: number | null; sec: number | null };

function sameGeometry(a: Geometry, b: Geometry): boolean {
  return a.H === b.H && a.you === b.you && a.sec === b.sec;
}

function useGeometry(list: RefObject<HTMLElement | null>): Geometry {
  const [geometry, setGeometry] = useState<Geometry>({ H: 0, you: null, sec: null });
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const centre = (node: Element | undefined) =>
      node ? Math.round(node.getBoundingClientRect().top - top + 12) : null;
    const youNodes = el.querySelectorAll('.hb-row.you > .nd');
    const next: Geometry = {
      H: el.offsetHeight,
      you: centre([...youNodes].at(-1)),
      sec: centre(el.querySelector('.nd.secretary[data-busy]') ?? undefined),
    };
    setGeometry((was) => (sameGeometry(was, next) ? was : next));
  }, [list]);
  useLayoutEffect(measure);
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [list, measure]);
  return geometry;
}

// The secretary's own light on its lane, as the agents' (30 px each way and a small halo), in its
// colour.
function secLight(y: number): string {
  return `<g class="gl" transform="translate(${X_SEC} ${y})"><rect x="-2" y="-30" width="4" height="60" fill="url(#gS)" style="filter:blur(2.4px);opacity:var(--glow-lit)"/><rect x="-.75" y="-30" width="1.5" height="60" fill="url(#gS)"/><circle r="10" opacity=".26" style="filter:blur(4.5px)"/><circle r="6.5" opacity=".32" style="filter:blur(2px)"/></g>`;
}

function LaneInk({ geometry }: { geometry: Geometry }) {
  const { H, you, sec } = geometry;
  const light = useMemo(
    () =>
      lightMarkup({
        H,
        W: 58,
        lastOpen: H,
        fuseAt: H,
        closed: false,
        y0: you,
        y1: you,
        ys: you === null ? [] : [you],
        ws: [],
        as: [],
        atasco: false,
        pinches: [],
      }).halos,
    [H, you],
  );
  return (
    <svg className="ink" width="58" height={Math.max(H, 1)} aria-hidden="true">
      <g className="lines">
        <path
          className="ln lag"
          d={`M${X_SEC} ${HEAD}V${H}`}
          fill="none"
          stroke="var(--lane)"
          strokeWidth="1"
        />
        <path
          className="ln lyou"
          d={`M${X_YOU} ${HEAD}V${H}`}
          fill="none"
          stroke="var(--you)"
          strokeWidth="1"
        />
      </g>
      <g className="glow">
        <g
          className="secs"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the light's markup, built from numbers
          dangerouslySetInnerHTML={{ __html: sec === null ? '' : secLight(sec) }}
        />
        <g
          className="halos"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the light's markup, built from numbers
          dangerouslySetInnerHTML={{ __html: light }}
        />
      </g>
    </svg>
  );
}

export type TurnsProps = {
  turns: readonly Turn[];
  // The thread, message by message, in the order it was said.
  rows: readonly RowOf[];
  thinking: number | undefined;
  // The secretary is in its wait: a message it read and did not answer is not being thought about.
  secretaryListening?: boolean;
  items: ReadonlyMap<string, Item>;
  // The turn a link asked for, to find: it shows lit for a moment.
  found: number | undefined;
  onKind: (turn: Turn, kind: MessageKind) => void;
  // Goes to the turn a message answers.
  onGo: (root: number) => void;
  // The person's tap on a question of the secretary's.
  onAnswer: (message: Message, given: AnswerWords) => Promise<void>;
  // Deshacer after such a tap, while the secretary has not heard it.
  onRetract: (message: Message) => Promise<void>;
  // The notes of the Bandeja a refiner asked you about: their questions stand at the foot as an
  // agent's question on an item does, and are answered there. Read again once one is.
  noteAsks?: readonly BandejaEntry[];
  onNoteAnswered?: () => void;
  // The question «Te espera» sent you to: it lights for a moment.
  litAsk?: string | undefined;
  // The element that scrolls the conversation: the lanes draw in against it.
  scroller: RefObject<HTMLElement | null>;
  // Said when the turns are first there, just before the lanes draw in (the page scrolls to the
  // newest turn first, so the lanes draw where the person looks).
  onFirst?: () => void;
};

export function Turns({
  turns,
  rows,
  thinking,
  secretaryListening = false,
  items,
  found,
  onKind,
  onGo,
  onAnswer,
  onRetract,
  noteAsks = [],
  onNoteAnswered,
  litAsk,
  scroller,
  onFirst,
}: TurnsProps) {
  const app = useApp();
  const list = useRef<HTMLDivElement>(null);
  const geometry = useGeometry(list);
  // The questions of agents that wait for you, on any item the thread produced: they stand at the
  // foot, where the thread is now, not under the message that began their turn.
  const asks = useMemo(
    () => [
      ...new Map(
        turns.flatMap((turn) => asksOf(turn, items)).map((item) => [item.id, item]),
      ).values(),
    ],
    [turns, items],
  );
  const asked = useLingering(asks);
  const keys = useMemo(
    () => [
      ...rows.map(({ message }) =>
        message.author === 'person' ? `m${message.id}` : `r${message.id}`,
      ),
      ...turns.flatMap((turn) => turn.links.map((id) => `c${turn.root}:${id}`)),
      ...(thinking === undefined ? [] : [`t${thinking}`]),
      ...asks.map((item) => `a${item.id}`),
      ...noteAsks.map((entry) => `n${entry.ref}`),
    ],
    [rows, turns, thinking, asks, noteAsks],
  );
  const fresh = useFresh(keys);
  const begun = new Set<number>();
  // The lanes draw in once, when the first turns are there.
  const drawn = useRef(false);
  const first = useRef(onFirst);
  first.current = onFirst;
  useLayoutEffect(() => {
    if (drawn.current || turns.length === 0 || geometry.H === 0) return;
    drawn.current = true;
    first.current?.();
    drawIn(list.current, scroller.current ? { scope: scroller.current } : {});
  }, [turns.length, geometry.H, scroller]);
  return (
    <div className="lanes hb-lanes" ref={list}>
      <LaneInk geometry={geometry} />
      {rows.map((row) => {
        const begins = !begun.has(row.turn.root);
        begun.add(row.turn.root);
        return (
          <Entry
            key={row.message.id}
            row={row}
            items={items}
            now={app.now}
            fresh={fresh}
            found={row.turn.root === found}
            begins={begins}
            onKind={onKind}
            onGo={onGo}
            onAnswer={onAnswer}
            onRetract={onRetract}
          />
        );
      })}
      {thinking === undefined ? null : (
        <section className="hb-turn" data-k="thinking">
          <Row lane="secretary" bodyKey={`t${thinking}`} fresh={fresh(`t${thinking}`)} busy>
            <Thinking
              since={thinkingSince(turns, thinking)}
              now={app.now}
              listening={secretaryListening}
            />
          </Row>
        </section>
      )}
      {asked.length === 0 ? null : (
        <section className="hb-turn" data-k="asks">
          {asked.map(({ item, leaving }) => (
            <Row
              key={`a${item.id}`}
              lane="secretary"
              bodyKey={`a${item.id}`}
              fresh={fresh(`a${item.id}`)}
              leaving={leaving}
            >
              <div id={`hb-ask-${item.id}`} data-lit={litAsk === item.id || undefined}>
                <AskCard item={item} gone={!asks.some((each) => each.id === item.id)} />
              </div>
            </Row>
          ))}
        </section>
      )}
      {noteAsks.length === 0 ? null : (
        <section className="hb-turn" data-k="note-asks">
          {noteAsks.map((entry) => (
            <Row
              key={`n${entry.ref}`}
              lane="secretary"
              bodyKey={`n${entry.ref}`}
              fresh={fresh(`n${entry.ref}`)}
            >
              <div id={`hb-ask-${entry.ref}`} data-lit={litAsk === entry.ref || undefined}>
                <BandejaAsk entry={entry} onAnswered={() => onNoteAnswered?.()} />
              </div>
            </Row>
          ))}
        </section>
      )}
    </div>
  );
}
