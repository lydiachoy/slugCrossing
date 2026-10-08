// Act five: blown into the city — and somehow, now a pigeon. Top-down again, and tiny: a grid of
// streets between towering buildings, with traffic and pedestrians everywhere.
// Coordinates like the road: x east, y north (the view maps y to -z).

import type { Dir } from './sim.ts';

export const BLOCK = 18; // street spacing
export const ROAD = 5; // road width (two lanes)
export const SIDEWALK = 1.8;
export const GRID = 7; // blocks along each side
export const CITY_W = GRID * BLOCK; // roads run along x = k·BLOCK and y = k·BLOCK, k = 0 … GRID
export const BUTTERFLY_SPEED = 4.5;
export const BUTTERFLY_R = 0.25; // it's tiny: a person is about 1.8 tall
const TURN_RATE = 9;

export interface Building {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
  color: number;
}

/** A lane of traffic: along a road, one way, with cars spaced along it (looping round the city). */
export interface Lane {
  /** 'x': runs east–west at y = at; 'y': north–south at x = at. */
  axis: 'x' | 'y';
  at: number;
  dir: 1 | -1;
  speed: number;
  cars: { offset: number; color: number }[];
}

/** Someone walking round a block's sidewalk. */
export interface Walker {
  block: { x0: number; y0: number; x1: number; y1: number };
  /** Start point round the perimeter (0 … 1), and speed (laps per second, signed). */
  start: number;
  speed: number;
  shirt: number;
  skin: number;
  /** Running away from a pigeon on the ground. */
  fleeing?: boolean;
}

/** Energy: flying uses it up; at 0 the pigeon has to walk, and eat junk food off the sidewalk to fly again. */
export const ENERGY_MAX = 100;
export const ENERGY_DRAIN = 5; // per second, flying
export const FOOD_ENERGY = 40;
export const WALK_SPEED = 2;
export const GROUND_ALT = 0.35; // standing on the ground
const FOOD_COUNT = 90;
const FOOD_RESPAWN = 15;
const FOOD_REACH = 0.7;
export const SQUASH_POINTS = -10; // hit by a car while walking
export const SQUASH_TIME = 1.5;
const FLEE_RANGE = 4.5;
const FLEE_SPEED = 0.08; // laps of the block per second: running!
const ALT_RATE = 3; // fluttering down / taking off
export type FoodKind = 'pizza' | 'hotdog' | 'burger';
export interface Food {
  id: number;
  kind: FoodKind;
  x: number;
  y: number;
  /** Seconds until it reappears somewhere, once eaten (0 = it's there). */
  gone: number;
}

/** Poop: Space drops one; it falls (carrying a little of the pigeon's speed) onto whatever's below. */
export const FLY_HEIGHT = 2.4; // the pigeon flies this high
const GRAVITY = 9.8 * 4; // (a quick drop: it hits the ground in about a third of a second)
const POOP_COOLDOWN = 0.3;
const CAR_TOP = 1.6, CAR_HALF_L = 2.1, CAR_HALF_W = 0.95;
const HEAD_TOP = 1.95, PERSON_R = 0.42;
export const CAR_POINTS = 3;
export const PERSON_POINTS = -5;
export const POINTS_TO_WIN = 100;
export const SPLAT_LIFE = 5;
/** The park block (no buildings), with the giant trophy in the middle; the trophy's cup rim is this high. */
export const PARK = { bx: 5, by: 1 };
export const TROPHY_RIM = 6;
const CRUISE_ALT = 66; // high enough to clear every rooftop on the way to the park
const CLIMB_SPEED = 12, CRUISE_SPEED = 16;
export const FIREWORKS_TIME = 7; // after landing in the trophy, then the victory screen

export interface Poop {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}
export interface Splat {
  id: number;
  x: number;
  y: number;
  z: number;
  /** What it landed on (the view draws a car splat on its roof, travelling with it). */
  on: 'ground' | 'car' | 'person';
  lane?: number;
  car?: number;
  t: number;
}

export type CityEvent =
  | { type: 'bump' }
  | { type: 'tired' }
  | { type: 'eatFood'; kind: FoodKind }
  | { type: 'takeOff' }
  | { type: 'squashed'; points: number }
  | { type: 'unsquash' }
  | { type: 'poop' }
  | { type: 'hitCar'; x: number; y: number; points: number }
  | { type: 'hitPerson'; x: number; y: number; points: number }
  | { type: 'splat' }
  | { type: 'cityWin' }
  | { type: 'landTrophy' }
  | { type: 'victory' };

