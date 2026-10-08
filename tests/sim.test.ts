import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSSWALK_HALF, DEATH_TIME, DUMP_EVERY, GOAL_ROW, GREEN_TIME, Game, HALF_W, LIVES, MUNCH_TIME, RED_TIME, SALT_LIFE,
  SLOTS, SLOWMO_TIME, SLOW_TRAFFIC, SLUG_SPEED, VEHICLE_LEN, WARN_TIME, type Npc,
  BIRD_CARRY, BIRD_DIVE, BIRD_EVERY, MASH_TIME, ASCEND_TIME, SHELL_FALL, SNAIL_BONUS, PORTAL_MORPH, PORTAL_TIME,
  type Dir, type GameEvent, type Vehicle, type VehicleKind,
} from '../src/sim.ts';
import { GARDEN_START, Garden } from '../src/garden.ts';
import { Underground } from '../src/underground.ts';

const STEP = 1 / 120;

function run(game: Game, seconds: number, input: Dir | null = null): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) events.push(...game.update(STEP, input));
  return events;
}

/** A started game with the road cleared (and the light stuck on green), so only what the test adds can hit the slug. */
function emptyRoad(opts: { infiniteLives?: boolean } = { infiniteLives: false }): Game {
  const g = new Game(1, opts);
  g.start();
  g.vehicles = [];
  (g as unknown as { laneTimers: number[] }).laneTimers.fill(Infinity);
  g.light = { red: false, timer: Infinity };
  (g as unknown as { npcTimer: number }).npcTimer = Infinity; // no rival slugs unless a test adds them
  (g as unknown as { dumpTimer: number }).dumpTimer = Infinity; // nor salt trucks
  (g as unknown as { birdTimer: number }).birdTimer = Infinity; // nor birds
  return g;
}

let nextId = 1000;
/** A vehicle cruising at full speed. */
function car(row: number, x: number, speed: number, kind: VehicleKind = 'car'): Vehicle {
  return { id: nextId++, kind, row, x, len: VEHICLE_LEN[kind], speed, vel: Math.abs(speed), runsLight: false, side: Math.sign(x) || 1 };
}

test('same seed, same traffic', () => {
  const a = new Game(42), b = new Game(42);
  run(a, 5);
  run(b, 5);
  assert.deepEqual(a.vehicles, b.vehicles);
});

test('every lane gets traffic within a few seconds', () => {
  const g = new Game(3);
  const rows = new Set<number>();
  for (let t = 0; t < 6; t += STEP) {
    g.update(STEP, null);
    for (const v of g.vehicles) if (Math.abs(v.x) < HALF_W) rows.add(v.row);
  }
  assert.deepEqual([...rows].sort((a, b) => a - b), [1, 2, 3, 4, 6, 7, 8, 9]);
});

test('traffic is much faster than the slug', () => {
  const g = new Game(5);
  const slowest = Math.min(...g.vehicles.map((v) => Math.abs(v.speed)));
  assert.ok(slowest >= SLUG_SPEED * 10, `slowest vehicle ${slowest}`);
});

test('the slug crawls at its own slow pace', () => {
  const g = emptyRoad();
  run(g, 1, 'right');
  assert.ok(Math.abs(g.slug.x - SLUG_SPEED) < 0.02);
  assert.equal(g.slug.facing, 'right');
});

test('the slug stays on the playfield', () => {
  const g = emptyRoad();
  run(g, 12, 'left');
  assert.ok(g.slug.x >= -HALF_W);
  run(g, 1, 'down');
  assert.equal(g.slug.y, 0);
});

test('a vehicle in the slug\'s lane squishes it', () => {
  const g = emptyRoad();
  g.slug.y = 2;
  g.vehicles.push(car(2, -4, 20));
  const events = run(g, 0.5);
  assert.ok(events.some((e) => e.type === 'squish'));
  assert.equal(g.state, 'dying');
  run(g, DEATH_TIME);
  assert.equal(g.lives, LIVES - 1);
  assert.equal(g.state, 'playing');
  assert.equal(g.slug.y, 0, 'back at the start');
});

