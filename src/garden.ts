// The garden: where the slug goes once it's a snail. Eat as many vegetables as you
// can while the gardener wanders about; hide behind rocks to stay out of his sight.
// Same coordinates as the road (x across, y away from the camera), further up.

import { GOAL_ROW, HALF_W } from './layout.ts';
import type { Dir } from './sim.ts';

export const GARDEN_Y0 = GOAL_ROW + 1.6; // just past the hedge
export const GARDEN_Y1 = GARDEN_Y0 + 9.8;
export const GARDEN_START = { x: 0, y: GARDEN_Y0 + 0.6 };
const SNAIL_R = 0.28;
export const SNAIL_SPEED = 1.1;
export const EAT_TIME = 1.4; // seconds of chewing to finish a vegetable
const BITE_EVERY = 0.35;
/** Clearing the garden: the gardener throws a tantrum, then the snail gets its trophy… */
export const UPSET_TIME = 3.2; // seconds of tantrum before the trophy
export const PORTAL_AT = UPSET_TIME + 3.5; // …and then a portal from hell opens beneath it
export const CLEAR_BONUS = 2000;
export const VISION_RANGE = 4.6;
export const VISION_HALF = 0.62; // radians either side of where he's looking
const WANDER_SPEED = 1.1;
export const CHASE_SPEED = 3.2;
const GARDENER_R = 0.35;
const ALERT_TIME = 0.6;
const CARRY_TIME = 0.9;
const THROW_TIME = 1.5;

export type VegKind = 'carrot' | 'cabbage' | 'tomato' | 'pumpkin' | 'lettuce' | 'eggplant';
export const VEG_VALUE: Record<VegKind, number> = { carrot: 20, cabbage: 30, tomato: 25, pumpkin: 50, lettuce: 20, eggplant: 35 };
const VEG_R: Record<VegKind, number> = { carrot: 0.25, cabbage: 0.35, tomato: 0.3, pumpkin: 0.45, lettuce: 0.32, eggplant: 0.28 };
const VEG_KINDS = Object.keys(VEG_VALUE) as VegKind[];

export interface Rock {
  x: number;
  y: number;
  r: number;
}
export interface Veg {
  id: number;
  kind: VegKind;
  x: number;
  y: number;
  r: number;
  /** 0 … 1 of the way through being eaten (gone for good at 1). */
  eaten: number;
}
export interface Flower {
  x: number;
  y: number;
  color: number;
}
export interface Gardener {
  x: number;
  y: number;
  /** Way he's facing (radians; 0 = +x, π/2 = up the garden). */
  heading: number;
  /** Where his eyes are pointed: the vision cone's centre line. */
  gaze: number;
  state: 'wander' | 'pause' | 'alert' | 'chase' | 'carry' | 'throw' | 'upset';
  t: number;
  tx: number;
  ty: number;
  /** Seconds walking towards the current target (to notice being stuck). */
  stuck: number;
}

export type GardenEvent =
  | { type: 'vegBite' }
  | { type: 'vegEaten'; kind: VegKind; value: number }
  | { type: 'gardenCleared' }
  | { type: 'trophy' }
  | { type: 'portal' }
  | { type: 'spotted' }
  | { type: 'caught' }
  | { type: 'thrown' }
  | { type: 'gardenRespawn' };