const ANGLE: Record<Dir, number> = { right: 0, up: Math.PI / 2, left: Math.PI, down: -Math.PI / 2 };

export class City {
  buildings: Building[] = [];
  lanes: Lane[] = [];
  walkers: Walker[] = [];
  /** The pigeon. */
  pos = { x: 3 * BLOCK, y: 3 * BLOCK }; // landing at a crossroads in the middle of town
  heading = Math.PI / 2;
  moving = false;
  t = 0;
  /** The pigeon's height (it climbs over the rooftops on its way to the park). */
  alt = FLY_HEIGHT;
  points = 0;
  poops: Poop[] = [];
  splats: Splat[] = [];
  energy = ENERGY_MAX;
  /** Out of energy: walking on the ground. */
  grounded = false;
  /** Flattened by a car (seconds left). */
  squashT = 0;
  food: Food[] = [];
  /** Every block's sidewalk (the ring people walk round). */
  sidewalks: Walker['block'][] = [];
  /** 'free' to fly and poop; 'homing' to the park once it has 100 points; 'landed' in the trophy. */
  phase: 'free' | 'homing' | 'landed' = 'free';
  phaseT = 0;
  private poopT = 0;
  private nextId = 1;
  private vel = { x: 0, y: 0 };
  private bumpT = 0;
  private rngState: number;

  constructor(seed: number) {
    this.rngState = seed >>> 0;
    const paint = [0xb8b4ac, 0x9a8f86, 0xc9b79c, 0x7d8a96, 0xa6b0b8, 0x8c7a6b, 0xd2c6b2, 0x6f7c8a];
    const skins = [0xf0c8a0, 0xd9a878, 0xa86f48, 0x7a4a2e, 0xf6d6c0];
    for (let bx = 0; bx < GRID; bx++) {
      for (let by = 0; by < GRID; by++) {
        const isPark = bx === PARK.bx && by === PARK.by;
        // The block inside its sidewalks…
        const x0 = bx * BLOCK + ROAD / 2 + SIDEWALK, x1 = (bx + 1) * BLOCK - ROAD / 2 - SIDEWALK;
        const y0 = by * BLOCK + ROAD / 2 + SIDEWALK, y1 = (by + 1) * BLOCK - ROAD / 2 - SIDEWALK;
        // …split into one to four buildings, with narrow gaps between.
        const splitX = this.rng() < 0.6, splitY = this.rng() < 0.6;
        const mx = x0 + (x1 - x0) * (0.4 + this.rng() * 0.2), my = y0 + (y1 - y0) * (0.4 + this.rng() * 0.2);
        const xs = splitX ? [[x0, mx - 0.4], [mx + 0.4, x1]] : [[x0, x1]];
        const ys = splitY ? [[y0, my - 0.4], [my + 0.4, y1]] : [[y0, y1]];
        for (const [ax, bx2] of isPark ? [] : xs) {
          for (const [ay, by2] of ys) {
            this.buildings.push({ x0: ax, y0: ay, x1: bx2, y1: by2, h: 15 + this.rng() ** 1.5 * 45, color: paint[Math.floor(this.rng() * paint.length)] });
          }
        }
        // Two or three people out walking round it.
        const sw = { x0: x0 - SIDEWALK / 2, y0: y0 - SIDEWALK / 2, x1: x1 + SIDEWALK / 2, y1: y1 + SIDEWALK / 2 };
        this.sidewalks.push(sw);
        for (let i = 0; i < 2 + Math.floor(this.rng() * 2); i++) {
          this.walkers.push({
            block: sw, start: this.rng(), speed: (this.rng() < 0.5 ? -1 : 1) * (0.012 + this.rng() * 0.01),
            shirt: Math.floor(this.rng() * 0xffffff), skin: skins[Math.floor(this.rng() * skins.length)],
          });
        }
      }
    }
    // Junk food dropped on the sidewalks.
    for (let i = 0; i < FOOD_COUNT; i++) this.food.push({ id: i + 1, kind: 'pizza', x: 0, y: 0, gone: 0 });
    for (const f of this.food) this.placeFood(f);
    // Traffic, both ways down every street.
    const carColors = [0xd8433a, 0x2f6fd1, 0xf2f2f2, 0x2a2a2e, 0x3aa35b, 0xf0a020, 0x7b4fc9, 0xe8d23a];
    for (let k = 0; k <= GRID; k++) {
      for (const axis of ['x', 'y'] as const) {
        for (const dir of [1, -1] as const) {
          const n = 3 + Math.floor(this.rng() * 3);
          this.lanes.push({
            axis, at: k * BLOCK + dir * (ROAD / 4), dir, speed: 6 + this.rng() * 5,
            cars: Array.from({ length: n }, (_, i) => ({ offset: (i + this.rng() * 0.5) / n, color: carColors[Math.floor(this.rng() * carColors.length)] })),
          });
        }
      }
    }
  }

