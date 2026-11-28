import {
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
  useContext,
  useRef,
  useState,
} from 'react';
import { byCase, byViewport, comparePair, nudgeSplit, splitAt, stepIndex } from '../../evidence.ts';
import { useFileUrl } from '../../evidence-files.ts';
import { t } from '../../i18n/i18n.ts';
import { Button, Icon } from '../../kit/index.ts';
import { earlierRoundPair, sameBytes } from '../../rounds.ts';
import type { Evidence } from '../../types.ts';
import { stepWithArrows } from './arrows.ts';
import { FileMeta } from './FileMeta.tsx';
import { ItemReview } from './item-evidence.ts';
import { Pic } from './Pic.tsx';

function altOf(evidence: Evidence): string {
  return evidence.caption ?? evidence.filename;
}

// A capture this much taller than wide is a whole page, not a screen: a phone's 390 x 844 is 2.2.
export const TALL = 3;

// What a picture needs to say it is tall (a full-page capture): the reader fits it to the width and
// scrolls it down, where fitting the height left a sliver 130 px wide.
function useTall(): {
  'data-tall'?: '';
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
} {
  const [tall, setTall] = useState(false);
  return {
    ...(tall ? { 'data-tall': '' as const } : {}),
    onLoad: (event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      setTall(naturalWidth > 0 && naturalHeight > naturalWidth * TALL);
    },
  };
}

export function ImageSingle({ evidence }: { evidence: Evidence }) {
  const fileUrl = useFileUrl();
  const tall = useTall();
  return (
    <figure className="ev-figure">
      <div className="ev-stage well">
        <Pic
          className="ev-img ev-set"
          src={fileUrl(evidence)}
          alt={altOf(evidence)}
          name={evidence.filename}
          {...tall}
        />
      </div>
      <figcaption>
        <FileMeta evidence={evidence} />
      </figcaption>
    </figure>
  );
}

// The review's word when a round holds the very bytes of the round it is compared with (P5-F1).
function SameNote({ from }: { from: number }) {
  return (
    <p className="t-cap ev-same" role="status">
      {t('evidence.sameAsRound', { n: from })}
    </p>
  );
}

