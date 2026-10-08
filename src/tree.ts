// Act four: a caterpillar climbing an enormous tree, seen side-on. It can crawl on
// the trunk and along the branches; leaves and flowers on the branches make it grow
// bigger and more colourful. Reach the canopy at the top to finish.
// Coordinates: x across (0 is the middle of the trunk), y up (0 is the ground).

import type { Dir } from './sim.ts';

export const TREE_H = 90; // the canopy starts here
export const TRUNK_HALF = 3; // the trunk is 6 wide
export const CAT_SPEED = 2.2;
export const CAT_SEGMENTS = 12;
export const CAT_SPACING = 0.2;
export const MORPH_TIME = 1.6; // worm → caterpillar, at the foot of the tree
export const LEAF_POINTS = 10;
export const FLOWER_POINTS = 25;
export const MAX_SIZE = 2.6;
export const GROWTH = 0.03; // size gained per leaf (flowers count double)
/** How many things it must have eaten to reach each colour stage. */
export const COLOR_STAGES = [0, 6, 14, 24, 36, 50] as const;
export const REGROW_TIME = 30; // eaten leaves and flowers grow back after this long
/** It takes 100 leaves (flowers count double) to be big enough to climb to the very top. */
export const LEAVES_NEEDED = 100;
export const GATE_Y = TREE_H - 4;
/** The sparkling branch at the very top, and the sparkles at its tip. */
export const SPECIAL_Y = TREE_H + 0.6;
export const SPECIAL_LEN = 8;
export const SPARKLES = { x: TRUNK_HALF + SPECIAL_LEN - 0.6, y: SPECIAL_Y };
/** The metamorphosis: wrap up in a cocoon; days and nights race by; emerge as… a pigeon. */
export const WRAP_TIME = 1.5;
export const DAY_CYCLE = 2.2; // seconds per (very fast) day
export const EMERGE_AT = WRAP_TIME + 3.75 * DAY_CYCLE; // the start of the 4th sunrise
export const FLY_AT = EMERGE_AT + 1.6; // wings dry: off it flutters
/** 10–20 s of flying free… then a gust of wind blows it far away, to the city. */
export const FLY_TIME = [10, 20] as const;
export const GUST_TIME = 2.2; // tumbling away on the wind
export const FLY_SPEED = 4;
const TURN_RATE = 12;
const PIVOT = 0.5;
const ANGLE: Record<Dir, number> = { right: 0, up: Math.PI / 2, left: Math.PI, down: -Math.PI / 2 };

/** Somewhere the caterpillar can crawl: the trunk, or a branch. */
export interface Bark {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface Food {
  id: number;
  kind: 'leaf' | 'flower';
  x: number;
  y: number;
  /** Leaf: which way it hangs (radians). Flower: its petal colour. */
  angle: number;
  color: number;
  eaten: boolean;
  /** Seconds until it grows back, once eaten. */
  regrow: number;
}

/** A bird overhead: its shadow falls on the tree; get out of it before it swoops. */
export const TREE_BIRD_EVERY = [20, 60] as const;
export const SHADOW_TIME = 2.5; // seconds of warning
export const SWOOP_TIME = 1.2; // the swoop itself, and (if caught) being carried off
export interface TreeBird {
  phase: 'shadow' | 'swoop';
  t: number;
  /** Where the shadow lies, and how big it is. */
  x: number;
  y: number;
  r: number;
  caught: boolean;
}

export type TreeEvent =
  | { type: 'caterpillar' }
  | { type: 'shadow' }
  | { type: 'swoop'; caught: boolean }
  | { type: 'treeRespawn' }
  | { type: 'leafEaten'; kind: 'leaf' | 'flower' }
  | { type: 'colorUp'; stage: number }
  | { type: 'tooSmall'; eaten: number }
  | { type: 'leafRegrow' }
  | { type: 'cocoon' }
  | { type: 'sunset' }
  | { type: 'sunrise' }
  | { type: 'emerge' }
  | { type: 'gust' }
  | { type: 'blownAway' };

export class Tree {
  trunk: Bark = { x0: -TRUNK_HALF, x1: TRUNK_HALF, y0: 0, y1: TREE_H + 2 };
  branches: Bark[] = [];
  food: Food[] = [];
  head = { x: 0, y: 0.4 };
  heading = Math.PI / 2;
  moving = false;
  path: { x: number; y: number }[] = [];
  /** Seconds since it surfaced (the first MORPH_TIME are the worm turning into a caterpillar). */
  t = 0;
  eaten = 0;
  /** The sparkling branch at the very top. */
  special: Bark = { x0: TRUNK_HALF - 0.3, x1: TRUNK_HALF + SPECIAL_LEN, y0: SPECIAL_Y - 0.4, y1: SPECIAL_Y + 0.4 };
  /** Reached the sparkles: metamorphosis under way (wonT counts through it). */
  won = false;
  /** When the gust comes (seconds into the metamorphosis): picked when it settles into its cocoon. */
  gustAt = FLY_AT + FLY_TIME[1];
  /** The pigeon, once it's emerged. */
  fly = { x: 0, y: 0 };
  private tooSmallT = 0;
  wonT = 0;
  bird: TreeBird | null = null;
  /** Snatched by the bird (being carried off, then respawning). */
  snatched = false;
  private birdTimer = 0;
  private rngState: number;