  private rng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inside a building (with the pigeon's size as margin)? */
  blocked(x: number, y: number): boolean {
    if (x < 1 || y < 1 || x > CITY_W - 1 || y > CITY_W - 1) return true;
    const r = BUTTERFLY_R;
    return this.buildings.some((b) => x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r);
  }

  /** Where a lane's car is right now (it loops round the length of the city). */
  carAt(lane: Lane, car: { offset: number }): { x: number; y: number } {
    const along = (((car.offset * CITY_W + lane.dir * lane.speed * this.t) % CITY_W) + CITY_W) % CITY_W;
    return lane.axis === 'x' ? { x: along, y: lane.at } : { x: lane.at, y: along };
  }

  /** Where a walker is right now, and which way they face (radians). */
  walkerAt(w: Walker): { x: number; y: number; facing: number } {
    const b = w.block;
    const W = b.x1 - b.x0, H = b.y1 - b.y0, P = 2 * (W + H);
    let d = (((w.start + w.speed * this.t) % 1) + 1) % 1 * P;
    const fwd = w.speed > 0 ? 1 : -1;
    if (d < W) return { x: b.x0 + d, y: b.y0, facing: fwd > 0 ? 0 : Math.PI };
    d -= W;
    if (d < H) return { x: b.x1, y: b.y0 + d, facing: fwd > 0 ? Math.PI / 2 : -Math.PI / 2 };
    d -= H;
    if (d < W) return { x: b.x1 - d, y: b.y1, facing: fwd > 0 ? Math.PI : 0 };
    d -= W;
    return { x: b.x0, y: b.y1 - d, facing: fwd > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }

  /** Drop a piece of junk food somewhere on a sidewalk. */
  private placeFood(f: Food): void {
    const p = this.perimeter(this.sidewalks[Math.floor(this.rng() * this.sidewalks.length)], this.rng());
    f.x = p.x;
    f.y = p.y;
    f.kind = (['pizza', 'hotdog', 'burger'] as const)[Math.floor(this.rng() * 3)];
    f.gone = 0;
  }

  /** A point round a block's sidewalk (u: 0 … 1). */
  private perimeter(b: Walker['block'], u: number): { x: number; y: number } {
    const W = b.x1 - b.x0, H = b.y1 - b.y0;
    let d = (((u % 1) + 1) % 1) * 2 * (W + H);
    if (d < W) return { x: b.x0 + d, y: b.y0 };
    d -= W;
    if (d < H) return { x: b.x1, y: b.y0 + d };
    d -= H;
    if (d < W) return { x: b.x1 - d, y: b.y1 };
    d -= W;
    return { x: b.x0, y: b.y1 - d };
  }

  /** Is a car on top of (x, y)? */
  private carHits(x: number, y: number): boolean {
    return this.lanes.some((lane) => lane.cars.some((car) => {
      const q = this.carAt(lane, car);
      const along = lane.axis === 'x' ? Math.abs(q.x - x) : Math.abs(q.y - y);
      const across = lane.axis === 'x' ? Math.abs(q.y - y) : Math.abs(q.x - x);
      return along < CAR_HALF_L + 0.2 && across < CAR_HALF_W + 0.2;
    }));
  }

  /** On the ground: walk, eat, dodge cars; people near you run off. */
  private stepGround(dt: number, events: CityEvent[]): void {
    // People run away from a pigeon on the ground.
    for (const w of this.walkers) {
      const here = this.walkerAt(w);
      w.fleeing = this.grounded && Math.hypot(here.x - this.pos.x, here.y - this.pos.y) < FLEE_RANGE;
      if (!w.fleeing) continue;
      // Whichever way round the block takes them further away.
      const ahead = this.walkerAt({ ...w, start: w.start + 0.01 }), back = this.walkerAt({ ...w, start: w.start - 0.01 });
      const dir = Math.hypot(ahead.x - this.pos.x, ahead.y - this.pos.y) > Math.hypot(back.x - this.pos.x, back.y - this.pos.y) ? 1 : -1;
      w.start += dir * FLEE_SPEED * dt;
    }
    for (const f of this.food) if (f.gone > 0 && (f.gone -= dt) <= 0) this.placeFood(f);
    if (!this.grounded) return;
    if (this.squashT > 0) {
      if ((this.squashT -= dt) <= 0) {
        // Back on its feet, on the nearest bit of sidewalk.
        let best = this.pos, bestD = Infinity;
        for (const sw of this.sidewalks) {
          for (let u = 0; u < 1; u += 0.01) {
            const p = this.perimeter(sw, u), d = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
            if (d < bestD) [best, bestD] = [p, d];
          }
        }
        this.pos = { ...best };
        events.push({ type: 'unsquash' });
      }
      return;
    }
    // Junk food!
    for (const f of this.food) {
      if (f.gone > 0 || Math.hypot(f.x - this.pos.x, f.y - this.pos.y) > FOOD_REACH) continue;
      f.gone = FOOD_RESPAWN;
      this.energy = Math.min(ENERGY_MAX, this.energy + FOOD_ENERGY);
      events.push({ type: 'eatFood', kind: f.kind });
    }
    if (this.energy >= ENERGY_MAX) {
      this.grounded = false; // full of beans: up, up and away
      events.push({ type: 'takeOff' });
      return;
    }
    // Look out!
    if (this.alt < GROUND_ALT + 0.3 && this.carHits(this.pos.x, this.pos.y)) {
      this.squashT = SQUASH_TIME;
      this.points += SQUASH_POINTS;
      events.push({ type: 'squashed', points: SQUASH_POINTS });
    }
  }

  /** The middle of the park, where the trophy stands. */
  static trophy(): { x: number; y: number } {
    return { x: (PARK.bx + 0.5) * BLOCK, y: (PARK.by + 0.5) * BLOCK };
  }

  /** Space: bombs away. */
  poop(events: CityEvent[]): void {
    if (this.phase !== 'free' || this.poopT > 0 || this.grounded) return;
    this.poopT = POOP_COOLDOWN;
    this.poops.push({ id: this.nextId++, x: this.pos.x, y: this.pos.y, z: this.alt - 0.15, vx: this.vel.x * 0.8, vy: this.vel.y * 0.8, vz: 0 });
    events.push({ type: 'poop' });
  }

  /** The skip button: straight off to the park; or, on the way there, straight into the trophy. */
  skip(events: CityEvent[]): void {
    if (this.phase === 'free') {
      this.points = Math.max(this.points, POINTS_TO_WIN);
      this.win(events);
    } else if (this.phase === 'homing') this.land(events);
  }

  private win(events: CityEvent[]): void {
    this.phase = 'homing';
    this.phaseT = 0;
    events.push({ type: 'cityWin' });
  }

  private land(events: CityEvent[]): void {
    const tr = City.trophy();
    this.pos = { ...tr };
    this.alt = TROPHY_RIM;
    this.phase = 'landed';
    this.phaseT = 0;
    events.push({ type: 'landTrophy' });
  }

  private stepPoops(dt: number, events: CityEvent[]): void {
    for (const s of this.splats) s.t += dt;
    this.splats = this.splats.filter((s) => s.t < SPLAT_LIFE);
    const keep: Poop[] = [];
    for (const p of this.poops) {
      const z0 = p.z;
      p.vz -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // A person's head?
      if (z0 >= HEAD_TOP - 0.3 && p.z < HEAD_TOP) {
        const hit = this.walkers.findIndex((w) => {
          const q = this.walkerAt(w);
          return Math.hypot(q.x - p.x, q.y - p.y) < PERSON_R;
        });
        if (hit >= 0) {
          this.score(PERSON_POINTS, events);
          events.push({ type: 'hitPerson', x: p.x, y: p.y, points: PERSON_POINTS });
          this.splats.push({ id: p.id, x: p.x, y: p.y, z: HEAD_TOP, on: 'person', t: 0 });
          continue;
        }
      }
      // A car's roof?
      if (z0 >= CAR_TOP && p.z < CAR_TOP) {
        let hitLane = -1, hitCar = -1;
        this.lanes.forEach((lane, li) => lane.cars.forEach((car, ci) => {
          const q = this.carAt(lane, car);
          const along = lane.axis === 'x' ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y);
          const across = lane.axis === 'x' ? Math.abs(q.y - p.y) : Math.abs(q.x - p.x);
          if (along < CAR_HALF_L && across < CAR_HALF_W) [hitLane, hitCar] = [li, ci];
        }));
        if (hitLane >= 0) {
          this.score(CAR_POINTS, events);
          events.push({ type: 'hitCar', x: p.x, y: p.y, points: CAR_POINTS });
          this.splats.push({ id: p.id, x: p.x, y: p.y, z: CAR_TOP, on: 'car', lane: hitLane, car: hitCar, t: 0 });
          continue;
        }
      }
      if (p.z <= 0.2) {
        events.push({ type: 'splat' });
        this.splats.push({ id: p.id, x: p.x, y: p.y, z: 0.2, on: 'ground', t: 0 });
        continue;
      }
      keep.push(p);
    }
    this.poops = keep;
  }

  private score(points: number, events: CityEvent[]): void {
    this.points += points;
    if (this.phase === 'free' && this.points >= POINTS_TO_WIN) this.win(events);
  }

  /** Off to the park: up over the rooftops, across, and down into the trophy. */
  private home(dt: number, events: CityEvent[]): void {
    const tr = City.trophy();
    const dx = tr.x - this.pos.x, dy = tr.y - this.pos.y, d = Math.hypot(dx, dy);
    this.moving = true;
    if (d > 0.3) {
      this.heading = Math.atan2(dy, dx);
      // Climb first; cruise once high enough; glide down as it nears.
      const high = this.alt >= CRUISE_ALT - 1;
      if (!high && d > 12) this.alt = Math.min(CRUISE_ALT, this.alt + CLIMB_SPEED * dt);
      if (high || d <= 12 || this.alt > 20) {
        const step = Math.min(d, CRUISE_SPEED * dt);
        this.pos.x += (dx / d) * step;
        this.pos.y += (dy / d) * step;
      }
      if (d < 12) this.alt = Math.max(TROPHY_RIM, this.alt - Math.max(4, this.alt - TROPHY_RIM) * 1.6 * dt);
    } else {
      this.alt = Math.max(TROPHY_RIM, this.alt - 6 * dt);
      if (this.alt <= TROPHY_RIM + 0.01) this.land(events);
    }
  }

  update(dt: number, input: Dir | null, events: CityEvent[]): void {
    this.t += dt;
    this.bumpT -= dt;
    this.poopT -= dt;
    this.moving = false;
    this.phaseT += dt;
    const before = { ...this.pos };
    this.stepPoops(dt, events);
    if (this.phase === 'landed') {
      if (this.phaseT - dt < FIREWORKS_TIME && this.phaseT >= FIREWORKS_TIME) events.push({ type: 'victory' });
      return;
    }
    if (this.phase === 'homing') {
      this.home(dt, events);
      return;
    }
    // Energy: flying burns it; at 0, down it comes.
    if (!this.grounded) {
      this.energy = Math.max(0, this.energy - ENERGY_DRAIN * dt);
      if (this.energy <= 0) {
        this.grounded = true;
        events.push({ type: 'tired' });
      }
    }
    const targetAlt = this.grounded ? GROUND_ALT : FLY_HEIGHT;
    this.alt += Math.sign(targetAlt - this.alt) * Math.min(Math.abs(targetAlt - this.alt), ALT_RATE * dt);
    this.stepGround(dt, events);
    this.vel = { x: 0, y: 0 };
    if (!input || this.squashT > 0) return;
    const target = ANGLE[input];
    const diff = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    const step = (this.grounded ? WALK_SPEED : BUTTERFLY_SPEED) * dt;
    const nx = this.pos.x + Math.cos(this.heading) * step, ny = this.pos.y + Math.sin(this.heading) * step;
    if (this.blocked(nx, ny)) {
      if (this.bumpT <= 0) {
        this.bumpT = 0.8;
        events.push({ type: 'bump' }); // bonk, against a wall
      }
      return;
    }
    this.pos = { x: nx, y: ny };
    this.moving = true;
    this.vel = { x: (this.pos.x - before.x) / dt, y: (this.pos.y - before.y) / dt };
  }
}
