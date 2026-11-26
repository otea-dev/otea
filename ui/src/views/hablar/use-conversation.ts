import { useCallback, useMemo, useState } from 'react';
import { fetchConversation, fetchSecretary } from '../../api.ts';
import { useApp } from '../../app/context.tsx';
import {
  type ConversationView,
  type Message,
  type MessageKind,
  mergeMessages,
  type SecretaryStatus,
} from '../../conversation.ts';
import { useRemote } from '../../hooks.ts';

// How many messages one read of the conversation brings: the newest ones, and a page back on ask.
const PAGE = 100;

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
      loadEarlier: () => void;
      // Reads the conversation again now (after a send), and shows a turn as the person set it
      // until the server says so too.
      reload: () => void;
      corrected: (root: number, kind: MessageKind) => void;
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
  const [kinds, setKinds] = useState<ReadonlyMap<number, MessageKind>>(new Map());
  const load = useCallback((signal: AbortSignal) => fetchConversation({ limit: PAGE }, signal), []);
  const remote = useRemote(load, app.version + bump, app.connection);
  const view = remote.status === 'ready' ? remote.value : undefined;

  const merged = useMemo(() => (view ? mergeMessages(older, view.messages) : []), [older, view]);
  const messages = useMemo(
    () =>
      kinds.size === 0
        ? merged
        : merged.map((m) => {
            const kind = kinds.get(m.root);
            return kind === undefined ? m : { ...m, kind };
          }),
    [merged, kinds],
  );
  const first = merged[0]?.id;
  const loadEarlier = useCallback(() => {
    if (first === undefined || loadingEarlier) return;
    setLoadingEarlier(true);
    fetchConversation({ before: first, limit: PAGE }, new AbortController().signal).then(
      (page) => {
        setOlder((was) => mergeMessages(page.messages, was));
        setOlderMore(page.more);
        setLoadingEarlier(false);
      },
      () => setLoadingEarlier(false),
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
    loadEarlier,
    reload: () => setBump((n) => n + 1),
    corrected: (root, kind) => setKinds((was) => new Map(was).set(root, kind)),
  };
}

// The project's secretary alone, for the rail: the state its row shows.
export function useSecretary(): SecretaryStatus | null | undefined {
  const app = useApp();
  const load = useCallback((signal: AbortSignal) => fetchSecretary(signal), []);
  const remote = useRemote(load, app.version, app.connection);
  return remote.status === 'ready' ? remote.value : undefined;
}