  constructor(seed: number) {
    this.rngState = seed >>> 0;
    // Branches all the way up, mostly alternating sides, getting shorter towards the top.
    let side = this.rng() < 0.5 ? -1 : 1;
    for (let y = 4; y < TREE_H - 3; y += 2.6 + this.rng() * 2.4) {
      if (this.rng() < 0.75) side = -side;
      const len = (4 + this.rng() * 7) * (1 - (y / TREE_H) * 0.35);
      const thick = 0.75 + this.rng() * 0.3;
      const x0 = side > 0 ? TRUNK_HALF - 0.3 : -TRUNK_HALF - len;
      this.branches.push({ x0, x1: x0 + len + 0.3, y0: y - thick / 2, y1: y + thick / 2 });
      // Leaves along the top and bottom edges, and flowers here and there.
      let id = this.food.length + 1;
      for (let x = 0.8; x < len; x += 0.55 + this.rng() * 0.6) {
        const bx = side > 0 ? TRUNK_HALF + x : -TRUNK_HALF - x;
        const top = this.rng() < 0.5;
        const flower = this.rng() < 0.18;
        this.food.push({
          id: id++, kind: flower ? 'flower' : 'leaf', x: bx, y: top ? y + thick / 2 + 0.05 : y - thick / 2 - 0.05,
          angle: (top ? Math.PI / 2 : -Math.PI / 2) + (this.rng() - 0.5) * 1.2,
          color: [0xff6fa8, 0xffffff, 0xffd23f, 0xc77dff, 0xff8c42][Math.floor(this.rng() * 5)], eaten: false, regrow: 0,
        });
      }
    }
    for (let i = 0; i < CAT_SEGMENTS * 3; i++) this.path.push({ x: 0, y: 0.4 - i * 0.02 });
    this.birdTimer = MORPH_TIME + this.between(TREE_BIRD_EVERY);
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }

  /** The shadow's size: a bigger caterpillar makes a bigger target. */
  shadowRadius(): number {
    return 1.8 + this.size() * 0.45;
  }

  /** Is the caterpillar's head inside the bird's shadow? */
  inShadow(): boolean {
    const b = this.bird;
    return !!b && Math.hypot(this.head.x - b.x, this.head.y - b.y) < b.r;
  }

  private stepBird(dt: number, events: TreeEvent[]): void {
    const b = this.bird;
    if (!b) {
      if ((this.birdTimer -= dt) > 0 || this.won || this.snatched) return;
      this.bird = { phase: 'shadow', t: 0, x: this.head.x, y: this.head.y, r: this.shadowRadius(), caught: false };
      events.push({ type: 'shadow' });
      return;
    }
    b.t += dt;
    if (b.phase === 'shadow' && b.t >= SHADOW_TIME) {
      // Down it comes!
      b.caught = this.inShadow();
      Object.assign(b, { phase: 'swoop', t: 0 });
      if (b.caught) this.snatched = true;
      events.push({ type: 'swoop', caught: b.caught });
    } else if (b.phase === 'swoop' && b.t >= SWOOP_TIME) {
      if (b.caught) this.respawnNear(b.x, b.y, events);
      this.bird = null;
      this.birdTimer = this.between(TREE_BIRD_EVERY);
    }
  }

  /** Dropped back on the branch nearest to where it was caught (ready to try again). */
  private respawnNear(x: number, y: number, events: TreeEvent[]): void {
    let best = this.branches[0], bestD = Infinity;
    for (const br of this.branches) {
      const d = Math.hypot((br.x0 + br.x1) / 2 - x, (br.y0 + br.y1) / 2 - y);
      if (d < bestD) {
        best = br;
        bestD = d;
      }
    }
    const out = best.x0 < 0 ? -1 : 1;
    const by = (best.y0 + best.y1) / 2;
    const bx = out > 0 ? best.x0 + (best.x1 - best.x0) * 0.6 : best.x1 - (best.x1 - best.x0) * 0.6;
    this.head = { x: bx, y: by };
    this.heading = out > 0 ? Math.PI : 0; // facing back towards the trunk
    this.path = Array.from({ length: CAT_SEGMENTS * 6 }, (_, i) => ({ x: bx + out * i * 0.05, y: by }));
    this.snatched = false;
    events.push({ type: 'treeRespawn' });
  }