test('a vehicle in the next lane only whooshes past', () => {
  const g = emptyRoad();
  g.slug.y = 2;
  g.vehicles.push(car(3, -4, 20));
  const events = run(g, 0.5);
  assert.equal(g.state, 'playing');
  assert.ok(events.some((e) => e.type === 'whoosh'));
});

test('once across the first road, a slug that dies respawns on the median', () => {
  const g = emptyRoad();
  run(g, 5.6, 'up'); // from the start to the median (row 5)
  assert.equal(g.checkpoint, 5);
  g.powerups = []; // (the slow-mo power-up that just appeared would change the timing)
  g.slug.y = 7;
  g.vehicles.push(car(7, -4, 20));
  run(g, DEATH_TIME + 0.4);
  assert.equal(g.lives, LIVES - 1);
  assert.equal(g.state, 'playing');
  assert.equal(g.slug.y, 5, 'back on the median, not the start');
  assert.equal(g.slug.moisture, 100);
});

test('reaching the lettuce sends the next slug back to the start', () => {
  const g = emptyRoad();
  g.checkpoint = 5;
  g.slug.x = SLOTS[2];
  g.slug.y = GOAL_ROW - 0.6;
  run(g, 0.1, 'up');
  assert.ok(g.filled[2]);
  assert.equal(g.state, 'munching', 'a victory chomp first');
  assert.equal(g.slug.facing, 'down', 'facing the camera');
  run(g, MUNCH_TIME, 'up');
  assert.equal(g.state, 'playing');
  assert.equal(g.checkpoint, 0);
  assert.ok(g.slug.y < 0.1, 'back at the start');
});

test('asphalt dries the slug out; grass soaks it back up', () => {
  const g = emptyRoad();
  g.slug.y = 1;
  run(g, 10);
  assert.ok(g.slug.moisture < 60);
  g.slug.y = 0;
  run(g, 2);
  assert.equal(g.slug.moisture, 100);
  g.slug.y = 1;
  const events = run(g, 25);
  assert.ok(events.some((e) => e.type === 'dried'));
});

test('lanes warn before a vehicle drives in', () => {
  const g = emptyRoad();
  g.vehicles.push(car(1, -HALF_W - 0.9 - 20 * WARN_TIME * 0.5, 20));
  assert.deepEqual(g.warnings(), [{ row: 1, side: -1 }]);
  g.vehicles[0].x = -40; // two seconds out: too early to warn
  assert.deepEqual(g.warnings(), []);
});

test('the hedge blocks the goal except at a free lettuce patch', () => {
  const g = emptyRoad();
  g.slug.x = -4.5; // between patches
  g.slug.y = GOAL_ROW - 0.6;
  run(g, 1, 'up');
  assert.ok(g.slug.y < GOAL_ROW - 0.5);
  g.slug.x = SLOTS[1];
  const events = run(g, 0.2, 'up');
  assert.ok(events.some((e) => e.type === 'munch' && e.slot === 1));
  assert.ok(g.filled[1]);
  run(g, MUNCH_TIME);
  assert.ok(g.slug.y < 0.5, 'a new slug starts at the bottom');
  // A filled patch blocks like hedge.
  g.slug.x = SLOTS[1];
  g.slug.y = GOAL_ROW - 0.6;
  run(g, 1, 'up');
  assert.ok(g.slug.y < GOAL_ROW - 0.5);
});

