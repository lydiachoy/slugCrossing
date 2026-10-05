import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHASE_SPEED, EAT_TIME, GARDEN_START, GARDEN_Y0, GARDEN_Y1, Garden, REGROW_TIME, VEG_VALUE, VISION_RANGE,
  type GardenEvent,
} from '../src/garden.ts';
import { HALF_W } from '../src/layout.ts';
import type { Dir } from '../src/sim.ts';

const STEP = 1 / 120;
const snail = (x = GARDEN_START.x, y = GARDEN_START.y) => ({ x, y, facing: 'up' as Dir, moving: false });

function run(g: Garden, s: ReturnType<typeof snail>, secs: number, input: Dir | null = null): GardenEvent[] {
  const events: GardenEvent[] = [];
  for (let t = 0; t < secs; t += STEP) g.update(STEP, input, s, events);
  return events;
}

/** A garden with the gardener parked out of the way, looking at nothing. */
function quiet(seed = 1): Garden {
  const g = new Garden(seed);
  Object.assign(g.gardener, { x: -HALF_W + 0.4, y: GARDEN_Y1, gaze: Math.PI, heading: Math.PI, state: 'pause', t: -1e9 });
  return g;
}

test('the garden is full of rocks and vegetables, laid out the same for the same seed', () => {
  const a = new Garden(5), b = new Garden(5);
  assert.deepEqual(a.rocks, b.rocks);
  assert.ok(a.rocks.length >= 5, `${a.rocks.length} rocks`);
  assert.ok(a.veg.length >= 14, `${a.veg.length} vegetables`);
  for (const v of a.veg) assert.ok(!a.blocked(v.x, v.y, v.r), 'no vegetable inside a rock');
  assert.ok(!a.blocked(GARDEN_START.x, GARDEN_START.y, 0.5), 'the way in is clear');
});

test('the snail eats a vegetable by staying on it; it grows back later', () => {
  const g = quiet();
  const v = g.veg[0];
  const s = snail(v.x, v.y - v.r - 0.2);
  const events = run(g, s, EAT_TIME + 0.2);
  const eaten = events.find((e) => e.type === 'vegEaten');
  assert.ok(eaten && eaten.type === 'vegEaten' && eaten.value === VEG_VALUE[v.kind]);
  assert.ok(events.filter((e) => e.type === 'vegBite').length >= 3, 'chomp chomp chomp');
  assert.equal(v.eaten, 1);
  s.x = 99; // wander off
  const later = run(g, s, REGROW_TIME + 0.1);
  assert.ok(later.some((e) => e.type === 'vegRegrow' && e.id === v.id));
  assert.equal(v.eaten, 0);
});

test('rocks are solid', () => {
  const g = quiet();
  const r = g.rocks[0];
  const s = snail(r.x, r.y - r.r - 1);
  run(g, s, 3, 'up');
  assert.ok(Math.hypot(s.x - r.x, s.y - r.y) >= r.r + 0.27, 'pushed round, not through');
});

test('the gardener sees a snail in his cone, but not behind a rock', () => {
  const g = new Garden(3);
  const r = g.rocks[0];
  // Stand him a few units from the rock, looking straight at it.
  const gx = r.x, gy = r.y - r.r - 2.5;
  Object.assign(g.gardener, { x: gx, y: gy, gaze: Math.PI / 2, heading: Math.PI / 2 });
  assert.equal(g.canSee(r.x, r.y + r.r + 0.35), false, 'hidden behind the rock');
  assert.equal(g.canSee(gx + 0.3, gy + 1.5), true, 'out in the open in front of him');
  assert.equal(g.canSee(gx, gy - 2), false, 'behind his back');
  assert.equal(g.canSee(gx, gy + VISION_RANGE + 1), false, 'too far away');
});

/** Run until an event of this type happens (or give up after `limit` seconds). */
function until(g: Garden, s: ReturnType<typeof snail>, type: GardenEvent['type'], limit: number, input: Dir | null = null): number {
  for (let t = 0; t < limit; t += STEP) {
    const events: GardenEvent[] = [];
    g.update(STEP, input, s, events);
    if (events.some((e) => e.type === type)) return t;
  }
  return Infinity;
}

test('spotted: he runs over, picks the snail up, and throws it off the map', () => {
  const g = new Garden(3);
  g.rocks = []; // open ground, so nothing hides it
  const s = snail(0, GARDEN_Y0 + 3);
  Object.assign(g.gardener, { x: 0, y: GARDEN_Y0 + 6, gaze: -Math.PI / 2, heading: -Math.PI / 2, state: 'pause', t: 0 });
  assert.ok(until(g, s, 'spotted', 0.1) < 0.1);
  assert.ok(until(g, s, 'caught', 0.6 + 3 / (CHASE_SPEED - 1.1) + 0.5, 'down') < Infinity, 'it can\'t outrun him');
  assert.equal(g.phase, 'caught');
  assert.ok(until(g, s, 'thrown', 1.5) < Infinity);
  run(g, s, 0.9);
  assert.equal(g.phase, 'thrown');
  assert.ok(Math.abs(s.x) > HALF_W || s.y > GARDEN_Y1, `off the map (at ${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
});

test('after being thrown the snail comes back behind the rock nearest where it was caught', () => {
  const g = new Garden(3);
  const near = g.rocks[0];
  const s = snail(near.x + near.r + 0.6, near.y);
  Object.assign(g.gardener, { x: s.x + 1.5, y: s.y, gaze: Math.PI, heading: Math.PI, state: 'pause', t: 0 });
  const events = run(g, s, 6);
  assert.ok(events.some((e) => e.type === 'caught'));
  assert.ok(events.some((e) => e.type === 'gardenRespawn'));
  assert.equal(g.phase, 'free');
  const nearest = g.rocks.reduce((a, b) => (Math.hypot(b.x - s.x, b.y - s.y) < Math.hypot(a.x - s.x, a.y - s.y) ? b : a));
  assert.equal(nearest, near, 'by the same rock');
  assert.ok(Math.hypot(s.x - near.x, s.y - near.y) < near.r + 0.6, 'tucked right up against it');
});
