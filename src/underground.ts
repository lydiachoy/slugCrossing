// Act three: an earthworm, underground, seen side-on. Dirt is solid until the worm
// digs through it, leaving tunnels it can crawl back through quickly. Stones can't
// be dug. Coordinates: x across (0 … UG_W), y up (0 at the bottom, UG_H at the surface).

import type { Dir } from './sim.ts';

export const UG_W = 64;
export const UG_H = 24;
export const CELL = 0.25; // the dirt is tracked in cells this big
export const COLS = UG_W / CELL;
export const ROWS_UG = UG_H / CELL;
export const DIG_SPEED = 1.3; // through solid dirt
export const CRAWL_SPEED = 3.2; // along a tunnel already dug
const TURN_RATE = 12; // radians per second
const PIVOT = 0.5; // turning more than this, it pivots on the spot first (so a U-turn goes back down its own tunnel)
const DIG_R = 0.32; // tunnel radius
export const SEGMENTS = 16;
export const SEG_SPACING = 0.17;
export const WORM_START = { x: UG_W / 2, y: UG_H - 1.6 };

const DIRT = 0, OPEN = 1, STONE = 2;

export interface Stone {
  x: number;
  y: number;
  r: number;
}

/** A buried curiosity, drawn into the dirt (bones, pebbles, a lost coin…). */
export interface Buried {
  kind: 'bone' | 'pebble' | 'coin' | 'fossil';
  x: number;
  y: number;
  rot: number;
}

/** A mole, asleep in its burrow. Bump into one and it wakes up, grabs the worm and eats it. */
export interface Mole {
  x: number;
  y: number;
  r: number;
  state: 'asleep' | 'roaming' | 'chasing' | 'waking' | 'eating' | 'full';
  /** Seconds into the current state. */
  t: number;
  /** Asleep: seconds until it wakes up for a burrow about. */
  wakeIn: number;
  /** Roaming: which way it's tunnelling (radians), and for how much longer. */
  dir: number;
  roamLeft: number;
}
export const MOLE_COUNT = 12;
export const MOLE_CHAMBER = 0.95; // radius of the hollow each one sleeps in
export const MOLE_WAKE = 0.6; // jolting awake, worm in its grip
export const MOLE_EAT = 1.8; // slurping it down, segment by segment
const MOLE_NAP = 3; // full and sleepy, then back to sleep
export const MOLE_SLEEP = [5, 30] as const; // seconds asleep before it wakes for a wander
export const MOLE_ROAM = [2, 5] as const; // seconds spent tunnelling before settling down again
export const MOLE_SPEED = 2.2; // twice a worm's digging pace
export const MOLE_TUNNEL = 0.5; // the radius of a mole's tunnel (wider than a worm's)
/** An awake mole that spots the worm ahead of it gives chase, until the worm gets far enough away. */
export const MOLE_SIGHT = 5; // how far ahead it notices the worm…
const MOLE_SIGHT_ANGLE = 0.9; // …within this much (radians) either side of where it's heading
export const MOLE_CHASE_SPEED = 2.6; // faster than the worm digs (1.3), slower than it crawls a tunnel (3.2)
export const MOLE_GIVE_UP = 8; // the worm's got away
const MOLE_TURN = 3.5; // radians per second, steering after it
const RESPAWN_TIME = 0.8; // after being swallowed

export type UndergroundEvent =
  | { type: 'dig' }
  | { type: 'bonk' }
  | { type: 'moleWake' }
  | { type: 'moleRoam' }
  | { type: 'moleSettle' }
  | { type: 'moleChase' }
  | { type: 'moleGiveUp' }
  | { type: 'moleChomp' }
  | { type: 'wormEaten' }
  | { type: 'wormRespawn' }
  | { type: 'birdDive' }
  | { type: 'birdSnatch' }
  | { type: 'birdMiss' }
  | { type: 'bananaFound' }
  | { type: 'wormGrow' }
  | { type: 'surfaced' };