test('eating the fifth lettuce brings down the golden shell: the slug becomes a snail', () => {
  const g = emptyRoad();
  g.filled = [true, true, true, true, false];
  g.slug.x = SLOTS[4];
  g.slug.y = GOAL_ROW - 0.6;
  const events = run(g, 0.2 + MUNCH_TIME, 'up');
  assert.ok(events.some((e) => e.type === 'ascend'), 'after the munch');
  assert.equal(g.state, 'ascending');
  assert.ok(g.garden);
  const score = g.score;
  const landing = run(g, SHELL_FALL + 0.1);
  assert.ok(landing.some((e) => e.type === 'shellLands'));
  assert.equal(g.score, score + SNAIL_BONUS);
  assert.ok(g.isSnail);
  const arrive = run(g, ASCEND_TIME - SHELL_FALL);
  assert.ok(arrive.some((e) => e.type === 'gardenStart'));
  assert.equal(g.state, 'garden');
  assert.ok(Math.abs(g.slug.y - GARDEN_START.y) < 0.01, 'at the garden gate');
});

test('losing every life ends the game; start() begins a fresh one', () => {
  const g = emptyRoad();
  assert.equal(LIVES, 10);
  for (let i = 0; i < LIVES; i++) {
    assert.equal(g.state, 'playing', `life ${i + 1}`);
    g.slug.y = 1;
    g.vehicles = [car(1, 0, 3, 'truck')];
    g.powerups = []; // no 1UPs, or this would never end
    run(g, DEATH_TIME + 0.1);
  }
  assert.equal(g.state, 'gameOver');
  g.start();
  assert.equal(g.state, 'playing');
  assert.equal(g.lives, LIVES);
  assert.equal(g.score, 0);
});

// ---- the traffic light on the first road ----------------------------------------

test('the light alternates, red for 3–10 s and green for 5–20 s', () => {
  const g = new Game(11);
  const spans: { red: boolean; secs: number }[] = [];
  let since = 0, red = g.light.red;
  for (let t = 0; t < 600; t += STEP) {
    for (const e of g.update(STEP, null)) {
      if (e.type !== 'light') continue;
      spans.push({ red, secs: since });
      red = e.red;
      since = 0;
    }
    since += STEP;
  }
  spans.shift(); // the first span started before we were watching
  assert.ok(spans.length > 20);
  for (const s of spans) {
    const [lo, hi] = s.red ? RED_TIME : GREEN_TIME;
    assert.ok(s.secs >= lo - 0.02 && s.secs <= hi + 0.02, `${s.red ? 'red' : 'green'} lasted ${s.secs.toFixed(2)} s`);
  }
  assert.ok(spans.some((s) => s.red) && spans.some((s) => !s.red));
});

test('on red, traffic on the first road stops short of the crosswalk and queues', () => {
  const g = emptyRoad();
  g.light = { red: true, timer: Infinity };
  g.vehicles.push(car(1, -12, 15), car(1, -16, 15), car(2, 12, -18));
  run(g, 3);
  const [a, b] = g.vehicles.filter((v) => v.row === 1).sort((p, q) => q.x - p.x);
  assert.ok(a.vel < 0.01 && b.vel < 0.01, 'stopped');
  assert.ok(Math.abs(a.x + a.len / 2 - -(CROSSWALK_HALF + 0.25)) < 0.05, `front bumper at ${a.x + a.len / 2}`);
  assert.ok(b.x + b.len / 2 < a.x - a.len / 2, 'queued behind, not overlapping');
  const left = g.vehicles.find((v) => v.row === 2)!;
  assert.ok(left.x - left.len / 2 > CROSSWALK_HALF, 'left-bound traffic stops on its side too');
  // The second road ignores the light.
  g.vehicles.push(car(6, 12, -16));
  run(g, 2);
  assert.equal(g.vehicles.some((v) => v.row === 6), false, 'drove straight through');
  // Green: the queue pulls away.
  g.light = { red: false, timer: Infinity };
  run(g, 3);
  assert.equal(g.vehicles.length, 0);
});

test('a car too close to stop when the light turns red runs it', () => {
  const g = emptyRoad();
  g.light = { red: false, timer: STEP / 2 }; // turns red on the next step
  g.vehicles.push(car(1, -3.3, 15)); // front bumper ~0.9 short of the line: no room to brake
  run(g, 1);
  assert.ok(g.vehicles.every((v) => v.x > 3), 'carried on through');
});

