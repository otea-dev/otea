import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchConversation, fetchSecretary } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import {
  type ConversationView,
  type Message,
  type MessageKind,
  mergeMessages,
  type SecretaryStatus,
} from '../../conversation.ts';
import { useRemote, useThrottled } from '../../hooks.ts';

// How many messages one read of the conversation brings: the newest ones, and a page back on ask.
const PAGE = 100;

// The conversation (and the secretary's state) is read again at most this often as the project
// changes, as the pending list is: a read is a hundred messages, and a busy minute is many events.
const READ_MS = 1_500;

export type ConversationState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'ready';
      messages: Message[];
      secretary: SecretaryStatus | null;
      waiting: ConversationView['waiting'];
      // Earlier messages lie before the first one loaded.
      earlier: boolean;
      loadingEarlier: boolean;
      // The last page asked for did not come: what asks for pages on its own stops there.
      earlierFailed: boolean;
      loadEarlier: () => void;
      // Reads the conversation again now (after a send), and shows a turn as the person set it
      // until the server says so too (`uncorrected`: the server refused, the turn is as it was).
      reload: () => void;
      corrected: (root: number, kind: MessageKind) => void;
      uncorrected: (root: number) => void;
    };

// The conversation as the page reads it: the newest messages, kept fresh with the desk's live
// feed (every change of the project reads it again), the earlier pages the person asked for, and
// a turn corrected shown as it was set at once.
export function useConversation(): ConversationState {
  const app = useApp();
  const [bump, setBump] = useState(0);
  const [older, setOlder] = useState<Message[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const [kinds, setKinds] = useState<ReadonlyMap<number, MessageKind>>(new Map());
  const load = useCallback((signal: AbortSignal) => fetchConversation({ limit: PAGE }, signal), []);
  // A send or a tap reads again at once (`bump`); the project's own changes follow the throttle.
  const remote = useRemote(load, useThrottled(app.version, READ_MS) + bump, app.connection);
  const view = remote.status === 'ready' ? remote.value : undefined;

  const merged = useMemo(() => (view ? mergeMessages(older, view.messages) : []), [older, view]);
  // A turn corrected shows as the person set it until the server says so too; from then on the
  // server's word is the page's, so a later change of it is never hidden by the old tap.
  const messages = useMemo(
    () =>
      kinds.size === 0
        ? merged
        : merged.map((m) => {
            const kind = kinds.get(m.root);
            return kind === undefined || kind === m.kind
              ? m
              : { ...m, kind, kindBy: 'person' as const };
          }),
    [merged, kinds],
  );
  useEffect(() => {
    if (kinds.size === 0) return;
    // What the page shows as a turn's kind (turnsOf): the last one any of its messages carries.
    const served = new Map<number, MessageKind>();
    for (const m of merged) if (m.kind !== null) served.set(m.root, m.kind);
    const matched = [...kinds].filter(([root, kind]) => served.get(root) === kind);
    if (matched.length === 0) return;
    setKinds((was) => {
      const next = new Map(was);
      for (const [root] of matched) next.delete(root);
      return next;
    });
  }, [merged, kinds]);
  const first = merged[0]?.id;
  const loadEarlier = useCallback(() => {
    if (first === undefined || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    fetchConversation({ before: first, limit: PAGE }, new AbortController().signal).then(
      (page) => {
        setOlder((was) => mergeMessages(page.messages, was));
        setOlderMore(page.more);
        setLoadingEarlier(false);
      },
      () => {
        setEarlierFailed(true);
        setLoadingEarlier(false);
      },
    );
  }, [first, loadingEarlier]);

  if (remote.status === 'loading') return { status: 'loading' };
  if (remote.status === 'failed' || !view) {
    return { status: 'failed', message: remote.status === 'failed' ? remote.message : '' };
  }
  return {
    status: 'ready',
    messages,
    secretary: view.secretary,
    waiting: view.waiting,
    earlier: olderMore ?? view.more,
    loadingEarlier,
    earlierFailed,
    loadEarlier,
    reload: () => setBump((n) => n + 1),
    corrected: (root, kind) => setKinds((was) => new Map(was).set(root, kind)),
    uncorrected: (root) =>
      setKinds((was) => {
        const next = new Map(was);
        next.delete(root);
        return next;
      }),
  };
}

// The project's secretary alone, for the rail: the state its row shows.
export function useSecretary(): SecretaryStatus | null | undefined {
  const app = useApp();
  const load = useCallback((signal: AbortSignal) => fetchSecretary(signal), []);
  const remote = useRemote(load, useThrottled(app.version, READ_MS), app.connection);
  return remote.status === 'ready' ? remote.value : undefined;
}
