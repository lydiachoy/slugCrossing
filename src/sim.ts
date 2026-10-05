// Slug Crossing: the game rules, with no rendering, so they can be tested headless.
// Coordinates: x runs left→right across the road (0 is the middle), y runs from the
// start verge (row 0) up to the lettuce patch (GOAL_ROW). One unit is one lane.

import { GARDEN_START, Garden, type GardenEvent } from './garden.ts';
import { GOAL_ROW, HALF_W, ROWS, type RowKind } from './layout.ts';
export { GOAL_ROW, HALF_W, ROWS, type RowKind };

export const SLUG_SPEED = 0.9; // lanes per second. Traffic does 12–26.
export const LIVES = 10;
/** Lettuce patches along the goal row; the slug has to crawl into a free one. */
export const SLOTS: readonly number[] = [-6, -3, 0, 3, 6];
const SLOT_HALF = 0.6;

const MOISTURE_DRAIN = 4.5; // per second on asphalt (out of 100)
const MOISTURE_REFILL = 30; // per second on grass
export const DEATH_TIME = 2.2; // long enough for the slug's soul to float away
/** The victory chomp at the lettuce, before the next slug sets off. */
export const MUNCH_TIME = 2;
/** Vehicles spawn this far beyond the edge, so they visibly drive in. */
export const SPAWN_MARGIN = 6;
/** How long before a vehicle reaches the playfield its lane flashes a warning. */
export const WARN_TIME = 0.8;

/** The first road has a traffic light, with a crosswalk across the middle. */
export const LIGHT_ROWS: readonly number[] = [1, 2, 3, 4];
export const CROSSWALK_HALF = 1.2; // the crosswalk spans x = -1.2 … 1.2
const STOP_GAP = 0.25; // cars stop this far short of the crosswalk
export const RED_TIME = [3, 10] as const; // seconds, picked at random each time
export const GREEN_TIME = [5, 20] as const;
const BRAKE = 45; // lanes per second², hard but not instant
const ACCEL = 18;
const QUEUE_GAP = 0.35; // bumper to bumper in a queue
const MOVING = 0.5; // below this a vehicle is stopped: it blocks the slug rather than squishing it

export interface Light {
  red: boolean;
  /** Seconds until it changes. */
  timer: number;
}

/** Power-ups: slow-mo (appears on the second road once the slug reaches the median) and 1UPs. */
export const SLOWMO_TIME = 8;
export const SLOW_TRAFFIC = 0.35; // traffic runs at this fraction of its speed in slow-mo
const PICKUP_REACH = 0.45;
const MAX_ONE_UPS = 4;
export type PowerupKind = 'slow' | 'life';
export interface Powerup {
  id: number;
  kind: PowerupKind;
  x: number;
  y: number;
}

/** Salt trucks: every so often one drives down a lane, salting the road behind it. */
export const DUMP_EVERY = [30, 60] as const;
export const SALT_LIFE = 5; // seconds a patch of salt lasts
const SALT_SPACING = 0.2;
const SALT_HALF_W = 0.15;
export interface Salt {
  id: number;
  row: number;
  x: number;
  /** Seconds left before it's gone. */
  t: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';
export type VehicleKind = 'car' | 'sports' | 'van' | 'truck' | 'dumptruck';
export const VEHICLE_LEN: Record<VehicleKind, number> = { car: 1.8, sports: 1.6, van: 2.4, truck: 3.6, dumptruck: 3.2 };
const VEHICLE_HALF_H = 0.34;

interface LaneDef {
  row: number;
  speed: number; // signed: + drives right, - drives left
  kinds: VehicleKind[]; // picked at random (repeats weight a kind)
}

const LANES: readonly LaneDef[] = [
  { row: 1, speed: 13, kinds: ['car', 'car', 'van'] },
  { row: 2, speed: -18, kinds: ['car', 'sports', 'van'] },
  { row: 3, speed: 15, kinds: ['car', 'van', 'truck'] },
  { row: 4, speed: -22, kinds: ['sports', 'car'] },
  { row: 6, speed: -16, kinds: ['car', 'van'] },
  { row: 7, speed: 26, kinds: ['sports'] },
  { row: 8, speed: -12, kinds: ['truck', 'truck', 'van'] },
  { row: 9, speed: 20, kinds: ['car', 'sports', 'car'] },
];

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  row: number;
  x: number; // centre
  len: number;
  /** Cruising velocity, signed: + drives right. */
  speed: number;
  /** Current speed (0 … |speed|): vehicles brake for the light and queue behind each other. */
  vel: number;
  /** Too close to stop when the light went red, so it carries on through. */
  runsLight: boolean;
  /** Which side of the slug it was on last step, for near-miss whooshes. */
  side: number;
  /** A salt truck, and where it last dropped salt. */
  salty?: boolean;
  lastSalt?: number;
}

export interface Slug {
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  moisture: number; // 0–100; at 0 the slug dries up
}

/**
 * A rival slug that turns up now and then and tries to cross too. If it gets to a
 * lettuce first, it eats that patch.
 */