test('a car stopped at the light blocks the slug instead of squishing it', () => {
  const g = emptyRoad();
  g.light = { red: true, timer: Infinity };
  g.vehicles.push(car(1, -12, 15));
  run(g, 2);
  const stopped = g.vehicles[0];
  g.slug.x = stopped.x;
  g.slug.y = 0.2;
  run(g, 2, 'up');
  assert.equal(g.state, 'playing');
  assert.ok(g.slug.y < 0.5, `slug got to ${g.slug.y}`);
  // In the crosswalk, in front of the queue, it can cross...
  g.slug.x = 0;
  run(g, 1.5, 'up');
  assert.ok(g.slug.y > 1, 'crawled into the crosswalk');
  // ...but when the light goes green the car pulls away into it.
  g.slug.x = stopped.x + stopped.len / 2 + 0.3;
  g.slug.y = 1;
  g.light = { red: false, timer: Infinity };
  const events = run(g, 1);
  assert.ok(events.some((e) => e.type === 'squish'));
});

// ---- rival slugs -------------------------------------------------------------------

test('rival slugs turn up now and then, one or two at a time', () => {
  const g = new Game(3);
  g.start();
  let arrivals = 0, most = 0;
  for (let t = 0; t < 120; t += STEP) {
    for (const e of g.update(STEP, null)) if (e.type === 'npcArrive') arrivals++;
    most = Math.max(most, g.npcs.length);
  }
  assert.ok(arrivals >= 4, `${arrivals} arrivals`);
  assert.ok(most <= 2);
});

test('a rival slug that reaches a lettuce eats that patch', () => {
  const g = emptyRoad();
  g.npcs.push({ id: 500, x: SLOTS[3], y: 5, facing: 'up', moving: false, color: 2, state: 'waiting', timer: 0, slot: -1 });
  let munched = false;
  for (let t = 0; t < 8 && !munched; t += STEP) munched = g.update(STEP, null).some((e) => e.type === 'npcMunch' && e.slot === 3);
  assert.ok(munched);
  assert.ok(g.filled[3]);
  assert.equal(g.eater[3], 2);
  assert.equal(g.score, 0, 'no points for the player');
  run(g, MUNCH_TIME + 0.1);
  assert.equal(g.npcs.length, 0, 'it settles down for a nap and leaves the game');
});

test('a rival slug can be run over', () => {
  const g = emptyRoad();
  g.npcs.push({ id: 500, x: 2, y: 2, facing: 'up', moving: true, color: 1, state: 'crawling', timer: 0, slot: -1 });
  g.vehicles.push(car(2, -4, 20));
  const events = run(g, 0.5);
  assert.ok(events.some((e) => e.type === 'npcSquish' && e.id === 500));
  assert.equal(g.state, 'playing', 'the player is fine');
  assert.equal(g.lives, LIVES);
  run(g, DEATH_TIME);
  assert.equal(g.npcs.length, 0);
});

test('rival slugs look before leaving the grass', () => {
  const g = emptyRoad();
  g.slug.x = 5; // out of its way
  g.npcs.push({ id: 500, x: 0, y: 0, facing: 'up', moving: false, color: 1, state: 'waiting', timer: 0, slot: -1 });
  g.vehicles.push(car(1, -10, 13)); // under a second away
  run(g, 0.3);
  assert.equal(g.npcs[0].state, 'waiting');
  run(g, 1.5); // it's gone by
  assert.equal(g.npcs[0].state, 'crawling');
});

// ---- dings, power-ups, bumps and salt -----------------------------------------------

