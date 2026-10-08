import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK, BUTTERFLY_SPEED, CAR_POINTS, ENERGY_DRAIN, ENERGY_MAX, FOOD_ENERGY, GROUND_ALT, SQUASH_POINTS, SQUASH_TIME, CITY_W, City, FIREWORKS_TIME, GRID, PARK, PERSON_POINTS, POINTS_TO_WIN, ROAD, TROPHY_RIM,
  type CityEvent, type Walker,
} from '../src/city.ts';

const STEP = 1 / 120;

test('a city of tall buildings on a grid of streets, with traffic and people walking', () => {
  const c = new City(1);
  assert.ok(c.buildings.length >= GRID * GRID, `${c.buildings.length} buildings`);
  for (const b of c.buildings) {
    assert.ok(b.h >= 15 && b.h <= 60, 'tall');
    // Never in the road.
    for (let k = 0; k <= GRID; k++) {
      assert.ok(b.x1 < k * BLOCK - ROAD / 2 || b.x0 > k * BLOCK + ROAD / 2, 'clear of north–south roads');
      assert.ok(b.y1 < k * BLOCK - ROAD / 2 || b.y0 > k * BLOCK + ROAD / 2, 'clear of east–west roads');
    }
  }
  assert.ok(c.lanes.length >= (GRID + 1) * 4);
  assert.ok(c.lanes.reduce((n, l) => n + l.cars.length, 0) > 100, 'lots of cars');
  assert.ok(c.walkers.length > 100, 'lots of people');
  assert.ok(!c.blocked(c.pos.x, c.pos.y), 'the butterfly lands in the open');
});

test('cars drive along their lanes; people walk round their blocks on the sidewalk', () => {
  const c = new City(1);
  const lane = c.lanes[0], car = lane.cars[0];
  const a = c.carAt(lane, car);
  c.update(1, null, []);
  const b = c.carAt(lane, car);
  const moved = lane.axis === 'x' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  assert.ok(Math.abs(moved - lane.speed) < 0.01 || moved > CITY_W - lane.speed - 1, 'moved at its speed (or looped round)');
  for (const w of c.walkers.slice(0, 30)) {
    const p = c.walkerAt(w);
    const onEdge = Math.abs(p.x - w.block.x0) < 1e-6 || Math.abs(p.x - w.block.x1) < 1e-6 || Math.abs(p.y - w.block.y0) < 1e-6 || Math.abs(p.y - w.block.y1) < 1e-6;
    assert.ok(onEdge, 'on the sidewalk round the block');
    assert.ok(!c.buildings.some((bd) => p.x > bd.x0 && p.x < bd.x1 && p.y > bd.y0 && p.y < bd.y1), 'not walking through walls');
  }
});

test('the butterfly flies down the street, but not through buildings', () => {
  const c = new City(1);
  for (let t = 0; t < 0.3; t += STEP) c.update(STEP, 'right', []); // turn to face east
  const x0 = c.pos.x;
  for (let t = 0; t < 1; t += STEP) c.update(STEP, 'right', []);
  assert.ok(Math.abs(c.pos.x - x0 - BUTTERFLY_SPEED) < 0.2, 'down the street');
  // Head for a wall.
  const b = c.buildings[0];
  c.pos = { x: (b.x0 + b.x1) / 2, y: b.y0 - 1.5 };
  c.heading = Math.PI / 2;
  const events: { type: string }[] = [];
  for (let t = 0; t < 2; t += STEP) c.update(STEP, 'up', events as never);
  assert.ok(c.pos.y < b.y0, 'stopped at the wall');
  assert.ok(events.some((e) => e.type === 'bump'));
});

function run(c: City, secs: number, input: Parameters<City['update']>[1] = null): CityEvent[] {
  const events: CityEvent[] = [];
  for (let t = 0; t < secs; t += STEP) c.update(STEP, input, events);
  return events;
}

