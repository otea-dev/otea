import {
  type CSSProperties,
  type Ref,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from '../app/context.tsx';
import { t } from '../i18n/i18n.ts';
import { Icon } from '../kit/Icon.tsx';
import { NodeMark, nodeLabel } from '../kit/Node.tsx';
import { type Look, lookOf } from '../lanes/looks.ts';
import type { NodeKind } from '../node-kind.ts';
import { stateWordIn } from '../preset-words.ts';
import type { CollectionView, Item } from '../types.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { useKeyboardInset } from './CaptureSheet.tsx';
import { findItems } from './search.ts';
import { closeSearch, useSearchOpen } from './search-open.ts';

// The phone's search (the magnifier in the top bar): a sheet from below with the field focused, so
// the keyboard rises with it, and the items found under it as rows, each with its node, its title
// and where it stands (id · board · step). A row opens the item and takes the sheet away at once.
// It reads the items the phone holds (search.ts), so it works with no PC too.

const NODE: Record<Look, NodeKind> = {
  yours: 'you',
  working: 'working',
  queued: 'queued',
  waiting: 'queued',
  stuck: 'incomplete',
  done: 'done',
  dropped: 'discarded',
};

export type SearchBodyProps = {
  search: string;
  found: readonly Item[];
  now: number;
  collectionOf: (name: string) => CollectionView | undefined;
  inputRef?: Ref<HTMLInputElement>;
  onSearch: (value: string) => void;
  onOpen: (id: string) => void;
};

export function SearchBody({
  search,
  found,
  now,
  collectionOf,
  inputRef,
  onSearch,
  onOpen,
}: SearchBodyProps) {
  const typed = search.trim() !== '';
  return (
    <div className="search-body">
      <div className="srch-field" data-i="">
        <Icon name="search" className="srch-lens" />
        <input
          ref={inputRef}
          type="search"
          className="srch-input"
          aria-label={t('phone.search.field')}
          placeholder={t('phone.search.placeholder')}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {!typed ? (
        <p className="srch-note" data-i="">
          {t('phone.search.hint')}
        </p>
      ) : found.length === 0 ? (
        <p className="srch-note" role="status" data-i="">
          {t('phone.search.none', { search: search.trim() })}
        </p>
      ) : (
        <>
          <p className="srch-count t-cap" role="status" data-i="">
            {t('phone.search.count', { count: found.length })}
          </p>
          <ul className="srch-list">
            {found.map((item) => {
              const collection = collectionOf(item.collection);
              const kind = NODE[lookOf(item, now)];
              return (
                <li key={item.id}>
                  <button type="button" className="srow" onClick={() => onOpen(item.id)}>
                    <svg className="srow-node" width="20" height="20" viewBox="0 0 20 20">
                      <title>{nodeLabel(kind)}</title>
                      <NodeMark kind={kind} cx={10} cy={10} r={5} />
                    </svg>
                    <span className="srow-title">{item.title}</span>
                    <span className="srow-meta">
                      {item.id} · {item.collection} ·{' '}
                      {stateWordIn(collection?.types ?? [], item.state)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function SearchSheet() {
  const app = useApp();
  const { open, seq } = useSearchOpen();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [seen, setSeen] = useState(-1);
  // A row takes the sheet away at once; the scrim, Escape or a flick take it down the way it came.
  const [now, setNow] = useState(false);
  const inset = useKeyboardInset(open);
  const found = useMemo(() => findItems(app.all, search), [app.all, search]);

  // Each opening starts blank.
  if (open && seq !== seen) {
    setSeen(seq);
    setSearch('');
  }
  if (open && now) setNow(false);

  // The field takes the focus as the sheet opens, in the press that opened it, so the keyboard rises
  // with it. This runs after the sheet has focused itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each opening only
  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open, seq]);

  // Going somewhere else, or off the phone, puts it away: the sheet belongs to the route.
  const place = `${app.route.view}:${'board' in app.route ? app.route.board : ''}:${app.route.item ?? ''}`;
  const placeAt = useRef(place);
  useEffect(() => {
    if (placeAt.current !== place) closeSearch();
    placeAt.current = place;
  }, [place]);
  useEffect(() => {
    if (!app.phone) closeSearch();
  }, [app.phone]);

  if (!app.phone) return null;
  return (
    <BottomSheet
      open={open}
      instant={now}
      label={t('phone.search')}
      className="search"
      style={{ '--kb': `${inset}px` } as CSSProperties}
      from={() => document.querySelector('.topbar [data-search]')}
      onClose={closeSearch}
    >
      <SearchBody
        search={search}
        found={found}
        now={app.now}
        collectionOf={app.collectionOf}
        inputRef={input}
        onSearch={setSearch}
        onOpen={(id) => {
          setNow(true);
          closeSearch();
          app.openItem(id);
        }}
      />
    </BottomSheet>
  );
}