test('a ding for every lane crossed, once each', () => {
  const g = emptyRoad();
  const lanes = run(g, 5.6, 'up').filter((e) => e.type === 'lane').map((e) => (e as { row: number }).row);
  assert.deepEqual(lanes, [1, 2, 3, 4]);
  run(g, 1, 'down');
  run(g, 1, 'up');
  assert.equal(run(g, 0.5, 'up').filter((e) => e.type === 'lane').length, 0, 'no repeat dings');
});

test('reaching the median puts two slow-mo power-ups on the second road', () => {
  const g = emptyRoad();
  const events = run(g, 5.6, 'up');
  const spawned = events.filter((e) => e.type === 'powerup');
  assert.equal(spawned.length, 2);
  assert.equal(g.powerups.filter((p) => p.kind === 'slow').length, 2);
  for (const p of g.powerups) assert.ok(p.kind === 'slow' && p.y >= 6 && p.y <= 9 && Math.abs(p.x) < HALF_W);
  const [a, b] = g.powerups;
  assert.ok(a.y !== b.y || Math.abs(a.x - b.x) >= 1.5, 'not on top of each other');
});

test('slow-mo: traffic crawls, the slug doubles its speed, then back to normal after 8 s', () => {
  const g = emptyRoad();
  g.powerups = [{ id: 1, kind: 'slow', x: 0, y: 0.3 }];
  const events = run(g, 0.1, 'up');
  assert.ok(events.some((e) => e.type === 'pickup' && e.kind === 'slow'));
  assert.ok(g.slowmo > SLOWMO_TIME - 0.2);
  // Slug: twice as fast.
  const y0 = g.slug.y;
  run(g, 1, 'up');
  assert.ok(Math.abs(g.slug.y - y0 - SLUG_SPEED * 2) < 0.03, `moved ${g.slug.y - y0}`);
  // Traffic: a fraction of its speed.
  g.vehicles.push(car(7, -10, 20));
  run(g, 1);
  assert.ok(Math.abs(g.vehicles[0].x - (-10 + 20 * SLOW_TRAFFIC)) < 0.1, `car at ${g.vehicles[0].x}`);
  const end = run(g, SLOWMO_TIME);
  assert.ok(end.some((e) => e.type === 'slowmoEnd'));
  assert.equal(g.slowmo, 0);
  const x0 = g.vehicles[0]?.x ?? 0;
  if (g.vehicles.length) {
    run(g, 0.1);
    assert.ok(Math.abs(g.vehicles[0].x - x0 - 2) < 0.05, 'full speed again');
  }
});

test('every life lost drops a 1UP on the map; picking it up gives the life back', () => {
  const g = emptyRoad();
  g.slug.y = 2;
  g.vehicles.push(car(2, -4, 20));
  const events = run(g, 0.5);
  const oneUp = events.find((e) => e.type === 'powerup' && e.kind === 'life');
  assert.ok(oneUp, 'a 1UP appeared');
  run(g, DEATH_TIME);
  assert.equal(g.lives, LIVES - 1);
  const p = g.powerups.find((q) => q.kind === 'life')!;
  g.slug.x = p.x;
  g.slug.y = p.y - 0.3;
  const got = run(g, 0.1, 'up');
  assert.ok(got.some((e) => e.type === 'pickup' && e.kind === 'life'));
  assert.equal(g.lives, LIVES);
  assert.equal(g.powerups.length, 0);
});

test('a rival slug that bumps into the player goes flying off the map', () => {
  const g = emptyRoad();
  const n: Npc = { id: 500, x: 0.8, y: 0, facing: 'left', moving: true, color: 1, state: 'waiting', timer: 9, slot: -1 };
  g.npcs.push(n);
  const events = run(g, 0.6, 'right'); // the player crawls into it
  assert.ok(events.some((e) => e.type === 'npcBounce' && e.id === 500));
  assert.equal(g.state, 'playing', 'the player is fine');
  run(g, 1);
  const flying = g.npcs.find((q) => q.id === 500);
  assert.ok(flying && Math.abs(flying.x) > HALF_W, 'off the side of the map');
  assert.ok(flying.fling!.z > 1, 'and up in the air');
  run(g, 2);
  assert.equal(g.npcs.length, 0);
});