/** A city with nothing moving, so a test can put exactly what it wants below the pigeon. */
function still(): City {
  const c = new City(1);
  for (const l of c.lanes) l.cars = [];
  c.walkers = [];
  return c;
}

test('Space drops a poop, which falls onto the ground and leaves a splat', () => {
  const c = still();
  const events: CityEvent[] = [];
  c.poop(events);
  assert.ok(events.some((e) => e.type === 'poop'));
  c.poop(events);
  assert.equal(c.poops.length, 1, 'one at a time (a short cooldown)');
  const fall = run(c, 1);
  assert.ok(fall.some((e) => e.type === 'splat'));
  assert.equal(c.poops.length, 0);
  assert.equal(c.splats[0].on, 'ground');
  assert.equal(c.points, 0);
});

test('hit a car: +3; hit a person: −5', () => {
  const c = still();
  // A car parked right under the pigeon (speed 0).
  c.lanes[0].cars = [{ offset: 0, color: 0xff0000 }];
  c.lanes[0].speed = 0;
  const at = c.carAt(c.lanes[0], c.lanes[0].cars[0]);
  c.pos = { ...at };
  c.poop([]);
  const hit = run(c, 1);
  assert.ok(hit.some((e) => e.type === 'hitCar'));
  assert.equal(c.points, CAR_POINTS);
  // Someone on the sidewalk, standing still.
  c.lanes[0].cars = [];
  const w = { block: { x0: 10, y0: 10, x1: 12, y1: 12 }, start: 0, speed: 0, shirt: 0, skin: 0 };
  c.walkers = [w];
  c.pos = { x: 10, y: 10 };
  (c as unknown as { poopT: number }).poopT = 0;
  c.poop([]);
  const oops = run(c, 1);
  assert.ok(oops.some((e) => e.type === 'hitPerson'));
  assert.equal(c.points, CAR_POINTS + PERSON_POINTS);
});

test('a poop keeps some of the pigeon\'s speed: you have to lead your target', () => {
  const c = still();
  run(c, 0.4, 'right');
  const x = c.pos.x;
  run(c, 0.3, 'right');
  c.poop([]);
  run(c, 1);
  assert.ok(c.splats[0].x > c.pos.x - 0.5 || c.splats[0].x > x + 1, 'carried forward');
});

test('100 points: off to the park, over the rooftops, and into the giant trophy — then fireworks and victory', () => {
  const c = still();
  assert.ok(!c.buildings.some((b) => b.x0 > PARK.bx * BLOCK && b.x1 < (PARK.bx + 1) * BLOCK && b.y0 > PARK.by * BLOCK && b.y1 < (PARK.by + 1) * BLOCK), 'the park has no buildings');
  c.points = POINTS_TO_WIN - CAR_POINTS;
  c.lanes[0].cars = [{ offset: 0, color: 0 }];
  c.lanes[0].speed = 0;
  c.pos = { ...c.carAt(c.lanes[0], c.lanes[0].cars[0]) };
  c.poop([]);
  const win = run(c, 1);
  assert.ok(win.some((e) => e.type === 'cityWin'));
  assert.equal(c.phase, 'homing');
  let maxAlt = 0;
  const events: CityEvent[] = [];
  for (let t = 0; t < 30 && c.phase === 'homing'; t += STEP) {
    c.update(STEP, 'left', events); // (it flies itself now)
    maxAlt = Math.max(maxAlt, c.alt);
  }
  assert.ok(events.some((e) => e.type === 'landTrophy'));
  assert.equal(c.phase, 'landed');
  assert.ok(maxAlt > 60, 'flew up over the rooftops');
  const tr = City.trophy();
  assert.ok(Math.hypot(c.pos.x - tr.x, c.pos.y - tr.y) < 0.01 && c.alt === TROPHY_RIM, 'sitting in the trophy');
  assert.ok(run(c, FIREWORKS_TIME + 0.1).some((e) => e.type === 'victory'));
});

