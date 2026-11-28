import { describe, expect, it } from 'vitest';
import { type FeedEvent, mergeFeed } from '../../activity.ts';
import { agent, item, moved, NOW, officialType, you } from '../../derive/fixtures.ts';
import { dayStart, todayCounts } from './today.ts';

// s-real2, D-a55c6d: «Today they handed over 16, you approved 10» read «handed over 14, you approved
// 16» nine minutes later. The recap counted the feed's window of the newest 200 events, so on a busy
// afternoon the earliest hand-overs of the day slipped out of it and the figure went down. A figure
// of «today» only goes up while the day lasts.

const bug = officialType('bug-triage');
const DAY = 150;

// A busy day: each of 150 items handed over by an agent and approved by the person, in order: more
// events than the feed's window holds.
function busyDay(): FeedEvent[] {
  const feed: FeedEvent[] = [];
  for (let i = 0; i < DAY; i++) {
    const minutes = 90 - Math.floor((i * 80) / DAY);
    feed.push(
      moved(`E-${i}`, 'verify', agent('kiln'), { minutes, from: 'fixing' }),
      moved(`E-${i}`, 'fixed', you, { minutes, from: 'verify' }),
    );
  }
  return feed;
}

const items = Array.from({ length: DAY }, (_, i) =>
  item({ id: `E-${i}`, state: 'fixed', turn: 'none' }),
);
const ctx = { now: NOW, items, types: () => bug };

describe('what happened today, as the events stream in', () => {
  it('never says less than it said, and ends with the whole day', () => {
    let feed: FeedEvent[] = [];
    let before = { handed: 0, approved: 0, sent: 0 };
    for (const event of busyDay()) {
      feed = mergeFeed(feed, [event], dayStart(NOW));
      const now = todayCounts(feed, ctx);
      expect(now.handed).toBeGreaterThanOrEqual(before.handed);
      expect(now.approved).toBeGreaterThanOrEqual(before.approved);
      before = now;
    }
    expect(before).toEqual({ handed: DAY, approved: DAY, sent: 0 });
  });
});