test('a salt truck turns up every 30 s to 1 min', () => {
  const g = new Game(4);
  g.start();
  const times: number[] = [];
  let t = 0;
  for (; t < 300; t += STEP) for (const e of g.update(STEP, null)) if (e.type === 'dumptruck') times.push(t);
  assert.ok(times.length >= 4, `${times.length} trucks`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= DUMP_EVERY[0] - 0.05 && gap <= DUMP_EVERY[1] + 3, `gap ${gap.toFixed(1)} s`);
  }
});

test('salt trails behind the truck for five seconds, and shrivels a slug that touches it', () => {
  const g = emptyRoad();
  g.vehicles.push({ ...car(2, 12, -15, 'dumptruck'), salty: true });
  run(g, 1.0);
  assert.ok(g.salt.length > 10, `${g.salt.length} patches`);
  assert.ok(g.salt.every((p) => p.row === 2 && p.t <= SALT_LIFE));
  run(g, 2.5); // the truck has gone, but its salt is still there...
  assert.ok(g.salt.length > 10);
  run(g, SALT_LIFE); // ...until five seconds after it was dropped
  assert.equal(g.salt.length, 0);

  const h = emptyRoad();
  h.salt = [{ id: 1, row: 1, x: 0, t: SALT_LIFE }];
  const events = run(h, 0.5, 'up');
  assert.ok(events.some((e) => e.type === 'salted'));
  assert.equal(h.deathCause, 'salted');
});

test('lives are infinite by default: dying never ends the game, and no 1UPs drop', () => {
  const g = emptyRoad({});
  assert.equal(g.infiniteLives, true);
  for (let i = 0; i < LIVES + 5; i++) {
    g.slug.y = 1;
    g.vehicles = [car(1, 0, 3, 'truck')];
    run(g, DEATH_TIME + 0.1);
    assert.equal(g.state, 'playing', `death ${i + 1}`);
  }
  assert.equal(g.lives, LIVES);
  assert.equal(g.powerups.filter((p) => p.kind === 'life').length, 0);
});

// ---- the bird --------------------------------------------------------------------

/** Make the bird come for the slug right now. */
function callBird(g: Game): void {
  (g as unknown as { birdTimer: number }).birdTimer = 0;
}

/** Hold on in the bird's grip for `secs`, pressing space `rate` times a second. */
function struggle(g: Game, secs: number, rate: number): GameEvent[] {
  const events: GameEvent[] = [];
  let next = 0;
  for (let t = 0; t < secs; t += STEP) {
    if (rate > 0 && t >= next) {
      g.mash(events);
      next += 1 / rate;
    }
    events.push(...g.update(STEP, null));
  }
  return events;
}

test('a bird swoops every 15 s to 1 min', () => {
  const g = emptyRoad({});
  (g as unknown as { birdTimer: number }).birdTimer = 20;
  const dives: number[] = [];
  for (let t = 0; t < 400; t += STEP) {
    for (const e of g.update(STEP, null)) {
      if (e.type === 'birdDive') dives.push(t);
      if (e.type === 'birdGrab') struggle(g, MASH_TIME + BIRD_CARRY + 0.1, 8); // escape every time
    }
  }
  assert.ok(dives.length >= 5, `${dives.length} dives`);
  for (let i = 1; i < dives.length; i++) {
    const gap = dives[i] - dives[i - 1];
    assert.ok(gap >= BIRD_EVERY[0] && gap <= BIRD_EVERY[1] + MASH_TIME + BIRD_CARRY + 3, `gap ${gap.toFixed(1)}`);
  }
});