export interface Npc {
  id: number;
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  /** Which colour of slug (1–3; 0 is the player's). */
  color: number;
  state: 'waiting' | 'crawling' | 'munching' | 'dying' | 'flung';
  /** Seconds left waiting / munching / dying. */
  timer: number;
  /** The lettuce patch it's eating, while munching. */
  slot: number;
  /** How it died, while dying. */
  cause?: 'squished' | 'salted';
  /** Bounced off the player: flying off the map (z is height). */
  fling?: { vx: number; vy: number; vz: number; z: number };
}
const NPC_SPEED = 0.8;
const NPC_MAX = 2;
const NPC_EVERY = [10, 22] as const; // seconds between arrivals
export const NPC_COLORS = 3;

/**
 * Every 15 s – 1 min a bird swoops on the slug. Mash space fast enough and it drops
 * you at the next checkpoint; too slow and it eats you (back to the very start).
 */
export const BIRD_EVERY = [15, 60] as const;
export const BIRD_DIVE = 1.1; // seconds of shadow before the grab
export const MASH_TIME = 3.5; // seconds to fight free
export const MASH_PER_PRESS = 0.1;
export const MASH_DECAY = 0.15; // per second: about 5 presses a second does it
export const BIRD_CARRY = 1.3; // seconds flying to the drop point
export interface Bird {
  phase: 'diving' | 'carrying' | 'dropping' | 'leaving';
  /** Seconds into this phase. */
  t: number;
  /** Where it's diving to / hovering over (follows the slug while diving). */
  x: number;
  y: number;
  /** 0 … 1: how close the slug is to wriggling free. */
  mash: number;
  /** Where it's dropping the slug: a grass row, or a lettuce patch. */
  dropX?: number;
  dropY?: number;
  dropSlot?: number;
  /** Did it fly off with the slug (eaten) or without (dropped it)? */
  ate?: boolean;
}

/** All five lettuces eaten: a golden shell falls from the heavens and the slug becomes a snail. */
export const SHELL_FALL = 2.2; // seconds for the shell to come down
export const ASCEND_TIME = 4.6; // …and then the snail glides up into the garden
export const SNAIL_BONUS = 1000;

export type GameState = 'ready' | 'playing' | 'munching' | 'grabbed' | 'dying' | 'ascending' | 'garden' | 'gameOver';
export type DeathCause = 'squished' | 'dried' | 'salted' | 'eaten';

export type GameEvent =
  | { type: 'whoosh'; x: number; y: number; closeness: number }
  | { type: 'squish'; x: number; y: number }
  | { type: 'dried'; x: number; y: number }
  | { type: 'salted'; x: number; y: number }
  | { type: 'lane'; row: number }
  | { type: 'powerup'; kind: PowerupKind; x: number; y: number }
  | { type: 'pickup'; kind: PowerupKind }
  | { type: 'slowmoEnd' }
  | { type: 'npcBounce'; id: number }
  | { type: 'npcSalted'; id: number; x: number; y: number }
  | { type: 'dumptruck'; row: number }
  | { type: 'birdDive' }
  | { type: 'birdGrab' }
  | { type: 'mash'; mash: number }
  | { type: 'birdDrop'; slot: number | null }
  | { type: 'eaten' }
  | { type: 'skip' }
  | { type: 'ascend' }
  | { type: 'shellLands' }
  | { type: 'gardenStart' }
  | GardenEvent
  | { type: 'munch'; slot: number }
  | { type: 'npcArrive'; id: number }
  | { type: 'npcSquish'; id: number; x: number; y: number }
  | { type: 'npcMunch'; id: number; slot: number }
  | { type: 'levelUp'; level: number }
  | { type: 'respawn' }
  | { type: 'checkpoint'; row: number }
  | { type: 'light'; red: boolean }
  | { type: 'gameOver'; score: number };

export function rowKind(y: number): RowKind {
  const r = Math.round(y);
  return ROWS[Math.max(0, Math.min(GOAL_ROW, r))];
}

/** Half-size of the slug's hit box: long along the way it faces. */
export function slugHalfSize(facing: Dir): { hx: number; hy: number } {
  return facing === 'up' || facing === 'down' ? { hx: 0.2, hy: 0.36 } : { hx: 0.36, hy: 0.2 };
}

export class Game {
  state: GameState = 'ready';
  level = 1;
  score = 0;
  lives = LIVES;
  /** On by default: dying costs nothing and the game never ends. */
  readonly infiniteLives: boolean;
  slug: Slug = freshSlug();
  vehicles: Vehicle[] = [];
  filled: boolean[] = SLOTS.map(() => false);
  /** Who ate each patch: -1 nobody yet, 0 the player, 1+ an NPC slug's colour. */
  eater: number[] = SLOTS.map(() => -1);
  npcs: Npc[] = [];
  /** Seconds into the player's victory munch, and which patch. */
  munchT = 0;
  munchSlot = -1;
  deathCause: DeathCause | null = null;
  /** Seconds into the current death animation. */
  deathT = 0;
  /** The grass row a slug respawns on: the start, or the median once it's been reached. */
  checkpoint = 0;
  light: Light = { red: false, timer: 0 };
  powerups: Powerup[] = [];
  salt: Salt[] = [];
  /** Seconds of slow-mo left. */
  slowmo = 0;
  private rngState: number;
  /** Road lanes this slug has already got across (for the ding). */
  private cleared: number[] = [];
  private dumpTimer = 0;
  bird: Bird | null = null;
  /** The garden, once the slug has become a snail (null before). */
  garden: Garden | null = null;
  ascendT = 0;
  private ascendFrom = { x: 0, y: 0 };
  private birdTimer = 0;
  private nextId = 1;
  private laneTimers: number[];
  /** Each lane repeats its own rhythm of gaps (seconds), so it can be learned. */
  private lanePatterns: number[][] = [];
  private patternStep: number[] = LANES.map(() => 0);
  private bestRow = 0;
  private npcTimer = 0;