test('no pooping on the way to the park', () => {
  const c = still();
  c.skip([]);
  const events: CityEvent[] = [];
  c.poop(events);
  assert.equal(events.length, 0);
});

// ---- energy, walking and junk food -------------------------------------------------

test('flying burns 5 energy a second; at 0 the pigeon comes down and has to walk', () => {
  const c = still();
  assert.equal(c.energy, ENERGY_MAX);
  run(c, 4, null);
  assert.ok(Math.abs(c.energy - (ENERGY_MAX - 4 * ENERGY_DRAIN)) < 0.1);
  const down = run(c, ENERGY_MAX / ENERGY_DRAIN, null);
  assert.ok(down.some((e) => e.type === 'tired'));
  assert.ok(c.grounded);
  assert.ok(Math.abs(c.alt - GROUND_ALT) < 0.01, 'on the ground');
  const events: CityEvent[] = [];
  (c as unknown as { poopT: number }).poopT = 0;
  c.poop(events);
  assert.equal(events.length, 0, 'no pooping while walking');
});

test('junk food gives 40 energy; at 100 it flies again', () => {
  const c = still();
  c.energy = 0.001;
  run(c, 1, null);
  assert.ok(c.grounded);
  assert.equal(c.food.length >= 20, true);
  let eaten = 0;
  c.food = c.food.slice(0, 3).map((f, i) => ({ ...f, x: 20 + i * 20, y: 10 })); // three pieces, well apart
  for (const f of c.food) {
    c.pos = { x: f.x, y: f.y };
    const events = run(c, 0.05, null);
    if (events.some((e) => e.type === 'eatFood')) eaten++;
    if (eaten < 3) assert.ok(Math.abs(c.energy - eaten * FOOD_ENERGY) < 0.5, `energy ${c.energy}`);
  }
  assert.equal(eaten, 3);
  assert.ok(c.energy > ENERGY_MAX - 1, 'topped up (and already burning it again)');
  assert.ok(!c.grounded, 'flying again');
  run(c, 1, null);
  assert.ok(c.alt > 2, 'up in the air');
});

test('people run away from a pigeon on the ground', () => {
  const c = still();
  const w: Walker = { block: { x0: 10, y0: 10, x1: 20, y1: 20 }, start: 0.05, speed: 0, shirt: 0, skin: 0 };
  c.walkers = [w];
  c.energy = 0.001;
  run(c, 1, null);
  const p0 = c.walkerAt(w);
  c.pos = { x: p0.x + 1.5, y: p0.y - 0.5 };
  run(c, 1, null);
  assert.ok(w.fleeing);
  const p1 = c.walkerAt(w);
  assert.ok(Math.hypot(p1.x - c.pos.x, p1.y - c.pos.y) > Math.hypot(p0.x - c.pos.x, p0.y - c.pos.y) + 1, 'ran off');
});

test('walking in the road: a car flattens you (−10), then you\'re back on the sidewalk', () => {
  const c = still();
  c.energy = 0.001;
  run(c, 1, null);
  const lane = c.lanes.find((l) => l.axis === 'x' && l.at > 2 * BLOCK)!;
  lane.cars = [{ offset: 0.5, color: 0 }];
  lane.speed = 0;
  c.pos = { ...c.carAt(lane, lane.cars[0]) };
  const hit = run(c, 0.1, null);
  assert.ok(hit.some((e) => e.type === 'squashed'));
  assert.equal(c.points, SQUASH_POINTS);
  const up = run(c, SQUASH_TIME, null);
  assert.ok(up.some((e) => e.type === 'unsquash'));
  assert.ok(!c.blocked(c.pos.x, c.pos.y));
  const fromRoad = Math.min(c.pos.y % BLOCK, BLOCK - (c.pos.y % BLOCK));
  assert.ok(fromRoad > 2.5, `on the sidewalk, out of the road (${fromRoad.toFixed(2)} from the middle)`);
  assert.ok(run(c, 1, null).every((e) => e.type !== 'squashed'), 'and safe there');
});