test('mash fast enough and the bird drops you at the next checkpoint', () => {
  const g = emptyRoad();
  g.slug.y = 2;
  callBird(g);
  const dive = run(g, BIRD_DIVE + 0.05);
  assert.ok(dive.some((e) => e.type === 'birdGrab'));
  assert.equal(g.state, 'grabbed');
  // Traffic can't touch a slug in the bird's talons.
  g.vehicles.push(car(2, -4, 20));
  const events = struggle(g, MASH_TIME, 6);
  assert.ok(events.some((e) => e.type === 'birdDrop'));
  assert.ok(!events.some((e) => e.type === 'squish' || e.type === 'eaten'));
  run(g, BIRD_CARRY + 0.1);
  assert.equal(g.state, 'playing');
  assert.equal(g.slug.y, 5, 'dropped on the median');
  assert.equal(g.checkpoint, 5, 'and that counts as reaching it');
});

test('past the median, the next checkpoint is the lettuce', () => {
  const g = emptyRoad();
  g.checkpoint = 5;
  g.slug.x = 2.6;
  g.slug.y = 7;
  callBird(g);
  run(g, BIRD_DIVE + 0.05);
  struggle(g, 2.5, 7);
  const events = run(g, BIRD_CARRY + 0.1);
  assert.ok(events.some((e) => e.type === 'munch' && e.slot === 3), 'dropped into the nearest free patch');
  assert.equal(g.state, 'munching');
});

test('too slow and the bird eats you: back to the very start', () => {
  const g = emptyRoad();
  g.checkpoint = 5;
  g.slug.y = 6.5;
  callBird(g);
  run(g, BIRD_DIVE + 0.05);
  const events = struggle(g, MASH_TIME + 0.05, 3); // 3 a second isn't enough
  assert.ok(events.some((e) => e.type === 'eaten'));
  assert.equal(g.deathCause, 'eaten');
  run(g, DEATH_TIME);
  assert.equal(g.state, 'playing');
  assert.equal(g.slug.y, 0, 'not the median: the beginning');
  assert.equal(g.checkpoint, 0);
});

test('spacebar does nothing when no bird has you', () => {
  const g = emptyRoad();
  assert.deepEqual(g.mash(), []);
});

// ---- the skip button ------------------------------------------------------------

test('skip on the road: start → median → lettuce, then through the munch', () => {
  const g = emptyRoad();
  g.slug.x = 2.4;
  g.slug.y = 1.3;
  const first = g.skip();
  assert.ok(first.some((e) => e.type === 'checkpoint'));
  assert.equal(g.slug.y, 5);
  assert.equal(g.checkpoint, 5);
  const second = g.skip();
  assert.ok(second.some((e) => e.type === 'munch' && e.slot === 3), 'into the nearest free patch');
  assert.equal(g.state, 'munching');
  g.skip(); // and skip the munch itself
  run(g, STEP);
  assert.equal(g.state, 'playing');
  assert.ok(g.slug.y < 0.1, 'the next slug, back at the start');
});

// ---- the portal from hell ---------------------------------------------------------

test('after the trophy, a portal opens: the snail becomes a worm and goes underground', async () => {
  const { PORTAL_AT } = await import('../src/garden.ts');
  const g = emptyRoad();
  g.filled = [true, true, true, true, false];
  g.slug.x = SLOTS[4];
  g.slug.y = GOAL_ROW - 0.6;
  run(g, 0.2 + MUNCH_TIME + ASCEND_TIME + 0.1, 'up');
  assert.equal(g.state, 'garden');
  const garden = g.garden!;
  for (const v of garden.veg.slice(1)) v.eaten = 1;
  const last = garden.veg[0];
  Object.assign(g.slug, { x: last.x, y: last.y - last.r - 0.2 });
  Object.assign(garden.gardener, { x: -7, y: garden.gardener.y, gaze: Math.PI, heading: Math.PI, state: 'pause', t: -1e9 });
  const events = run(g, 0.3, 'up'); // onto the last vegetable…
  events.push(...run(g, 2 + PORTAL_AT)); // …and stay there to eat it
  assert.ok(events.some((e) => e.type === 'portal'));
  assert.equal(g.state, 'portal');
  assert.ok(g.underground);
  const morph = run(g, PORTAL_MORPH + 0.05);
  assert.ok(morph.some((e) => e.type === 'wormMorph'));
  assert.ok(g.isWorm && !g.isSnail);
  const under = run(g, PORTAL_TIME);
  assert.ok(under.some((e) => e.type === 'underground'));
  assert.equal(g.state, 'underground');
  const score = g.score;
  run(g, 1, 'down');
  assert.ok(g.score > score, 'points for digging');
});