  private rng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** On the bark (trunk or a branch), with a little margin? */
  onBark(x: number, y: number): boolean {
    if (y < 0.25) return false;
    const m = 0.05;
    return [this.trunk, this.special, ...this.branches].some((b) => x >= b.x0 - m && x <= b.x1 + m && y >= b.y0 - m && y <= b.y1 + m);
  }

  /** How big it's grown: 1, up to MAX_SIZE. */
  size(): number {
    return Math.min(MAX_SIZE, 1 + this.eaten * GROWTH);
  }

  /** Which colour stage it's reached (0 = plain green … 5 = rainbow). */
  colorStage(): number {
    let stage = 0;
    COLOR_STAGES.forEach((n, i) => {
      if (this.eaten >= n) stage = i;
    });
    return stage;
  }

  /** How high it's climbed, 0 … 1. */
  progress(): number {
    return Math.min(1, this.head.y / TREE_H);
  }

  update(dt: number, input: Dir | null, events: TreeEvent[]): number {
    const before = this.t;
    this.t += dt;
    if (before < MORPH_TIME && this.t >= MORPH_TIME) events.push({ type: 'caterpillar' });
    this.moving = false;
    if (this.won) return this.stepMetamorphosis(dt, input, events);
    if (this.t < MORPH_TIME) return 0;
    this.tooSmallT -= dt;
    for (const f of this.food) {
      if (f.eaten && (f.regrow -= dt) <= 0) {
        f.eaten = false;
        events.push({ type: 'leafRegrow' });
      }
    }
    this.stepBird(dt, events);
    if (this.snatched || !input) return 0;
    const target = ANGLE[input];
    const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    if (Math.abs(diff) > PIVOT) return 0;
    const step = CAT_SPEED * (0.9 + this.size() * 0.1) * dt; // longer legs, a little faster
    const nx = this.head.x + Math.cos(this.heading) * step, ny = this.head.y + Math.sin(this.heading) * step;
    if (!this.onBark(nx, ny)) return 0; // that's thin air
    if (ny > GATE_Y && this.eaten < LEAVES_NEEDED && ny > this.head.y) {
      // Too small to climb any higher yet.
      if (this.tooSmallT <= 0) {
        this.tooSmallT = 3;
        events.push({ type: 'tooSmall', eaten: this.eaten });
      }
      return 0;
    }
    this.moving = true;
    this.head = { x: nx, y: ny };
    const last = this.path[0];
    if (!last || Math.hypot(last.x - nx, last.y - ny) > 0.04) {
      this.path.unshift({ x: nx, y: ny });
      if (this.path.length > CAT_SEGMENTS * 24) this.path.length = CAT_SEGMENTS * 24;
    }
    const reached = Math.hypot(this.head.x - SPARKLES.x, this.head.y - SPARKLES.y) < 0.8;
    return this.munch(events) + (reached ? this.startCocoon(events) : 0);
  }

  /** Eat whatever's in reach of its (growing) mouth. Returns points scored. */
  private munch(events: TreeEvent[]): number {
    let points = 0;
    const reach = 0.35 + this.size() * 0.15;
    for (const f of this.food) {
      if (f.eaten || Math.hypot(f.x - this.head.x, f.y - this.head.y) > reach) continue;
      f.eaten = true;
      f.regrow = REGROW_TIME;
      const stage = this.colorStage();
      this.eaten += f.kind === 'flower' ? 2 : 1;
      points += f.kind === 'flower' ? FLOWER_POINTS : LEAF_POINTS;
      events.push({ type: 'leafEaten', kind: f.kind });
      if (this.colorStage() > stage) events.push({ type: 'colorUp', stage: this.colorStage() });
    }
    return points;
  }

  /** At the sparkles: it wraps itself up in a cocoon, hanging from the tip of the branch. */
  private startCocoon(events: TreeEvent[]): number {
    this.won = true;
    this.bird = null;
    this.snatched = false;
    this.wonT = 0;
    this.head = { ...SPARKLES };
    this.fly = { x: SPARKLES.x, y: SPARKLES.y - 1.2 };
    this.gustAt = FLY_AT + this.between(FLY_TIME);
    events.push({ type: 'cocoon' });
    return 2000;
  }