/** Too close to the surface, and a bird swoops on you. */
export const SURFACE_DANGER = 1.25; // within this of the surface, the worm can be seen from above
export const UG_BIRD_DIVE = 1.3; // seconds from the screech to the strike: time to get deeper
const UG_BIRD_LEAVE = 1.5; // flying off with its catch (or without)
const UG_BIRD_COOLDOWN = 2.5; // before another will come
export interface SkyBird {
  phase: 'diving' | 'leaving';
  t: number;
  /** Where it strikes. */
  x: number;
  /** Did it get the worm? */
  caught: boolean;
}

/** The goal: a rotten banana, buried somewhere deep. Find it and win the trophy. */
export const BANANA_REACH = 0.6;
/** After finding it: eat it, grow to twice the size, then bulldoze straight up to the surface. */
export const BANANA_EAT = 1.6; // seconds munching the banana
export const WORM_GROW = 1.2; // …swelling up to twice the size
export const RISE_SPEED = 3.2; // …then digging up, fast
export const BIG_WORM = 2; // how much bigger it ends up

const ANGLE: Record<Dir, number> = { right: 0, up: Math.PI / 2, left: Math.PI, down: -Math.PI / 2 };

export class Underground {
  cells: Uint8Array = new Uint8Array(COLS * ROWS_UG);
  stones: Stone[] = [];
  buried: Buried[] = [];
  head = { ...WORM_START };
  heading = -Math.PI / 2;
  moving = false;
  digging = false;
  /** The path the head has taken (newest first); the body follows it. */
  path: { x: number; y: number }[] = [];
  /** Every spot dug, in order: the view carves its tunnels from this. */
  digLog: { x: number; y: number; r?: number }[] = [];
  dugCells = 0;
  moles: Mole[] = [];
  /** The worm: free to dig, in a mole's grip (and being eaten), or swallowed (about to respawn). */
  /** Free; held by a mole; snatched by a bird; swallowed (about to respawn); or victorious. */
  wormState: 'free' | 'caught' | 'snatched' | 'eaten' | 'won' = 'free';
  bird: SkyBird | null = null;
  private birdCooldown = 0;
  banana = { x: 0, y: 0 };
  /** Seconds since the banana was found (when won). */
  wonT = 0;
  wormT = 0;
  /** Which mole has it (an index into moles), while caught. */
  captor = -1;
  private digSound = 0;
  private bonkSound = 0;
  private rngState: number;

  constructor(seed: number) {
    this.rngState = seed >>> 0;
    for (let tries = 0; this.stones.length < 30 && tries < 600; tries++) {
      const r = 0.35 + this.rng() ** 2 * 1.1;
      const x = 1 + this.rng() * (UG_W - 2);
      const y = 1 + this.rng() * (UG_H - 3.5);
      const clearOfStart = Math.hypot(x - WORM_START.x, y - WORM_START.y) > r + 3;
      if (clearOfStart && this.stones.every((s) => Math.hypot(s.x - x, s.y - y) > s.r + r + 0.6)) this.stones.push({ x, y, r });
    }
    for (const s of this.stones) this.fill(s.x, s.y, s.r, STONE);
    const kinds: Buried['kind'][] = ['bone', 'bone', 'pebble', 'pebble', 'pebble', 'coin', 'fossil'];
    for (let i = 0; i < 70; i++) {
      this.buried.push({ kind: kinds[Math.floor(this.rng() * kinds.length)], x: this.rng() * UG_W, y: this.rng() * (UG_H - 1.5), rot: this.rng() * Math.PI });
    }
    // Moles, each asleep in its own little chamber, well away from where the worm lands.
    for (let tries = 0; this.moles.length < MOLE_COUNT && tries < 3000; tries++) {
      const r = 0.55;
      const x = 2 + this.rng() * (UG_W - 4);
      const y = 1.5 + this.rng() * (UG_H - 4);
      const clear = Math.hypot(x - WORM_START.x, y - WORM_START.y) > 6
        && this.stones.every((s) => Math.hypot(s.x - x, s.y - y) > s.r + r + 0.8)
        && this.moles.every((m) => Math.hypot(m.x - x, m.y - y) > 4);
      if (clear) this.moles.push({ x, y, r, state: 'asleep', t: this.rng() * 5, wakeIn: this.between(MOLE_SLEEP), dir: 0, roamLeft: 0 });
    }
    for (const m of this.moles) this.open(m.x, m.y, MOLE_CHAMBER);
    // The rotten banana: deep down, far from where the worm lands, clear of stones and moles.
    for (let tries = 0; tries < 2000; tries++) {
      const x = 2 + this.rng() * (UG_W - 4), y = 1.5 + this.rng() * (UG_H * 0.5);
      const ok = Math.hypot(x - WORM_START.x, y - WORM_START.y) > 16
        && this.stones.every((st) => Math.hypot(st.x - x, st.y - y) > st.r + 1)
        && this.moles.every((m) => Math.hypot(m.x - x, m.y - y) > MOLE_CHAMBER + 1.5);
      if (ok || tries === 1999) {
        this.banana = { x, y };
        break;
      }
    }
    // Where the worm landed from the portal: a little pocket just under the surface.
    this.dig(WORM_START.x, WORM_START.y, 0.6);
    for (let i = 0; i < SEGMENTS * 3; i++) this.path.push({ x: WORM_START.x, y: WORM_START.y + i * 0.02 });
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }

  private rng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  cell(x: number, y: number): number {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS_UG) return STONE;
    return this.cells[r * COLS + c];
  }

  isOpen(x: number, y: number): boolean {
    return this.cell(x, y) === OPEN;
  }

  /** Set every cell within `radius` of (x, y) (that isn't stone) to `to`; returns how many changed. */
  private fill(x: number, y: number, radius: number, to: number): number {
    let changed = 0;
    const c0 = Math.max(0, Math.floor((x - radius) / CELL)), c1 = Math.min(COLS - 1, Math.floor((x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((y - radius) / CELL)), r1 = Math.min(ROWS_UG - 1, Math.floor((y + radius) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * COLS + c;
        if (Math.hypot((c + 0.5) * CELL - x, (r + 0.5) * CELL - y) > radius) continue;
        if (this.cells[i] === to || (to === OPEN && this.cells[i] === STONE)) continue;
        this.cells[i] = to;
        changed++;
      }
    }
    return changed;
  }

  private dig(x: number, y: number, radius = DIG_R): number {
    const n = this.fill(x, y, radius, OPEN);
    if (n > 0) {
      this.dugCells += n;
      this.digLog.push({ x, y });
    }
    return n;
  }

  /** Hollow out a space (a mole's chamber or tunnel) without counting it as the worm's digging. */
  private open(x: number, y: number, radius: number): void {
    this.fill(x, y, radius, OPEN);
    this.digLog.push({ x, y, r: radius });
  }

  /** Undug dirt just past the end of the tunnel, where the head is going? */
  private dirtAhead(): boolean {
    const cx = Math.cos(this.heading), cy = Math.sin(this.heading);
    // (Cells are cleared if their centres are within DIG_R, so a cleared cell can reach half a cell further.)
    const reach = DIG_R + CELL * 0.75;
    const ax = this.head.x + cx * reach, ay = this.head.y + cy * reach;
    // Only straight ahead: brushing a tunnel wall shouldn't slow it down.
    return this.cell(ax, ay) === DIRT;
  }

  private hitsStone(x: number, y: number): boolean {
    return this.stones.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + 0.18);
  }

  /** The moles' side of things, and the worm's fate if one has it. */
  private stepMoles(dt: number, events: UndergroundEvent[]): void {
    for (const m of this.moles) {
      m.t += dt;
      if (m.state === 'asleep') {
        if ((m.wakeIn -= dt) <= 0) {
          // Time for a burrow about.
          Object.assign(m, { state: 'roaming', t: 0, dir: this.rng() * Math.PI * 2, roamLeft: this.between(MOLE_ROAM) });
          events.push({ type: 'moleRoam' });
        }
      } else if (m.state === 'roaming' || m.state === 'chasing') this.roam(m, dt, events);
      else if (m.state === 'waking' && m.t >= MOLE_WAKE) Object.assign(m, { state: 'eating', t: 0 });
      else if (m.state === 'eating') {
        if (Math.floor((m.t - dt) / 0.3) !== Math.floor(m.t / 0.3)) events.push({ type: 'moleChomp' });
        if (m.t >= MOLE_EAT) {
          Object.assign(m, { state: 'full', t: 0 });
          this.wormState = 'eaten';
          this.wormT = 0;
          this.captor = -1;
          events.push({ type: 'wormEaten' });
        }
      } else if (m.state === 'full' && m.t >= MOLE_NAP) this.sleep(m);
    }
    if (this.wormState === 'eaten') {
      this.wormT += dt;
      if (this.wormT >= RESPAWN_TIME) this.respawn(events);
    }
  }

  /** How big the worm is: 1, swelling to BIG_WORM after it eats the banana. */
  wormScale(): number {
    if (this.wormState !== 'won') return 1;
    const k = Math.min(1, Math.max(0, (this.wonT - BANANA_EAT) / WORM_GROW));
    return 1 + (BIG_WORM - 1) * k * k * (3 - 2 * k);
  }

  /** How much of the banana is left (1 → 0 as it's eaten). */
  bananaLeft(): number {
    return this.wormState === 'won' ? Math.max(0, 1 - this.wonT / BANANA_EAT) : 1;
  }

  /** The banana feast: eat it, grow, then dig straight up to the surface. */
  private stepFeast(dt: number, events: UndergroundEvent[]): void {
    const before = this.wonT;
    this.wonT += dt;
    if (before < BANANA_EAT && this.wonT >= BANANA_EAT) events.push({ type: 'wormGrow' });
    if (this.wonT < BANANA_EAT + WORM_GROW || this.head.y >= UG_H) return;
    // Up, up, up (a big worm digs a big tunnel; nothing stops it now).
    this.heading = Math.PI / 2;
    this.moving = true;
    this.head.y = Math.min(UG_H, this.head.y + RISE_SPEED * dt);
    this.open(this.head.x, this.head.y, DIG_R * BIG_WORM);
    const last = this.path[0];
    if (!last || Math.hypot(last.x - this.head.x, last.y - this.head.y) > 0.04) this.path.unshift({ ...this.head });
    if (this.path.length > SEGMENTS * 16) this.path.length = SEGMENTS * 16;
    if (this.head.y >= UG_H) events.push({ type: 'surfaced' });
  }

  /** The skip button: straight to the banana. */
  skipToBanana(events: UndergroundEvent[]): void {
    if (this.wormState !== 'free') return;
    this.head = { x: this.banana.x, y: this.banana.y + 0.3 };
    this.heading = -Math.PI / 2;
    this.path = Array.from({ length: SEGMENTS * 3 }, (_, i) => ({ x: this.banana.x, y: this.banana.y + 0.3 + i * 0.05 }));
    for (let y = this.banana.y; y < this.banana.y + 3; y += 0.25) this.dig(this.banana.x, y);
    this.findBanana(events);
  }

  private findBanana(events: UndergroundEvent[]): void {
    this.wormState = 'won';
    this.wonT = 0;
    this.moving = false;
    this.bird = null;
    this.dig(this.banana.x, this.banana.y, 0.75); // uncover it fully
    events.push({ type: 'bananaFound' });
  }

  /** Is the worm's head close enough to the surface for a bird to spot it? */
  nearSurface(): boolean {
    return this.head.y > UG_H - SURFACE_DANGER;
  }

  /** A bird overhead: diving when it spots the worm near the surface, striking, then off. */
  private stepBird(dt: number, events: UndergroundEvent[]): void {
    this.birdCooldown -= dt;
    const b = this.bird;
    if (!b) {
      if (this.wormState === 'free' && this.birdCooldown <= 0 && this.nearSurface()) {
        this.bird = { phase: 'diving', t: 0, x: this.head.x, caught: false };
        events.push({ type: 'birdDive' });
      }
      return;
    }
    b.t += dt;
    if (b.phase === 'diving') {
      if (this.wormState === 'free') b.x = this.head.x; // homing in from above
      if (b.t >= UG_BIRD_DIVE) {
        // Strike! If the worm's still up near the surface, the beak goes straight through the dirt.
        b.caught = this.wormState === 'free' && this.head.y > UG_H - SURFACE_DANGER - 0.15;
        Object.assign(b, { phase: 'leaving', t: 0 });
        if (b.caught) {
          for (let y = this.head.y; y < UG_H; y += 0.2) this.open(this.head.x, y, 0.3);
          this.wormState = 'snatched';
          this.wormT = 0;
          events.push({ type: 'birdSnatch' });
        } else events.push({ type: 'birdMiss' });
      }
    } else if (b.t >= UG_BIRD_LEAVE) {
      this.bird = null;
      this.birdCooldown = UG_BIRD_COOLDOWN;
      if (this.wormState === 'snatched') {
        this.wormState = 'eaten';
        this.wormT = RESPAWN_TIME; // straight back to the start
      }
    }
  }

  /** A mole tunnelling along: through dirt, turning aside from stones and the edges, and woe betide any worm in its way. */
  private roam(m: Mole, dt: number, events: UndergroundEvent[]): void {
    const dx = this.head.x - m.x, dy = this.head.y - m.y, dist = Math.hypot(dx, dy);
    const toWorm = Math.atan2(dy, dx);
    const off = Math.abs(Math.atan2(Math.sin(toWorm - m.dir), Math.cos(toWorm - m.dir)));
    if (m.state === 'roaming' && this.wormState === 'free' && dist < MOLE_SIGHT && off < MOLE_SIGHT_ANGLE) {
      m.state = 'chasing'; // there's the worm!
      events.push({ type: 'moleChase' });
    } else if (m.state === 'chasing' && (dist > MOLE_GIVE_UP || this.wormState !== 'free')) {
      Object.assign(m, { state: 'roaming', roamLeft: 1.5 }); // it got away: grumble off, then back to bed
      events.push({ type: 'moleGiveUp' });
    }
    const chasing = m.state === 'chasing';
    if (chasing) {
      // Steer after the worm's head.
      const turn = Math.atan2(Math.sin(toWorm - m.dir), Math.cos(toWorm - m.dir));
      m.dir += Math.sign(turn) * Math.min(Math.abs(turn), MOLE_TURN * dt);
    } else m.roamLeft -= dt;
    if (!chasing && m.roamLeft <= 0) {
      this.open(m.x, m.y, MOLE_CHAMBER); // dig out a new bedroom…
      this.sleep(m); // …and nod off
      events.push({ type: 'moleSettle' });
      return;
    }
    const step = (chasing ? MOLE_CHASE_SPEED : MOLE_SPEED) * dt;
    let nx = m.x + Math.cos(m.dir) * step, ny = m.y + Math.sin(m.dir) * step;
    const blocked = (x: number, y: number) => x < 1.2 || x > UG_W - 1.2 || y < 1 || y > UG_H - 1.6
      || this.stones.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + m.r + 0.1);
    if (blocked(nx, ny)) {
      // Feel about for another way.
      for (let tries = 0; tries < 8; tries++) {
        m.dir = this.rng() * Math.PI * 2;
        nx = m.x + Math.cos(m.dir) * step;
        ny = m.y + Math.sin(m.dir) * step;
        if (!blocked(nx, ny)) break;
      }
      if (blocked(nx, ny)) return;
    }
    m.x = nx;
    m.y = ny;
    if (!chasing) m.dir += (this.rng() - 0.5) * dt * 1.5; // a slightly wandering line
    if (Math.floor((m.t - dt) / 0.12) !== Math.floor(m.t / 0.12)) this.open(m.x, m.y, MOLE_TUNNEL);
    // Ran into the worm? Supper.
    if (this.wormState === 'free' && this.segments().some((p) => Math.hypot(p.x - m.x, p.y - m.y) < m.r + 0.25)) this.catchWorm(this.moles.indexOf(m), events);
  }

  private sleep(m: Mole): void {
    Object.assign(m, { state: 'asleep', t: 0, wakeIn: this.between(MOLE_SLEEP) });
  }

  private catchWorm(mole: number, events: UndergroundEvent[]): void {
    Object.assign(this.moles[mole], { state: 'waking', t: 0 });
    this.wormState = 'caught';
    this.wormT = 0;
    this.captor = mole;
    this.moving = false;
    events.push({ type: 'moleWake' });
  }

  /** Back where it first landed. (Its tunnels are all still there.) */
  private respawn(events: UndergroundEvent[]): void {
    this.wormState = 'free';
    this.wormT = 0;
    this.head = { ...WORM_START };
    this.heading = -Math.PI / 2;
    this.path = Array.from({ length: SEGMENTS * 3 }, (_, i) => ({ x: WORM_START.x, y: WORM_START.y + i * 0.02 }));
    events.push({ type: 'wormRespawn' });
  }

  /** A mole the head would touch at (x, y)? */
  private moleAt(x: number, y: number): number {
    return this.moles.findIndex((m) => Math.hypot(m.x - x, m.y - y) < m.r + 0.2);
  }

  /** Returns how many new cells were dug this step. */
  update(dt: number, input: Dir | null, events: UndergroundEvent[]): number {
    this.digSound -= dt;
    this.bonkSound -= dt;
    this.digging = false;
    this.stepMoles(dt, events);
    this.stepBird(dt, events);
    if (this.wormState === 'won') {
      this.moving = false;
      this.stepFeast(dt, events); // (sets moving while it digs up)
      return 0;
    }
    if (this.wormState !== 'free') {
      this.moving = false;
      return 0;
    }
    this.moving = input !== null;
    if (!input) return 0;
    // Steer smoothly towards the direction pressed.
    const target = ANGLE[input];
    const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    if (Math.abs(diff) > PIVOT) return 0;
    const inDirt = this.dirtAhead();
    const step = (inDirt ? DIG_SPEED : CRAWL_SPEED) * dt;
    const nx = this.head.x + Math.cos(this.heading) * step;
    const ny = Math.min(UG_H - 0.45, Math.max(0.35, this.head.y + Math.sin(this.heading) * step));
    const mole = this.moleAt(nx, ny);
    if (mole >= 0 && (this.moles[mole].state === 'asleep' || this.moles[mole].state === 'roaming')) {
      this.catchWorm(mole, events); // woken up (or bumped into) — and it's hungry
      return 0;
    }
    // An awake mole, a stone, or the edge of the world: no way through.
    if (mole >= 0 || this.hitsStone(nx, ny) || nx < 0.35 || nx > UG_W - 0.35) {
      this.moving = false;
      if (this.bonkSound <= 0) {
        this.bonkSound = 0.6;
        events.push({ type: 'bonk' });
      }
      return 0;
    }
    this.head.x = nx;
    this.head.y = ny;
    const dug = this.dig(nx, ny);
    // Found it: the rotten banana!
    if (Math.hypot(this.banana.x - nx, this.banana.y - ny) < BANANA_REACH) this.findBanana(events);
    if (dug > 0) {
      this.digging = true;
      if (this.digSound <= 0) {
        this.digSound = 0.14;
        events.push({ type: 'dig' });
      }
    }
    const last = this.path[0];
    if (!last || Math.hypot(last.x - nx, last.y - ny) > 0.04) {
      this.path.unshift({ x: nx, y: ny });
      if (this.path.length > SEGMENTS * 16) this.path.length = SEGMENTS * 16;
    }
    return dug;
  }

  /** Where each body segment is: spaced out along the path behind the head. */
  segments(): { x: number; y: number }[] {
    const spacing = SEG_SPACING * this.wormScale(); // a bigger worm is a longer worm
    const out = [{ ...this.head }];
    let need = spacing, prev = this.head;
    for (const p of this.path) {
      let d = Math.hypot(p.x - prev.x, p.y - prev.y);
      while (d >= need && out.length < SEGMENTS) {
        const k = need / d;
        prev = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
        out.push(prev);
        d = Math.hypot(p.x - prev.x, p.y - prev.y);
        need = spacing;
      }
      need -= d;
      prev = p;
      if (out.length >= SEGMENTS) break;
    }
    while (out.length < SEGMENTS) out.push({ ...out[out.length - 1] });
    return out;
  }

  /** Share of all diggable dirt that's been dug, 0 … 1. */
  dugShare(): number {
    let diggable = 0;
    for (const c of this.cells) if (c !== STONE) diggable++;
    return this.dugCells / diggable;
  }
}