test('skip works in every mode: road → lettuce → ascension → garden → finale → underground', () => {
  const g = emptyRoad();
  g.filled = [true, true, true, true, false];
  g.skip(); // start → median
  assert.equal(g.slug.y, 5);
  g.skip(); // median → the last lettuce
  assert.equal(g.state, 'munching');
  g.skip(); // finish the munch…
  run(g, STEP);
  assert.equal(g.state, 'ascending', '…and up goes the shell');
  const before = g.score;
  const toGarden = g.skip();
  assert.equal(g.state, 'garden');
  assert.ok(toGarden.some((e) => e.type === 'shellLands') && g.score === before + SNAIL_BONUS, 'still a snail, with its bonus');
  assert.ok(Math.abs(g.slug.y - GARDEN_START.y) < 1e-9);
  const cleared = g.skip();
  assert.ok(cleared.some((e) => e.type === 'gardenCleared'));
  assert.equal(g.garden!.phase, 'won');
  assert.ok(g.garden!.veg.every((v) => v.eaten === 1));
  assert.ok(g.canSkip, 'the finale can be skipped too');
  const down = g.skip();
  assert.ok(down.some((e) => e.type === 'underground'));
  assert.equal(g.state, 'underground');
  assert.ok(g.underground);
  const banana = g.skip(); // worm: straight to the banana…
  assert.ok(banana.some((e) => e.type === 'bananaFound'));
  const up = g.skip(); // …then straight up to the tree
  assert.ok(up.some((e) => e.type === 'treeStart'));
  assert.equal(g.state, 'tree');
  const cocoon = g.skip(); // caterpillar: straight to the sparkles…
  assert.ok(cocoon.some((e) => e.type === 'cocoon'));
  const fly = g.skip(); // …and then straight out of the cocoon…
  assert.ok(fly.some((e) => e.type === 'emerge'));
  const gust = g.skip(); // …into the gust of wind…
  assert.ok(gust.some((e) => e.type === 'gust'));
  const city = g.skip(); // …and away to the city
  assert.ok(city.some((e) => e.type === 'cityStart'));
  assert.equal(g.state, 'city');
  const park = g.skip(); // city: straight off to the park…
  assert.ok(park.some((e) => e.type === 'cityWin'));
  const land = g.skip(); // …and straight into the trophy
  assert.ok(land.some((e) => e.type === 'landTrophy'));
  assert.equal(g.hasNextCheckpoint, false, 'nothing after landing in the trophy');
  assert.deepEqual(g.skip(), []);
});

test('the worm surfacing starts the tree', () => {
  const g = emptyRoad();
  g.state = 'underground';
  g.underground = new Underground(1);
  g.underground.skipToBanana([]);
  const events = run(g, 12);
  assert.ok(events.some((e) => e.type === 'surfaced'));
  assert.ok(events.some((e) => e.type === 'treeStart'));
  assert.equal(g.state, 'tree');
  assert.ok(g.tree);
});

test('no skipping while the gardener has hold of you', () => {
  const g = emptyRoad();
  g.state = 'garden';
  g.garden = new Garden(1);
  g.garden.phase = 'caught';
  assert.equal(g.canSkip, false);
  assert.deepEqual(g.skip(), []);
  g.garden.phase = 'free';
  assert.equal(g.canSkip, true);
});