  constructor(seed = 1, opts: { infiniteLives?: boolean } = {}) {
    this.infiniteLives = opts.infiniteLives ?? true;
    this.rngState = seed >>> 0;
    this.laneTimers = LANES.map(() => this.rng() * 2);
    this.newPatterns();
    this.light.timer = this.between(GREEN_TIME);
    // Run the traffic for a while so the road isn't empty at the start.
    this.dumpTimer = this.between(DUMP_EVERY);
    for (let i = 0; i < 600; i++) {
      this.stepLight(1 / 60, []);
      this.stepTraffic(1 / 60, []);
    }
  }

  /** An independent copy, to look ahead (tests use it to check the game is winnable). */
  clone(): Game {
    const c = Object.assign(Object.create(Game.prototype) as Game, structuredClone({ ...this }));
    if (c.garden) Object.setPrototypeOf(c.garden, Garden.prototype);
    return c;
  }

  /** Now a snail? (During the ascension and in the garden.) */
  get isSnail(): boolean {
    return this.state === 'garden' || (this.state === 'ascending' && this.ascendT >= SHELL_FALL);
  }

  /** Small seeded PRNG (mulberry32), so a seed replays the same traffic. */
  private rng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }

  /** Begin (or, after a game over, restart) play. Traffic keeps flowing. */
  start(): void {
    if (this.state === 'gameOver') {
      this.level = 1;
      this.score = 0;
      this.lives = LIVES;
      this.clearPatches();
      this.newPatterns();
    }
    if (this.state === 'ready' || this.state === 'gameOver') {
      this.npcs = [];
      this.npcTimer = this.between([5, 10]);
      this.powerups = [];
      this.salt = [];
      this.slowmo = 0;
      this.bird = null;
      this.birdTimer = this.between(BIRD_EVERY);
      this.checkpoint = 0;
      this.respawn();
      this.state = 'playing';
    }
  }

  /** Advance the game. Call with small steps (main.ts uses 1/120 s). */
  update(dt: number, input: Dir | null): GameEvent[] {
    const events: GameEvent[] = [];
    this.stepLight(dt, events);
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      if (this.slowmo <= 0) {
        this.slowmo = 0;
        events.push({ type: 'slowmoEnd' });
      }
    }
    this.stepTraffic(dt * this.trafficRate(), events);
    const inGarden = this.state === 'ascending' || this.state === 'garden';
    this.stepSalt(dt, events, !inGarden);
    if (inGarden) {
      this.stepGarden(dt, input, events);
      return events;
    }
    if (this.state !== 'ready' && this.state !== 'gameOver') this.stepNpcs(dt, events);
    this.stepBird(dt, events);
    if (this.state === 'playing') this.stepSlug(dt, input, events);
    else if (this.state === 'munching') {
      this.munchT += dt;
      if (this.munchT >= MUNCH_TIME) {
        if (this.allEaten()) this.startAscension(events); // that was the last lettuce!
        else {
          this.checkpoint = 0; // the next slug starts from the bottom again
          this.respawn();
          this.state = 'playing';
          events.push({ type: 'respawn' });
        }
      }
    } else if (this.state === 'dying') {
      this.deathT += dt;
      if (this.deathT >= DEATH_TIME) {
        if (!this.infiniteLives) this.lives--;
        if (this.lives <= 0) {
          this.state = 'gameOver';
          events.push({ type: 'gameOver', score: this.score });
        } else {
          this.respawn();
          this.state = 'playing';
          events.push({ type: 'respawn' });
        }
      }
    }
    return events;
  }

  /** Lanes with a vehicle about to enter: which row and from which side (-1 left, +1 right). */
  warnings(): { row: number; side: number }[] {
    const out: { row: number; side: number }[] = [];
    for (const v of this.vehicles) {
      const front = v.x + Math.sign(v.speed) * v.len / 2;
      const toEdge = (Math.sign(v.speed) > 0 ? -HALF_W - front : front - HALF_W) / (Math.abs(v.speed) * this.trafficRate());
      if (toEdge > 0 && toEdge <= WARN_TIME) out.push({ row: v.row, side: -Math.sign(v.speed) });
    }
    return out;
  }

  private clearPatches(): void {
    this.filled = SLOTS.map(() => false);
    this.eater = SLOTS.map(() => -1);
  }

  /** All five patches eaten (and nobody still chewing): on to the next level. */
  private allEaten(): boolean {
    return this.filled.every(Boolean) && !this.npcs.some((n) => n.state === 'munching');
  }

  /** All five patches eaten (a rival may have had the last one): time to ascend. */
  private checkLevel(events: GameEvent[]): void {
    if (this.state === 'playing' && this.allEaten()) this.startAscension(events);
  }

  private startAscension(events: GameEvent[]): void {
    this.state = 'ascending';
    this.ascendT = 0;
    this.ascendFrom = { x: this.slug.x, y: this.slug.y };
    this.slug.moving = false;
    this.garden = new Garden(Math.floor(this.rng() * 1e9));
    this.npcs = [];
    this.bird = null;
    this.powerups = [];
    if (this.slowmo > 0) {
      this.slowmo = 0;
      events.push({ type: 'slowmoEnd' });
    }
    events.push({ type: 'ascend' });
  }

  private stepGarden(dt: number, input: Dir | null, events: GameEvent[]): void {
    const s = this.slug;
    if (this.state === 'ascending') {
      const before = this.ascendT;
      this.ascendT += dt;
      if (before < SHELL_FALL && this.ascendT >= SHELL_FALL) {
        this.score += SNAIL_BONUS;
        events.push({ type: 'shellLands' });
      }
      // Once it's a snail, it glides up over the hedge to the garden gate.
      const glide = Math.min(1, Math.max(0, (this.ascendT - SHELL_FALL - 0.4) / (ASCEND_TIME - SHELL_FALL - 0.4)));
      const e = glide * glide * (3 - 2 * glide);
      s.x = this.ascendFrom.x + (GARDEN_START.x - this.ascendFrom.x) * e;
      s.y = this.ascendFrom.y + (GARDEN_START.y - this.ascendFrom.y) * e;
      s.facing = glide > 0 ? 'up' : 'down';
      if (this.ascendT >= ASCEND_TIME) {
        this.state = 'garden';
        events.push({ type: 'gardenStart' });
      }
      return;
    }
    const gardenEvents: GardenEvent[] = [];
    this.garden!.update(dt, input, s, gardenEvents);
    for (const e of gardenEvents) {
      if (e.type === 'vegEaten') this.score += e.value;
      events.push(e);
    }
  }

  /** Traffic's time scale: slowed right down during slow-mo. */
  trafficRate(): number {
    return this.slowmo > 0 ? SLOW_TRAFFIC : 1;
  }

  private speedFactor(): number {
    return 1 + 0.12 * (this.level - 1);
  }

  /**
   * Two to four gaps per lane: some convoys (cars bumper to bumper), some openings,
   * and always at least one wide enough for a slug to get through.
   */
  private newPatterns(): void {
    this.lanePatterns = LANES.map(() => {
      const n = 2 + Math.floor(this.rng() * 3);
      const gaps = Array.from({ length: n }, () => (this.rng() < 0.3 ? 0.2 + this.rng() * 0.2 : 1.4 + this.rng() * 2.6));
      gaps[Math.floor(this.rng() * n)] = 3.4 + this.rng() * 1.6;
      return gaps;
    });
  }

  /** Where a vehicle's front bumper has to stop for a red light. */
  static stopLine(dir: number): number {
    return -dir * (CROSSWALK_HALF + STOP_GAP);
  }

  private stepLight(dt: number, events: GameEvent[]): void {
    this.light.timer -= dt;
    if (this.light.timer > 0) return;
    const red = !this.light.red;
    this.light = { red, timer: this.between(red ? RED_TIME : GREEN_TIME) };
    for (const v of this.vehicles) {
      if (!red) v.runsLight = false;
      else if (LIGHT_ROWS.includes(v.row)) {
        // Anyone who can't brake in time before the line goes through it.
        const dir = Math.sign(v.speed);
        const toLine = dir * (Game.stopLine(dir) - (v.x + dir * v.len / 2));
        v.runsLight = toLine > -0.05 && toLine < (v.vel * v.vel) / (2 * BRAKE) + 0.1;
      }
    }
    events.push({ type: 'light', red });
  }

  /** `dt` here is traffic time (slower during slow-mo). */
  private stepTraffic(dt: number, events: GameEvent[]): void {
    const f = this.speedFactor();
    LANES.forEach((lane, i) => {
      this.laneTimers[i] -= dt;
      if (this.laneTimers[i] > 0) return;
      const kind = lane.kinds[Math.floor(this.rng() * lane.kinds.length)];
      const len = VEHICLE_LEN[kind];
      const dir = Math.sign(lane.speed);
      const x = -dir * (HALF_W + SPAWN_MARGIN + len / 2);
      // A queue at the light can back up this far: wait for room.
      if (this.vehicles.some((o) => o.row === lane.row && Math.abs(o.x - x) < (o.len + len) / 2 + QUEUE_GAP + 1)) {
        this.laneTimers[i] = 0.25;
        return;
      }
      this.vehicles.push({
        id: this.nextId++, kind, row: lane.row, len, x,
        speed: lane.speed * f, vel: Math.abs(lane.speed * f), runsLight: false, side: -dir,
      });
      const pattern = this.lanePatterns[i];
      const gap = pattern[this.patternStep[i]++ % pattern.length];
      const pass = (len + 0.6) / Math.abs(lane.speed * f);
      this.laneTimers[i] = pass + gap * Math.max(0.55, Math.pow(0.9, this.level - 1));
    });

    // Drive: each vehicle goes as fast as it can while still being able to stop
    // behind the one ahead, and (on red) at the stop line.
    const byLane = new Map<number, Vehicle[]>();
    for (const v of this.vehicles) {
      if (!byLane.has(v.row)) byLane.set(v.row, []);
      byLane.get(v.row)!.push(v);
    }
    for (const lane of byLane.values()) {
      lane.sort((a, b) => Math.sign(b.speed) * (b.x - a.x)); // leader first
      lane.forEach((v, i) => {
        const dir = Math.sign(v.speed);
        let room = Infinity;
        const leader = lane[i - 1];
        if (leader) room = dir * (leader.x - v.x) - (leader.len + v.len) / 2 - QUEUE_GAP;
        if (this.light.red && !v.runsLight && LIGHT_ROWS.includes(v.row)) {
          const toLine = dir * (Game.stopLine(dir) - (v.x + dir * v.len / 2));
          if (toLine > -0.05) room = Math.min(room, toLine);
        }
        room = Math.max(0, room);
        const target = Math.min(Math.abs(v.speed), Math.sqrt(2 * BRAKE * room));
        v.vel = v.vel < target ? Math.min(target, v.vel + ACCEL * dt) : target;
        v.x += dir * Math.min(v.vel * dt, room);
        // A salt truck sprinkles the lane behind it while it's on the playfield.
        if (v.salty && Math.abs(v.x) < HALF_W + 1 && Math.abs(v.x - (v.lastSalt ?? -999)) >= SALT_SPACING) {
          this.salt.push({ id: this.nextId++, row: v.row, x: v.x - dir * (v.len / 2 + 0.1), t: SALT_LIFE });
          v.lastSalt = v.x;
        }
      });
    }

    const s = this.slug;
    const alive = this.state === 'playing';
    for (const v of this.vehicles) {
      const side = Math.sign(v.x - s.x) || v.side;
      if (alive && side !== v.side && v.vel > 3 && Math.abs(v.row - s.y) < 1.3) {
        events.push({ type: 'whoosh', x: s.x, y: v.row, closeness: 1 - Math.abs(v.row - s.y) / 1.3 });
      }
      v.side = side;
    }
    const limit = HALF_W + SPAWN_MARGIN + 4;
    this.vehicles = this.vehicles.filter((v) => Math.abs(v.x) < limit);
  }

  private stepSlug(dt: number, input: Dir | null, events: GameEvent[]): void {
    const s = this.slug;
    const before = { x: s.x, y: s.y, facing: s.facing };
    s.moving = input !== null;
    if (input) {
      s.facing = input;
      const step = SLUG_SPEED * (this.slowmo > 0 ? 2 : 1) * dt;
      if (input === 'up') s.y += step;
      else if (input === 'down') s.y -= step;
      else if (input === 'left') s.x -= step;
      else s.x += step;
    }
    s.x = Math.max(-HALF_W + 0.45, Math.min(HALF_W - 0.45, s.x));
    s.y = Math.max(0, s.y);
    // A car stopped at the light is just an obstacle: the slug can't crawl into it.
    if (this.vehicles.some((v) => v.vel < MOVING && this.touches(v))) {
      Object.assign(s, before);
      s.moving = false;
    }

    // The goal row: only a free lettuce patch lets the slug in; the hedge blocks the rest.
    if (s.y > GOAL_ROW - 0.55) {
      const slot = SLOTS.findIndex((sx, i) => !this.filled[i] && Math.abs(s.x - sx) <= SLOT_HALF);
      if (slot < 0) s.y = GOAL_ROW - 0.55;
      else {
        this.startMunch(slot, events);
        return;
      }
    }

    // A ding for each lane safely crossed.
    for (let r = 1; r < GOAL_ROW; r++) {
      if (ROWS[r] === 'road' && s.y >= r + 0.7 && !this.cleared.includes(r)) {
        this.cleared.push(r);
        events.push({ type: 'lane', row: r });
      }
    }

    // Power-ups.
    for (const p of this.powerups) {
      if (Math.abs(p.x - s.x) > PICKUP_REACH || Math.abs(p.y - s.y) > PICKUP_REACH) continue;
      p.id = -1;
      if (p.kind === 'slow') this.slowmo = SLOWMO_TIME;
      else this.lives++;
      events.push({ type: 'pickup', kind: p.kind });
    }
    this.powerups = this.powerups.filter((p) => p.id >= 0);

    // Rival slugs never share the player's space: bump one and it goes flying.
    for (const n of this.npcs) {
      if ((n.state === 'waiting' || n.state === 'crawling') && Math.abs(n.x - s.x) < 0.5 && Math.abs(n.y - s.y) < 0.6) {
        this.fling(n, events);
      }
    }

    // Points for new ground, like Frogger.
    const row = Math.floor(s.y + 0.5);
    if (row > this.bestRow) {
      this.score += 10 * (row - this.bestRow);
      this.bestRow = row;
    }

    // Safely across a road onto the median: that's where the next slug will start.
    const grassRow = Math.round(s.y);
    if (ROWS[grassRow] === 'grass' && grassRow > this.checkpoint && s.y >= grassRow - 0.2) {
      this.reachCheckpoint(grassRow, events);
    }

    // Asphalt dries a slug out; grass soaks it back up.
    const kind = rowKind(s.y);
    if (kind === 'road') s.moisture -= MOISTURE_DRAIN * dt;
    else if (kind === 'grass') s.moisture = Math.min(100, s.moisture + MOISTURE_REFILL * dt);
    if (s.moisture <= 0) {
      s.moisture = 0;
      this.die('dried', events);
      return;
    }

    // A moving one squishes it (including a queue pulling away when the light goes green).
    if (this.vehicles.some((v) => v.vel >= MOVING && this.touches(v))) this.die('squished', events);
    // Salt shrivels a slug on the spot.
    else if (this.salt.some((p) => this.inSalt(p, s))) this.die('salted', events);
  }

  /** Victory: turn to the camera and chomp (safe from traffic up here). */
  private startMunch(slot: number, events: GameEvent[]): void {
    const s = this.slug;
    this.filled[slot] = true;
    this.eater[slot] = 0;
    this.score += 50 + Math.round(s.moisture);
    this.state = 'munching';
    this.munchT = 0;
    this.munchSlot = slot;
    Object.assign(s, { x: SLOTS[slot], y: GOAL_ROW - 0.4, facing: 'down', moving: false });
    events.push({ type: 'munch', slot });
  }

  private reachCheckpoint(row: number, events: GameEvent[]): void {
    this.checkpoint = row;
    this.cleared = ROWS.map((_, r) => r).filter((r) => r < row);
    this.bestRow = Math.max(this.bestRow, row);
    events.push({ type: 'checkpoint', row });
    // A slow-mo power-up appears somewhere on the next road.
    const road: number[] = [];
    for (let r = row + 1; r < GOAL_ROW && ROWS[r] === 'road'; r++) road.push(r);
    if (road.length) this.spawnPowerup('slow', road[Math.floor(this.rng() * road.length)], events);
  }

  // ---- the bird ----------------------------------------------------------------

  /** A press of the space bar while in the bird's grip. */
  mash(events: GameEvent[] = []): GameEvent[] {
    const b = this.bird;
    if (this.state !== 'grabbed' || !b || b.phase !== 'carrying') return events;
    b.mash = Math.min(1, b.mash + MASH_PER_PRESS);
    events.push({ type: 'mash', mash: b.mash });
    if (b.mash >= 1) this.birdLetsGo(events);
    return events;
  }

  private stepBird(dt: number, events: GameEvent[]): void {
    if (!this.bird) {
      if (this.state !== 'playing') return;
      this.birdTimer -= dt;
      if (this.birdTimer > 0) return;
      this.birdTimer = this.between(BIRD_EVERY);
      this.bird = { phase: 'diving', t: 0, x: this.slug.x, y: this.slug.y, mash: 0 };
      events.push({ type: 'birdDive' });
      return;
    }
    const b = this.bird;
    const s = this.slug;
    b.t += dt;
    if (b.phase === 'diving') {
      if (this.state !== 'playing') {
        b.phase = 'leaving'; // the slug got squished first: the bird gives up
        b.t = 0;
        return;
      }
      b.x = s.x;
      b.y = s.y;
      if (b.t >= BIRD_DIVE) {
        Object.assign(b, { phase: 'carrying', t: 0 });
        this.state = 'grabbed';
        s.moving = false;
        events.push({ type: 'birdGrab' });
      }
    } else if (b.phase === 'carrying') {
      b.mash = Math.max(0, b.mash - MASH_DECAY * dt);
      if (b.t >= MASH_TIME) {
        // Too slow: gulp.
        Object.assign(b, { phase: 'leaving', t: 0, ate: true });
        this.checkpoint = 0; // eaten means all the way back to the start
        this.state = 'dying';
        this.deathCause = 'eaten';
        this.deathT = 0;
        events.push({ type: 'eaten' });
      }
    } else if (b.phase === 'dropping') {
      // Fly the slug to the drop point.
      const k = Math.min(1, b.t / BIRD_CARRY);
      const ease = k * k * (3 - 2 * k);
      s.x = b.x + (b.dropX! - b.x) * ease;
      s.y = b.y + (b.dropY! - b.y) * ease;
      if (k >= 1) {
        Object.assign(b, { phase: 'leaving', t: 0, x: s.x, y: s.y });
        this.state = 'playing';
        s.facing = 'up';
        if (b.dropSlot !== undefined) this.startMunch(b.dropSlot, events);
        else if (b.dropY! > this.checkpoint) this.reachCheckpoint(b.dropY!, events);
      }
    } else if (b.t > 2) {
      this.bird = null;
    }
  }

  /** Wriggled free: the bird carries the slug on to the next checkpoint and drops it. */
  private birdLetsGo(events: GameEvent[]): void {
    const b = this.bird!;
    const s = this.slug;
    const next = this.nextCheckpoint();
    Object.assign(b, { phase: 'dropping', t: 0, x: s.x, y: s.y, dropX: next.x, dropY: next.y, dropSlot: next.slot });
    events.push({ type: 'birdDrop', slot: next.slot ?? null });
  }

  /**
   * The next checkpoint up from the slug: the next grass strip, or, past the last
   * one, the nearest free lettuce patch.
   */
  private nextCheckpoint(): { x: number; y: number; slot?: number } {
    const s = this.slug;
    const nextGrass = ROWS.findIndex((k, r) => k === 'grass' && r > s.y + 0.3);
    if (nextGrass > 0) return { x: s.x, y: nextGrass };
    let slot = -1;
    SLOTS.forEach((sx, i) => {
      if (!this.filled[i] && (slot < 0 || Math.abs(sx - s.x) < Math.abs(SLOTS[slot] - s.x))) slot = i;
    });
    return slot < 0 ? { x: s.x, y: this.checkpoint } : { x: SLOTS[slot], y: GOAL_ROW - 0.4, slot };
  }

  /** Can the skip button be used right now? (Only while crawling the road.) */
  get canSkip(): boolean {
    return this.state === 'playing';
  }

  /** The skip button: straight to the next checkpoint (or into a lettuce, past the last one). */
  skip(): GameEvent[] {
    const events: GameEvent[] = [];
    if (!this.canSkip) return events;
    const next = this.nextCheckpoint();
    Object.assign(this.slug, { x: next.x, y: next.y, facing: 'up', moving: false });
    events.push({ type: 'skip' });
    if (next.slot !== undefined) this.startMunch(next.slot, events);
    else if (next.y > this.checkpoint) this.reachCheckpoint(next.y, events);
    return events;
  }

  private inSalt(p: Salt, s: { x: number; y: number; facing: Dir }): boolean {
    const { hx, hy } = slugHalfSize(s.facing);
    return Math.abs(p.row - s.y) < VEHICLE_HALF_H + hy && Math.abs(p.x - s.x) < SALT_HALF_W + hx;
  }

  private spawnPowerup(kind: PowerupKind, row: number, events: GameEvent[]): void {
    if (kind === 'slow') this.powerups = this.powerups.filter((p) => p.kind !== 'slow');
    else if (this.powerups.filter((p) => p.kind === 'life').length >= MAX_ONE_UPS) return;
    const x = Math.round((this.rng() - 0.5) * 12 * 2) / 2;
    this.powerups.push({ id: this.nextId++, kind, x, y: row });
    events.push({ type: 'powerup', kind, x, y: row });
  }

  /** Salt fades; meanwhile salt trucks turn up every 30 s – 1 min. */
  private stepSalt(dt: number, events: GameEvent[], trucks = true): void {
    for (const p of this.salt) p.t -= dt;
    this.salt = this.salt.filter((p) => p.t > 0);
    if (!trucks) return;
    this.dumpTimer -= dt;
    if (this.dumpTimer > 0) return;
    const lane = LANES[Math.floor(this.rng() * LANES.length)];
    const dir = Math.sign(lane.speed);
    const len = VEHICLE_LEN.dumptruck;
    const x = -dir * (HALF_W + SPAWN_MARGIN + len / 2);
    if (this.vehicles.some((o) => o.row === lane.row && Math.abs(o.x - x) < (o.len + len) / 2 + QUEUE_GAP + 1)) {
      this.dumpTimer = 0.5; // that lane's backed up: try again shortly
      return;
    }
    const speed = lane.speed * this.speedFactor() * 0.75;
    this.vehicles.push({
      id: this.nextId++, kind: 'dumptruck', row: lane.row, len, x, speed, vel: Math.abs(speed), runsLight: false, side: -dir, salty: true,
    });
    events.push({ type: 'dumptruck', row: lane.row });
    this.dumpTimer = this.between(DUMP_EVERY);
  }

  /** Send a rival slug that bumped into the player flying off the map. */
  private fling(n: Npc, events: GameEvent[]): void {
    const s = this.slug;
    const away = Math.sign(n.x - s.x) || (this.rng() < 0.5 ? -1 : 1);
    n.state = 'flung';
    n.timer = 2.2;
    n.moving = false;
    n.fling = { vx: away * (9 + this.rng() * 4), vy: (n.y >= s.y ? 1 : -1) * (1 + this.rng() * 2), vz: 7 + this.rng() * 3, z: 0 };
    events.push({ type: 'npcBounce', id: n.id });
  }

  private touches(v: Vehicle, s: { x: number; y: number; facing: Dir } = this.slug): boolean {
    const { hx, hy } = slugHalfSize(s.facing);
    return Math.abs(v.row - s.y) < VEHICLE_HALF_H + hy && Math.abs(v.x - s.x) < v.len / 2 + hx;
  }

  // ---- rival slugs -------------------------------------------------------------

  private stepNpcs(dt: number, events: GameEvent[]): void {
    this.npcTimer -= dt;
    if (this.npcTimer <= 0) {
      this.npcTimer = this.between(NPC_EVERY);
      if (this.npcs.length < NPC_MAX) {
        // Somewhere along the start verge, not right on top of the player.
        let x = 0;
        for (let tries = 0; tries < 8; tries++) {
          x = Math.round((this.rng() - 0.5) * 12 * 4) / 4;
          if (Math.abs(x - this.slug.x) > 2 || this.slug.y > 0.5) break;
        }
        const id = this.nextId++;
        this.npcs.push({ id, x, y: 0, facing: 'up', moving: false, color: 1 + (id % NPC_COLORS), state: 'waiting', timer: this.between([0.5, 2]), slot: -1 });
        events.push({ type: 'npcArrive', id });
      }
    }
    for (const n of this.npcs) this.stepNpc(n, dt, events);
    this.npcs = this.npcs.filter((n) => n.timer > -1);
    this.checkLevel(events); // an NPC may have just finished the last patch
  }

  /** Nearest lettuce patch still free. */
  private nearestFree(x: number): number | null {
    let best: number | null = null;
    SLOTS.forEach((sx, i) => {
      if (!this.filled[i] && (best === null || Math.abs(sx - x) < Math.abs(best - x))) best = sx;
    });
    return best;
  }

  /** Will a moving vehicle in `row` reach x within `secs`? (What an NPC checks before setting off.) */
  private laneBusy(row: number, x: number, secs: number): boolean {
    return this.vehicles.some((v) => {
      if (v.row !== row) return false;
      const dir = Math.sign(v.speed);
      const ahead = dir * (x - v.x) + v.len / 2 + 0.4; // distance until its tail clears x
      const front = dir * (x - v.x) - v.len / 2 - 0.4; // distance until its nose reaches x
      if (ahead < 0) return false; // already gone by
      if (front < 0) return true; // right there
      return v.vel > MOVING && front / Math.abs(v.speed) < secs;
    });
  }

  private stepNpc(n: Npc, dt: number, events: GameEvent[]): void {
    if (n.state === 'flung') {
      const f = n.fling!;
      n.x += f.vx * dt;
      n.y += f.vy * dt;
      f.z += f.vz * dt;
      f.vz -= 6 * dt; // floaty, so it sails clean off the map
      n.timer -= dt;
      if (n.timer <= 0) n.timer = -2;
      return;
    }
    if (n.state === 'dying') {
      n.timer -= dt;
      if (n.timer <= 0) n.timer = -2; // remove
      return;
    }
    if (n.state === 'munching') {
      n.timer -= dt;
      if (n.timer <= 0) {
        n.timer = -2;
        n.state = 'waiting'; // no longer munching, so the level can finish
      }
      return;
    }
    const before = { x: n.x, y: n.y, facing: n.facing };
    const target = this.nearestFree(n.x);
    n.moving = false;
    const step = NPC_SPEED * dt;
    const onGoalEdge = n.y >= GOAL_ROW - 0.56;
    if (n.state === 'waiting') {
      if (target !== null && Math.abs(n.x - target) > 0.08) {
        // Line up with a lettuce while still safe on the grass.
        n.facing = n.x < target ? 'right' : 'left';
        n.x += Math.sign(target - n.x) * Math.min(step, Math.abs(target - n.x));
        n.moving = true;
      } else if ((n.timer -= dt) <= 0) {
        // Peek at the next lane: they're reckless, so they only look one lane ahead.
        if (this.laneBusy(Math.round(n.y) + 1, n.x, 1.2)) n.timer = 0.25;
        else n.state = 'crawling';
      }
    } else if (onGoalEdge) {
      const slot = SLOTS.findIndex((sx, i) => !this.filled[i] && Math.abs(n.x - sx) <= SLOT_HALF);
      if (slot >= 0) {
        this.filled[slot] = true;
        this.eater[slot] = n.color;
        Object.assign(n, { state: 'munching', timer: MUNCH_TIME, slot, x: SLOTS[slot], y: GOAL_ROW - 0.4, facing: 'down' });
        events.push({ type: 'npcMunch', id: n.id, slot });
        return;
      }
      // Beaten to it: shuffle along the hedge to another patch (out in the traffic!).
      if (target !== null) {
        n.facing = n.x < target ? 'right' : 'left';
        n.x += Math.sign(target - n.x) * step;
        n.moving = true;
      }
    } else {
      n.facing = 'up';
      n.y = Math.min(GOAL_ROW - 0.55, n.y + step);
      n.moving = true;
      // Made it to the next grass strip: have a rest.
      const r = Math.round(n.y);
      if (ROWS[r] === 'grass' && n.y >= r && before.y < r) {
        n.y = r;
        n.state = 'waiting';
        n.timer = this.between([0.5, 3]);
      }
    }
    if (this.vehicles.some((v) => v.vel < MOVING && this.touches(v, n))) {
      Object.assign(n, before);
      n.moving = false;
    }
    if (this.vehicles.some((v) => v.vel >= MOVING && this.touches(v, n))) {
      Object.assign(n, { state: 'dying', timer: DEATH_TIME, cause: 'squished' });
      events.push({ type: 'npcSquish', id: n.id, x: n.x, y: n.y });
    } else if (this.salt.some((p) => this.inSalt(p, n))) {
      Object.assign(n, { state: 'dying', timer: DEATH_TIME, cause: 'salted' });
      events.push({ type: 'npcSalted', id: n.id, x: n.x, y: n.y });
    }
  }

  private die(cause: DeathCause, events: GameEvent[]): void {
    this.state = 'dying';
    this.deathCause = cause;
    this.deathT = 0;
    events.push({ type: cause === 'squished' ? 'squish' : cause, x: this.slug.x, y: this.slug.y });
    // Every life lost drops a 1UP somewhere on the map.
    if (!this.infiniteLives && this.lives > 1) this.spawnPowerup('life', Math.floor(this.rng() * GOAL_ROW), events);
  }

  private respawn(): void {
    this.slug = freshSlug(this.checkpoint);
    this.bestRow = this.checkpoint;
    this.cleared = ROWS.map((_, r) => r).filter((r) => r < this.checkpoint);
    this.deathCause = null;
    this.deathT = 0;
  }
}

function freshSlug(row = 0): Slug {
  return { x: 0, y: row, facing: 'up', moving: false, moisture: 100 };
}