// Every image, oldest first: one large, the rest as thumbnails. It opens on the newest (the latest
// round's), and follows a newer one that arrives until another is picked. Left and right step
// through them. On a reviewed item each says the round it came in, the thumbnails too (P5-5), and
// the picture shown compares with its version in the round before, paired by name as the phone
// pairs them (rounds.ts, earlierRoundPair), in the compare the desk has for a before and an after.
export function ImageGallery({ evidence, label }: { evidence: Evidence[]; label: string }) {
  const fileUrl = useFileUrl();
  const { roundOf } = useContext(ItemReview);
  const [comparing, setComparing] = useState(false);
  const roundWord = (entry: Evidence) => {
    const n = roundOf?.get(entry.id);
    return n === undefined ? undefined : t('evidence.roundTag', { n });
  };
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const at = evidence.findIndex(({ id }) => id === picked);
  const index = at >= 0 ? at : evidence.length - 1;
  const current = evidence[index];
  if (!current) return null;
  const many = evidence.length > 1;
  const earlier = roundOf ? earlierRoundPair(evidence, roundOf, current) : undefined;
  const unchanged = earlier !== undefined && sameBytes(earlier.before, current);
  if (comparing && earlier) {
    const names = {
      before: t('evidence.roundTag', { n: earlier.from }),
      after: t('evidence.roundTag', { n: earlier.to }),
    };
    return (
      <section className="ev-gallery" aria-label={label}>
        <div className="ev-gallery-tools">
          <Button size="sm" onClick={() => setComparing(false)}>
            <Icon name="left" />
            {t('evidence.backToGallery')}
          </Button>
        </div>
        <ImageCompare
          evidence={[
            { ...earlier.before, role: 'before' },
            { ...current, role: 'after' },
          ]}
          names={names}
        />
        {unchanged ? <SameNote from={earlier.from} /> : null}
      </section>
    );
  }
  const setIndex = (to: number) => setPicked(evidence[to]?.id);
  const step = (delta: number) => setIndex(stepIndex(index, delta, evidence.length));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) =>
    stepWithArrows(event, index, evidence.length, setIndex);
  return (
    <section
      className="ev-gallery"
      aria-roledescription={t('evidence.galleryRole')}
      aria-label={label}
      onKeyDown={many ? onKeyDown : undefined}
    >
      <div className="ev-stage well">
        <Pic
          key={current.id}
          className="ev-img ev-set"
          src={fileUrl(current)}
          alt={altOf(current)}
          name={current.filename}
        />
        {many ? (
          <>
            <span className="ev-tag r" aria-live="polite">
              {index + 1} / {evidence.length}
              {roundWord(current) ? ` · ${roundWord(current)}` : ''}
            </span>
            <Button
              className="ev-nav l"
              size="sm"
              icon
              aria-label={t('evidence.previous')}
              onClick={() => step(-1)}
            >
              <Icon name="left" />
            </Button>
            <Button
              className="ev-nav r"
              size="sm"
              icon
              aria-label={t('evidence.next')}
              onClick={() => step(1)}
            >
              <Icon name="right" />
            </Button>
          </>
        ) : null}
      </div>
      <FileMeta evidence={current} />
      {earlier ? (
        <div className="ev-gallery-tools">
          {unchanged ? <SameNote from={earlier.from} /> : null}
          <Button size="sm" onClick={() => setComparing(true)}>
            {t('evidence.compareWithRound', { n: earlier.from })}
          </Button>
        </div>
      ) : null}
      {many ? (
        <ul className="ev-thumbs">
          {evidence.map((entry, at) => (
            <li key={entry.id}>
              <button
                type="button"
                className="ev-thumb well"
                aria-current={at === index ? 'true' : undefined}
                aria-label={t('evidence.show', { file: entry.filename })}
                onClick={() => setIndex(at)}
              >
                <img src={fileUrl(entry)} alt="" loading="lazy" />
                {roundWord(entry) ? (
                  <span className="ev-thumb-round">{roundWord(entry)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export type CompareMode = 'slider' | 'side';

type Side = 'before' | 'after';

// What each side is called: before and after, A and B on a blind compare (P5-4), or the rounds
// they come from (P5-5).
export type SideNames = Readonly<Record<Side, string>>;

const BLIND: SideNames = { before: 'A', after: 'B' };

const sideNames = (): SideNames => ({ before: t('evidence.before'), after: t('evidence.after') });

const sideAlt = (label: string, evidence: Evidence) =>
  t('evidence.alt', { side: label, alt: altOf(evidence) });

function Missing({ side, blind }: { side: Side; blind: boolean }) {
  return (
    <div className="ev-frame ev-missing well">
      <span className="t-cap">
        {blind
          ? t('evidence.blindEmpty')
          : t(side === 'before' ? 'evidence.noBefore' : 'evidence.noAfter')}
      </span>
    </div>
  );
}

function Framed({ evidence, label }: { evidence: Evidence; label: string }) {
  const fileUrl = useFileUrl();
  return (
    <figure className="ev-frame">
      <span className="ev-tag out">{label}</span>
      <div className="ev-stage well">
        <Pic
          className="ev-img"
          src={fileUrl(evidence)}
          alt={sideAlt(label, evidence)}
          name={evidence.filename}
        />
      </div>
      <figcaption>
        <FileMeta evidence={evidence} />
      </figcaption>
    </figure>
  );
}

// A compare part's shots, one compare for each viewport they were taken at (phone first, each named)
// and, inside a viewport, one for each case they show (each named), never a shot of one size or one
// case laid over a shot of another. Shots whose names say no viewport or case are one plain compare.
export function ImageCompares({ evidence }: { evidence: Evidence[] }) {
  const groups = byViewport(evidence).flatMap(({ key, files }) =>
    byCase(files).map(({ name, files: own }) => ({ key, name, files: own })),
  );
  const [only] = groups;
  if (groups.length < 2 || !only) return <ImageCompare evidence={evidence} />;
  return (
    <>
      {groups.map(({ key, name, files }) => (
        <section key={`${key ?? 'any'}/${name}`} className="ev-viewport">
          {key || name ? (
            <h4 className="ev-viewport-h">
              {[key ? t(`evidence.viewport.${key}`) : '', name].filter(Boolean).join(' · ')}
            </h4>
          ) : null}
          <ImageCompare evidence={files} />
        </section>
      ))}
    </>
  );
}

// The latest before and after on one frame, a divider between them: drag it, or focus it and use the
// arrow keys. Side by side shows them apart.
export function ImageCompare({
  evidence,
  blind = false,
  names,
  initial = 'side',
}: {
  evidence: Evidence[];
  blind?: boolean;
  names?: SideNames | undefined;
  initial?: CompareMode;
}) {
  const fileUrl = useFileUrl();
  const { before, after } = comparePair(evidence);
  const [mode, setMode] = useState<CompareMode>(initial);
  const label = names ?? (blind ? BLIND : sideNames());
  const [split, setSplit] = useState(50);
  const [ratio, setRatio] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  if (!before || !after) {
    return (
      <div className="ev-pair">
        {before ? (
          <Framed evidence={before} label={label.before} />
        ) : (
          <Missing side="before" blind={blind} />
        )}
        {after ? (
          <Framed evidence={after} label={label.after} />
        ) : (
          <Missing side="after" blind={blind} />
        )}
      </div>
    );
  }
  const follow = (event: PointerEvent) => {
    const box = frame.current?.getBoundingClientRect();
    if (box) setSplit(splitAt(event.clientX, box.left, box.width));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    follow(event);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging) follow(event);
  };
  const stop = () => setDragging(false);
  const onKeyDown = (event: KeyboardEvent) => {
    const to = nudgeSplit(split, event.key, event.shiftKey);
    if (to === undefined) return;
    event.preventDefault();
    setSplit(to);
  };
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
  };
  const shown = Math.round(split);
  return (
    <div className="ev-compare" data-mode={mode}>
      <fieldset className="ev-modes" aria-label={t('evidence.howToCompare')}>
        <Button size="sm" aria-pressed={mode === 'slider'} onClick={() => setMode('slider')}>
          {t('evidence.slider')}
        </Button>
        <Button size="sm" aria-pressed={mode === 'side'} onClick={() => setMode('side')}>
          {t('evidence.sideBySide')}
        </Button>
      </fieldset>
      {mode === 'slider' ? (
        <figure className="ev-frame">
          <div className="ev-sides">
            <span className="ev-tag out">{label.before}</span>
            <span className="ev-tag out">{label.after}</span>
          </div>
          <div
            ref={frame}
            className="ev-cmp well"
            data-dragging={dragging ? 'true' : undefined}
            style={ratio ? { aspectRatio: String(ratio) } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerCancel={stop}
          >
            <img
              className="ev-img"
              src={fileUrl(after)}
              alt={sideAlt(label.after, after)}
              onLoad={onLoad}
              draggable={false}
            />
            <img
              className="ev-img ev-cmp-before"
              src={fileUrl(before)}
              alt={sideAlt(label.before, before)}
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              draggable={false}
            />
            <div
              className="ev-divider"
              style={{ left: `${split}%` }}
              role="slider"
              tabIndex={0}
              aria-label={t(blind ? 'evidence.dividerBlind' : 'evidence.divider')}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shown}
              aria-valuetext={
                names || blind
                  ? `${label.before} ${shown} % · ${label.after} ${100 - shown} %`
                  : t('evidence.split', { before: shown, after: 100 - shown })
              }
              onKeyDown={onKeyDown}
            >
              <span className="ev-knob" aria-hidden="true">
                <Icon name="left" />
                <Icon name="right" />
              </span>
            </div>
          </div>
          <figcaption className="ev-pair-meta">
            <FileMeta evidence={before} />
            <FileMeta evidence={after} />
          </figcaption>
        </figure>
      ) : (
        <div className="ev-pair">
          <Framed evidence={before} label={label.before} />
          <Framed evidence={after} label={label.after} />
        </div>
      )}
    </div>
  );
}