  /** How far the sun has gone round (radians: π/2 is noon, π sunset, 3π/2 midnight, 2π sunrise). */
  sunAngle(): number {
    if (!this.won) return Math.PI / 2;
    const u = Math.max(0, this.wonT - WRAP_TIME);
    const atEmerge = EMERGE_AT - WRAP_TIME;
    // Racing round during the metamorphosis; then rising gently into the morning.
    const turns = u < atEmerge ? u / DAY_CYCLE : atEmerge / DAY_CYCLE + (u - atEmerge) / (DAY_CYCLE * 6);
    return Math.min(Math.PI / 2 + turns * Math.PI * 2, Math.PI / 2 + 4 * Math.PI * 2);
  }

  /** How many nights the cocoon has been through (it swells a little each one). */
  nights(): number {
    return Math.floor((this.sunAngle() - Math.PI / 2 + Math.PI * 1.5) / (Math.PI * 2));
  }

  /** Cocoon, emergence, then the pigeon free to flap about. Returns points scored. */
  private stepMetamorphosis(dt: number, input: Dir | null, events: TreeEvent[]): number {
    const before = this.sunAngle(), was = this.wonT;
    this.wonT += dt;
    const now = this.sunAngle();
    // Sunsets at π (mod 2π), sunrises at 2π.
    const crossed = (at: number) => Math.floor((before - at) / (Math.PI * 2)) !== Math.floor((now - at) / (Math.PI * 2));
    if (this.wonT < EMERGE_AT + 0.1) {
      if (crossed(Math.PI)) events.push({ type: 'sunset' });
      if (crossed(0)) events.push({ type: 'sunrise' });
    }
    if (was < EMERGE_AT && this.wonT >= EMERGE_AT) events.push({ type: 'emerge' });
    if (was < this.gustAt && this.wonT >= this.gustAt) events.push({ type: 'gust' });
    if (was < this.gustAt + GUST_TIME && this.wonT >= this.gustAt + GUST_TIME) events.push({ type: 'blownAway' });
    if (this.wonT >= this.gustAt) {
      // Swept off sideways and up, helplessly.
      const k = this.wonT - this.gustAt;
      this.fly.x += (8 + k * 25) * dt;
      this.fly.y += (3 + Math.sin(k * 9) * 6) * dt;
      return 0;
    }
    if (this.wonT >= FLY_AT && input) {
      const step = FLY_SPEED * dt;
      const [dx, dy] = input === 'left' ? [-1, 0] : input === 'right' ? [1, 0] : input === 'up' ? [0, 1] : [0, -1];
      this.fly.x = Math.max(-25, Math.min(25, this.fly.x + dx * step));
      this.fly.y = Math.max(TREE_H - 15, Math.min(TREE_H + 20, this.fly.y + dy * step));
      this.moving = true;
    }
    return 0;
  }

  /** The skip button: up to the sparkles; or, in the cocoon, straight to the pigeon. */
  skipAhead(events: TreeEvent[]): number {
    if (!this.won) {
      this.t = Math.max(this.t, MORPH_TIME);
      this.path = Array.from({ length: CAT_SEGMENTS * 3 }, (_, i) => ({ x: SPARKLES.x - i * 0.05, y: SPARKLES.y }));
      return this.startCocoon(events);
    }
    if (this.wonT < EMERGE_AT) {
      this.wonT = EMERGE_AT - 1e-6;
      this.stepMetamorphosis(2e-6, null, events);
    } else if (this.wonT < this.gustAt) {
      this.wonT = this.gustAt - 1e-6; // straight to the gust of wind
      this.stepMetamorphosis(2e-6, null, events);
    }
    return 0;
  }

  /** Caught by the wind (or already gone)? */
  get gusting(): boolean {
    return this.won && this.wonT >= this.gustAt;
  }

  /** Has it come out of the cocoon yet? */
  get emerged(): boolean {
    return this.won && this.wonT >= EMERGE_AT;
  }

  /** Each body segment's position, spaced along the path behind the head. */
  segments(): { x: number; y: number }[] {
    const spacing = CAT_SPACING * this.size();
    const out = [{ ...this.head }];
    let need = spacing, prev = this.head;
    for (const p of this.path) {
      let d = Math.hypot(p.x - prev.x, p.y - prev.y);
      while (d >= need && out.length < CAT_SEGMENTS) {
        const k = need / d;
        prev = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
        out.push(prev);
        d = Math.hypot(p.x - prev.x, p.y - prev.y);
        need = spacing;
      }
      need -= d;
      prev = p;
      if (out.length >= CAT_SEGMENTS) break;
    }
    while (out.length < CAT_SEGMENTS) out.push({ ...out[out.length - 1] });
    return out;
  }
}