interface SnailLike {
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Garden {
  rocks: Rock[] = [];
  veg: Veg[] = [];
  flowers: Flower[] = [];
  gardener: Gardener;
  /** What's happening to the snail: free to roam, in the gardener's hand, flying, or victorious. */
  phase: 'free' | 'caught' | 'thrown' | 'won' = 'free';
  phaseT = 0;
  /** The snail's height off the ground (when held or thrown). */
  z = 0;
  eatenCount = 0;
  time = 0;
  private throwV = { vx: 0, vy: 0, vz: 0 };
  private respawnAt = { ...GARDEN_START };
  private biteT = 0;
  private rngState: number;

  constructor(seed: number) {
    this.rngState = seed >>> 0;
    // Big rocks, spread out, none blocking the way in.
    for (let tries = 0; this.rocks.length < 7 && tries < 400; tries++) {
      const r = 0.55 + this.rng() * 0.35;
      const x = (this.rng() - 0.5) * (HALF_W * 2 - 2);
      const y = GARDEN_Y0 + 2.2 + this.rng() * (GARDEN_Y1 - GARDEN_Y0 - 3);
      if (this.rocks.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 1.6)) this.rocks.push({ x, y, r });
    }
    // Vegetables among them.
    for (let tries = 0, id = 1; this.veg.length < 20 && tries < 800; tries++) {
      const kind = VEG_KINDS[Math.floor(this.rng() * VEG_KINDS.length)];
      const r = VEG_R[kind];
      const x = (this.rng() - 0.5) * (HALF_W * 2 - 1.4);
      const y = GARDEN_Y0 + 1.4 + this.rng() * (GARDEN_Y1 - GARDEN_Y0 - 1.8);
      const clear = this.rocks.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 0.35)
        && this.veg.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 0.5);
      if (clear) this.veg.push({ id: id++, kind, x, y, r, eaten: 0 });
    }
    // Flowers everywhere else (just for looks).
    const petals = [0xff5d8f, 0xffd23f, 0xffffff, 0xb57bff, 0xff8c42, 0x5ec8ff];
    for (let i = 0; i < 90; i++) {
      const x = (this.rng() - 0.5) * (HALF_W * 2);
      const y = GARDEN_Y0 + this.rng() * (GARDEN_Y1 - GARDEN_Y0 + 1);
      if (this.blocked(x, y, 0.15) || this.veg.some((v) => Math.hypot(v.x - x, v.y - y) < v.r + 0.2)) continue;
      this.flowers.push({ x, y, color: petals[Math.floor(this.rng() * petals.length)] });
    }
    this.gardener = { x: 0, y: GARDEN_Y1 - 1, heading: -Math.PI / 2, gaze: -Math.PI / 2, state: 'pause', t: 2, tx: 0, ty: GARDEN_Y1 - 1, stuck: 0 };
  }

  private rng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inside a rock (with some margin)? */
  blocked(x: number, y: number, margin: number): boolean {
    return this.rocks.some((r) => Math.hypot(r.x - x, r.y - y) < r.r + margin);
  }

  /** Push a circle out of rocks and keep it inside the garden. */
  private collide(p: { x: number; y: number }, radius: number): void {
    for (const r of this.rocks) {
      const dx = p.x - r.x, dy = p.y - r.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d < r.r + radius) {
        p.x = r.x + (dx / d) * (r.r + radius);
        p.y = r.y + (dy / d) * (r.r + radius);
      }
    }
    p.x = Math.max(-HALF_W + radius, Math.min(HALF_W - radius, p.x));
    p.y = Math.max(GARDEN_Y0, Math.min(GARDEN_Y1, p.y));
  }

  /** Can the gardener see this point? In range, inside the cone, and no rock in the way. */
  canSee(x: number, y: number): boolean {
    const g = this.gardener;
    const dx = x - g.x, dy = y - g.y;
    const d = Math.hypot(dx, dy);
    if (d > VISION_RANGE) return false;
    if (d > 0.3 && Math.abs(angleDiff(Math.atan2(dy, dx), g.gaze)) > VISION_HALF) return false;
    return !this.rocks.some((r) => {
      // Distance from the rock's centre to the line of sight.
      const t = Math.max(0, Math.min(1, ((r.x - g.x) * dx + (r.y - g.y) * dy) / (d * d || 1)));
      return Math.hypot(g.x + dx * t - r.x, g.y + dy * t - r.y) < r.r * 0.92;
    });
  }

  update(dt: number, input: Dir | null, snail: SnailLike, events: GardenEvent[]): void {
    this.time += dt;
    const before = this.phaseT;
    this.phaseT += dt;
    if (this.phase === 'won') {
      // The gardener stamps about; then it's trophy time; then the victory screen.
      const g = this.gardener;
      g.t += dt;
      g.heading = g.gaze = Math.atan2(snail.y - g.y, snail.x - g.x);
      snail.moving = false;
      snail.facing = 'down';
      if (before < UPSET_TIME && this.phaseT >= UPSET_TIME) events.push({ type: 'trophy' });
      if (before < PORTAL_AT && this.phaseT >= PORTAL_AT) events.push({ type: 'portal' });
      return;
    }
    this.stepSnail(dt, input, snail, events);
    this.stepGardener(dt, snail, events);
  }

  private stepSnail(dt: number, input: Dir | null, s: SnailLike, events: GardenEvent[]): void {
    const g = this.gardener;
    if (this.phase === 'caught') {
      // Held up in his hand.
      s.x = g.x + Math.cos(g.heading) * 0.35;
      s.y = g.y + Math.sin(g.heading) * 0.35;
      this.z = 1.2;
      s.moving = false;
      return;
    }
    if (this.phase === 'thrown') {
      s.x += this.throwV.vx * dt;
      s.y += this.throwV.vy * dt;
      this.z += this.throwV.vz * dt;
      this.throwV.vz -= 8 * dt;
      if (this.phaseT >= THROW_TIME) {
        // Back behind the rock nearest where it was caught.
        Object.assign(s, { x: this.respawnAt.x, y: this.respawnAt.y, facing: 'up', moving: false });
        this.z = 0;
        this.phase = 'free';
        this.phaseT = 0;
        events.push({ type: 'gardenRespawn' });
      }
      return;
    }
    s.moving = input !== null;
    if (input) {
      s.facing = input;
      const step = SNAIL_SPEED * dt;
      if (input === 'up') s.y += step;
      else if (input === 'down') s.y -= step;
      else if (input === 'left') s.x -= step;
      else s.x += step;
    }
    this.collide(s, SNAIL_R);

    // Munch whatever vegetable it's touching.
    const v = this.veg.find((q) => q.eaten < 1 && Math.hypot(q.x - s.x, q.y - s.y) < q.r + SNAIL_R + 0.05);
    if (v) {
      v.eaten = Math.min(1, v.eaten + dt / EAT_TIME);
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this.biteT = BITE_EVERY;
        events.push({ type: 'vegBite' });
      }
      if (v.eaten >= 1) {
        this.eatenCount++;
        events.push({ type: 'vegEaten', kind: v.kind, value: VEG_VALUE[v.kind] });
        if (this.veg.every((q) => q.eaten >= 1)) this.win(events); // every last vegetable: cleared!
      }
    } else this.biteT = 0;
  }

  private stepGardener(dt: number, s: SnailLike, events: GardenEvent[]): void {
    const g = this.gardener;
    g.t += dt;
    const walk = (speed: number, tx: number, ty: number) => {
      const dx = tx - g.x, dy = ty - g.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) return d;
      g.heading = Math.atan2(dy, dx);
      const step = Math.min(d, speed * dt);
      const before = { x: g.x, y: g.y };
      g.x += (dx / d) * step;
      g.y += (dy / d) * step;
      this.collide(g, GARDENER_R);
      // Sliding round a rock can stall him; notice and pick somewhere else.
      g.stuck = Math.hypot(g.x - before.x, g.y - before.y) < step * 0.3 ? g.stuck + dt : 0;
      return d;
    };

    if (g.state === 'wander' || g.state === 'pause') {
      if (g.state === 'wander') {
        g.gaze = g.heading + Math.sin(this.time * 1.4) * 0.35; // glancing about as he strolls
        if (walk(WANDER_SPEED, g.tx, g.ty) < 0.1 || g.stuck > 1) {
          g.state = 'pause';
          g.t = 0;
        }
      } else {
        g.gaze = g.heading + Math.sin(g.t * 1.6) * 0.9; // having a good look around
        if (g.t > 1.8) this.pickTarget();
      }
      if (this.phase === 'free' && this.canSee(s.x, s.y)) {
        g.state = 'alert';
        g.t = 0;
        g.heading = g.gaze = Math.atan2(s.y - g.y, s.x - g.x);
        events.push({ type: 'spotted' });
      }
    } else if (g.state === 'alert') {
      g.heading = g.gaze = Math.atan2(s.y - g.y, s.x - g.x);
      if (g.t >= ALERT_TIME) {
        g.state = 'chase';
        g.t = 0;
      }
    } else if (g.state === 'chase') {
      const d = walk(CHASE_SPEED, s.x, s.y);
      g.gaze = g.heading;
      if (d < GARDENER_R + SNAIL_R + 0.1) {
        g.state = 'carry';
        g.t = 0;
        this.phase = 'caught';
        this.phaseT = 0;
        this.respawnAt = this.hideSpot(s.x, s.y);
        events.push({ type: 'caught' });
      }
    } else if (g.state === 'carry') {
      if (g.t >= CARRY_TIME) {
        // Wind up and hurl it off the nearest side of the map.
        g.state = 'throw';
        g.t = 0;
        const toLeft = s.x + HALF_W, toRight = HALF_W - s.x, toTop = GARDEN_Y1 + 2 - s.y;
        const [vx, vy] = toTop < Math.min(toLeft, toRight) ? [0, 7] : toLeft < toRight ? [-9, 2] : [9, 2];
        g.heading = Math.atan2(vy, vx);
        this.throwV = { vx, vy, vz: 6 };
        this.phase = 'thrown';
        this.phaseT = 0;
        events.push({ type: 'thrown' });
      }
    } else if (g.state === 'throw' && g.t >= 1) {
      this.pickTarget();
    }
  }

  /** The skip button: every vegetable gone at once, straight to the finale. */
  clearAll(events: GardenEvent[]): void {
    if (this.phase !== 'free') return;
    for (const v of this.veg) v.eaten = 1;
    this.win(events);
  }

  private win(events: GardenEvent[]): void {
    this.phase = 'won';
    this.phaseT = 0;
    Object.assign(this.gardener, { state: 'upset', t: 0 });
    events.push({ type: 'gardenCleared' });
  }

  /** The far side of the rock nearest (x, y), from the gardener's point of view. */
  private hideSpot(x: number, y: number): { x: number; y: number } {
    const g = this.gardener;
    let rock = this.rocks[0];
    for (const r of this.rocks) if (Math.hypot(r.x - x, r.y - y) < Math.hypot(rock.x - x, rock.y - y)) rock = r;
    if (!rock) return { ...GARDEN_START };
    const dx = rock.x - g.x, dy = rock.y - g.y;
    const d = Math.hypot(dx, dy) || 1;
    const spot = { x: rock.x + (dx / d) * (rock.r + SNAIL_R + 0.12), y: rock.y + (dy / d) * (rock.r + SNAIL_R + 0.12) };
    this.collide(spot, SNAIL_R);
    return spot;
  }

  private pickTarget(): void {
    const g = this.gardener;
    for (let tries = 0; tries < 30; tries++) {
      const x = (this.rng() - 0.5) * (HALF_W * 2 - 1.5);
      const y = GARDEN_Y0 + 0.8 + this.rng() * (GARDEN_Y1 - GARDEN_Y0 - 0.8);
      if (!this.blocked(x, y, 0.7) && Math.hypot(x - g.x, y - g.y) > 2) {
        Object.assign(g, { tx: x, ty: y, state: 'wander', t: 0, stuck: 0 });
        return;
      }
    }
    Object.assign(g, { state: 'pause', t: 0 });
  }
}
