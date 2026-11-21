import { clamp, F, lerp, sstep } from '../motion/curves.ts';
import { Tt } from '../motion/time.ts';

// Every frame of the handoff as a pure function of its time (port of the frame body of
// transition(), mock:2152-2251). The engine writes what these return; nothing here touches the DOM.

// Plegar folds the row into a line (FOLD) before it travels and unfolds it after (UNFOLD). The fold
// is short and the rows start to close its gap before it ends, so the list never holds an empty
// slot while the pulse is on its way.
export const FOLD = 260;
export const UNFOLD = 460;

export type Clock = { T: number; FA: number; Cc: number; total: number };

// The share of the travel the pulse takes to reach its row's place (on settle it has arrived by
// then): the row unfolds from there, while the rooms finish settling, instead of after the travel's
// quiet tail, so the slot made for it never waits empty.
export const LAND = 0.6;

// The travel takes the time of the longest carry (480 with nothing carried); a carry adds the fold
// before it and the unfold after.
export function handoffClock(dys: readonly number[]): Clock {
  const T = dys.length ? Math.max(...dys.map((d) => Tt.travel(d))) : 480;
  const fold = dys.length > 0;
  const FA = fold ? FOLD : 0;
  const Cc = fold ? UNFOLD : 0;
  return { T, FA, Cc, total: FA + (fold ? Math.max(T, LAND * T + Cc) : T) };
}

// The travel's progress (p, on settle) and the rooms' (pr), at time t. The rooms of a carry lead it:
// they start as the fold ends, so the slot the row left closes as it goes; the rooms of a change
// with no carry follow it 40 ms behind.
const ROOMS_LEAD = 100;

export function progressAt(t: number, FA: number, T: number) {
  const tb = t - FA;
  const s = clamp(tb / T);
  const pr = FA > 0 ? clamp((tb + ROOMS_LEAD) / (T + ROOMS_LEAD + 40)) : clamp((tb - 40) / T);
  return { tb, s, p: F.settle(s), pr: F.settle(pr) };
}

// A carried row's geometry: dy0/dy1 its offsets from its layout top at the start and the end, xa/xb
// its node's lane x at both ends, xc the x it is drawn at, h the lift's height, w the row's width,
// off its node's y inside the row, ct its layout top. folded: a handoff that took it over found it
// already folded.
export type CarryGeom = {
  dy0: number;
  dy1: number;
  xa: number;
  xb: number;
  xc: number;
  h: number;
  w: number;
  off: number;
  ct: number;
  preVirtual: boolean;
  postVirtual: boolean;
  arrive: boolean;
  folded?: boolean;
};

export type Pose = {
  // The row's translateY.
  y: number;
  // The lift: its opacity, and its clip from the top and the bottom.
  lift: { opacity: number; clip: [number, number] };
  // The node's translateX from where it is drawn.
  nodeDx: number;
  // How much of the new look shows over the old one, and whether its check or slash draws now.
  newLook: number;
  mark: boolean;
  // The pulse's colour, from the old look's (0) to the new one's (1).
  mix: number;
  // The fold line: its left, top, width and opacity.
  line: { x: number; y: number; w: number; o: number };
  // The pulse: its translate, scale and opacity.
  pulse: { x: number; y: number; s: number; o: number };
  // The trail's length behind the pulse, and where the pulse is.
  trail: number;
  nx: number;
  ny: number;
  // Time for the breath on the destination lane.
  breath: boolean;
};

const LINE_PEAK = 0.45;

const nodeX = (p: number, g: CarryGeom) => lerp(g.xa, g.xb, sstep(clamp((p - 0.12) / 0.6)));

export function plegarPose(t: number, T: number, g: CarryGeom): Pose {
  const FA = FOLD;
  const { p } = progressAt(t, FA, T);
  const inA = t < FA;
  const L = FA + LAND * T;
  const inC = t >= L;
  const fa = g.folded ? 1 : F.glide(clamp(t / 200));
  const sh = F.ink(clamp((t - 130) / 130));
  const ga = F.ink(clamp((t - L) / 200));
  const un = F.settle(clamp((t - L - 80) / 340));
  const y = lerp(g.dy0, g.dy1, p);
  const k = inC ? 1 - un : inA ? fa : 1;
  const hide = (g.preVirtual && !inC) || (g.postVirtual && inC);
  const nx = nodeX(p, g);
  const ny = g.ct + g.off + y;
  const mx = sstep(clamp((p - 0.3) / 0.4));
  const span = Math.max(0, g.w - nx - 16);
  let lw = 0;
  let lo = 0;
  if (inA && !g.preVirtual && !g.folded) {
    lw = span * (1 - sh);
    // The line of light is a hint of the fold, not a streak across the row.
    lo = LINE_PEAK * sstep(clamp((t - 50) / 110));
  } else if (inC && !g.postVirtual) {
    lw = span * ga;
    lo = LINE_PEAK * (1 - sstep(clamp((un - 0.55) / 0.45)));
  }
  const lit = inA && !g.folded ? sstep(clamp((t - (g.preVirtual ? 0 : 150)) / 110)) : 1;
  const land = inC ? sstep(clamp((t - L) / 220)) : 0;
  return {
    y,
    lift: {
      opacity: hide || k > 0.995 ? 0 : 1,
      clip: [g.off * k, Math.max(0, g.h - g.off) * k],
    },
    nodeDx: nx - g.xc,
    newLook: inC ? 1 : 0,
    mark: un > 0.4,
    mix: inA ? 0 : inC ? 1 : mx,
    line: { x: nx, y: ny - 0.75, w: lw, o: lo },
    pulse: { x: nx - 3, y: ny - 3, s: 1 + 1.8 * land, o: lit * (1 - land) },
    trail: inA || inC ? 0 : 46 * Math.sin(Math.PI * p),
    nx,
    ny,
    breath: t > FA + T * 0.5,
  };
}
