import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRAWL_SPEED, DIG_SPEED, MOLE_COUNT, MOLE_EAT, MOLE_ROAM, MOLE_SLEEP, MOLE_WAKE, SEGMENTS, UG_H, Underground, WORM_START,
  type Mole, type UndergroundEvent, MOLE_GIVE_UP, MOLE_SIGHT, BANANA_EAT, BANANA_REACH, BIG_WORM, SURFACE_DANGER, UG_BIRD_DIVE, WORM_GROW,
} from '../src/underground.ts';
import type { Dir } from '../src/sim.ts';

const STEP = 1 / 120;
function run(u: Underground, secs: number, input: Dir | null): UndergroundEvent[] {
  const events: UndergroundEvent[] = [];
  for (let t = 0; t < secs; t += STEP) u.update(STEP, input, events);
  return events;
}

/** A sleeping mole that won't wake by itself (unless a test says so). */
function mole(x: number, y: number, wakeIn = Infinity): Mole {
  return { x, y, r: 0.55, state: 'asleep', t: 0, wakeIn, dir: 0, roamLeft: 0 };
}

/** An underground with no stones or moles, so nothing gets in the way. */
function clear(): Underground {
  const u = new Underground(1);
  u.cells = u.cells.map((c) => (c === 2 ? 0 : c));
  u.stones = [];
  u.moles = [];
  u.banana = { x: -99, y: -99 }; // out of the way unless a test puts it somewhere
  return u;
}

test('the worm starts in a little pocket just under the surface, everything else solid dirt', () => {
  const u = new Underground(1);
  assert.ok(u.isOpen(WORM_START.x, WORM_START.y));
  assert.ok(!u.isOpen(WORM_START.x, WORM_START.y - 3));
  assert.ok(u.stones.length >= 15);
});

test('digging leaves a tunnel behind it', () => {
  const u = clear();
  const events = run(u, 2, 'down');
  assert.ok(events.some((e) => e.type === 'dig'));
  const y = u.head.y;
  assert.ok(y < WORM_START.y - 2, 'dug down');
  for (let d = 0.5; d < WORM_START.y - y - 0.3; d += 0.25) assert.ok(u.isOpen(WORM_START.x, WORM_START.y - d), `open ${d} down`);
  assert.ok(u.dugCells > 0);
});

test('digging through dirt is slower than crawling back through the tunnel', () => {
  const u = clear();
  run(u, 0.6, 'down'); // get going
  const y0 = u.head.y;
  run(u, 1, 'down');
  const dug = y0 - u.head.y;
  assert.ok(Math.abs(dug - DIG_SPEED) < 0.15, `dug ${dug.toFixed(2)} in 1 s`);
  run(u, 0.5, 'up'); // turn around
  const y1 = u.head.y;
  run(u, 0.3, 'up');
  const crawled = u.head.y - y1;
  assert.ok(Math.abs(crawled - CRAWL_SPEED * 0.3) < 0.15, `crawled ${crawled.toFixed(2)} in 0.3 s`);
});

test('stones can\'t be dug through', () => {
  const u = clear();
  u.stones = [{ x: WORM_START.x, y: WORM_START.y - 2.5, r: 0.8 }];
  const events = run(u, 4, 'down');
  assert.ok(events.some((e) => e.type === 'bonk'));
  assert.ok(u.head.y > WORM_START.y - 2.5 + 0.8, 'stopped on top of it');
});

test('the worm can\'t dig out of the top or bottom', () => {
  const u = clear();
  run(u, 3, 'up');
  assert.ok(u.head.y <= UG_H - 0.4);
  run(u, 30, 'down');
  assert.ok(u.head.y >= 0.3);
});

test('its body follows the path the head took', () => {
  const u = clear();
  run(u, 1.5, 'down');
  run(u, 1.5, 'right');
  const segs = u.segments();
  assert.equal(segs.length, SEGMENTS);
  assert.deepEqual(segs[0], u.head);
  const tail = segs[segs.length - 1];
  assert.ok(tail.x < u.head.x - 0.5 || tail.y > u.head.y + 0.5, 'tail trails behind');
  for (const s of segs) assert.ok(u.isOpen(s.x, s.y), 'every segment is inside the tunnel');
});

test('moles lie asleep in their own chambers, well away from where the worm lands', () => {
  const u = new Underground(4);
  assert.equal(u.moles.length, MOLE_COUNT);
  for (const m of u.moles) {
    assert.equal(m.state, 'asleep');
    assert.ok(u.isOpen(m.x, m.y) && u.isOpen(m.x + m.r + 0.2, m.y), 'in a hollow you can see');
    assert.ok(Math.hypot(m.x - WORM_START.x, m.y - WORM_START.y) > 6);
  }
  assert.equal(u.dugCells, new Underground(4).dugCells, 'the chambers don\'t count as the worm\'s digging');
});

test('bump a sleeping mole and it wakes, grabs the worm and eats it; the worm comes back at the start', () => {
  const u = clear();
  u.moles = [mole(WORM_START.x, WORM_START.y - 2.2)];
  const events: UndergroundEvent[] = [];
  for (let t = 0; t < 3 && !events.some((e) => e.type === 'moleWake'); t += STEP) u.update(STEP, 'down', events);
  assert.ok(events.some((e) => e.type === 'moleWake'));
  assert.equal(u.wormState, 'caught');
  assert.equal(u.moles[0].state, 'waking');
  // Struggling does no good.
  const y = u.head.y;
  const eat = run(u, MOLE_WAKE + MOLE_EAT + 0.05, 'up');
  assert.equal(u.head.y, y, 'held fast');
  assert.ok(eat.filter((e) => e.type === 'moleChomp').length >= 4, 'chomp chomp chomp');
  assert.ok(eat.some((e) => e.type === 'wormEaten'));
  assert.equal(u.wormState, 'eaten');
  const back = run(u, 1, null);
  assert.ok(back.some((e) => e.type === 'wormRespawn'));
  assert.equal(u.wormState, 'free');
  assert.deepEqual(u.head, WORM_START);
  assert.ok(u.isOpen(WORM_START.x, WORM_START.y - 1.5), 'its tunnel is still there');
  // A well-fed mole naps again, and an awake one just blocks the way.
  assert.equal(u.moles[0].state, 'full');
  run(u, 4, null);
  assert.equal(u.moles[0].state, 'asleep');
});

test('moles wake every 5–30 s, tunnel off somewhere, then settle down to sleep again', () => {
  const u = new Underground(9);
  for (const m of u.moles) assert.ok(m.wakeIn >= MOLE_SLEEP[0] && m.wakeIn <= MOLE_SLEEP[1]);
  const m = u.moles[0];
  const start = { x: m.x, y: m.y };
  m.wakeIn = 0.01;
  const events = run(u, 0.1, null);
  assert.ok(events.some((e) => e.type === 'moleRoam'));
  assert.equal(m.state, 'roaming');
  let settled = false, travelled = 0;
  for (let t = 0; t < MOLE_ROAM[1] + 0.2 && !settled; t += STEP) {
    const events: UndergroundEvent[] = [];
    const before = { x: m.x, y: m.y };
    u.update(STEP, null, events);
    travelled += Math.hypot(m.x - before.x, m.y - before.y);
    settled = events.some((e) => e.type === 'moleSettle');
  }
  assert.ok(settled);
  assert.equal(m.state, 'asleep');
  assert.ok(m.wakeIn >= MOLE_SLEEP[0] && m.wakeIn <= MOLE_SLEEP[1], 'a new nap');
  assert.ok(travelled > MOLE_ROAM[0] * 0.8, `it tunnelled a fair way (${travelled.toFixed(1)} units)`);
  assert.ok(u.isOpen(m.x, m.y), 'and dug a new chamber where it sleeps');
  assert.ok(start.x !== m.x || start.y !== m.y);
});

test('a tunnelling mole that runs into the worm eats it', () => {
  const u = clear();
  // Down in the middle of the dirt, clear of the surface (moles turn away from it).
  u.head = { x: 20, y: 12 };
  u.path = Array.from({ length: 48 }, (_, i) => ({ x: 20 - i * 0.05, y: 12 }));
  const m = mole(23, 12, 0);
  u.moles = [m];
  run(u, 0.05, null); // it wakes…
  Object.assign(m, { dir: Math.PI, roamLeft: 10 }); // …and heads straight for the worm
  const events = run(u, 3, null);
  assert.ok(events.some((e) => e.type === 'moleWake'));
  assert.ok(u.wormState === 'caught' || u.wormState === 'eaten');
});

// ---- the rotten banana, and the birds -------------------------------------------------

test('the rotten banana is buried deep, far from the start, hidden in solid dirt', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const u = new Underground(seed);
    const b = u.banana;
    assert.ok(Math.hypot(b.x - WORM_START.x, b.y - WORM_START.y) > 16, `seed ${seed}: far away`);
    assert.ok(b.y < UG_H * 0.6, `seed ${seed}: deep down`);
    assert.ok(!u.isOpen(b.x, b.y), `seed ${seed}: you have to dig to it`);
  }
});

test('digging up the banana: the worm eats it, grows to twice the size, then digs up to the surface', () => {
  const u = clear();
  u.banana = { x: WORM_START.x, y: WORM_START.y - 3 };
  const events: UndergroundEvent[] = [];
  for (let t = 0; t < 4 && !events.some((e) => e.type === 'bananaFound'); t += STEP) u.update(STEP, 'down', events);
  assert.ok(events.some((e) => e.type === 'bananaFound'));
  assert.equal(u.wormState, 'won');
  assert.ok(Math.hypot(u.head.x - u.banana.x, u.head.y - u.banana.y) < BANANA_REACH + 0.05);
  // Munch…
  const y = u.head.y;
  const eat = run(u, BANANA_EAT + 0.02, 'down');
  assert.equal(u.head.y, y, 'busy eating, not digging');
  assert.ok(eat.some((e) => e.type === 'wormGrow'));
  assert.equal(u.bananaLeft(), 0);
  // …grow…
  run(u, WORM_GROW, null);
  assert.ok(Math.abs(u.wormScale() - BIG_WORM) < 0.01);
  // …and up it goes, all by itself.
  const up = run(u, 3, null);
  assert.ok(up.some((e) => e.type === 'surfaced'));
  assert.equal(u.head.y, UG_H);
  assert.ok(u.isOpen(u.head.x, UG_H - 0.5), 'a big tunnel up to the surface');
});

test('skip, underground: straight to the banana', () => {
  const u = clear();
  u.banana = { x: 10, y: 4 };
  const events: UndergroundEvent[] = [];
  u.skipToBanana(events);
  assert.ok(events.some((e) => e.type === 'bananaFound'));
  assert.equal(u.wormState, 'won');
});

test('near the surface a bird swoops: stay up there and it snatches you back to the start', () => {
  const u = clear();
  u.head = { x: 20, y: UG_H - 0.6 };
  const events = run(u, 0.1, null);
  assert.ok(events.some((e) => e.type === 'birdDive'));
  const strike = run(u, UG_BIRD_DIVE, null);
  assert.ok(strike.some((e) => e.type === 'birdSnatch'));
  assert.equal(u.wormState, 'snatched');
  assert.ok(u.isOpen(20, UG_H - 0.2), 'its beak went through the dirt');
  const back = run(u, 3, null);
  assert.ok(back.some((e) => e.type === 'wormRespawn'));
  assert.deepEqual(u.head, WORM_START);
  assert.ok(!u.nearSurface(), 'the start is safely deep enough');
});

test('…but dive deeper before it strikes and it comes up empty', () => {
  const u = clear();
  u.head = { x: 20, y: UG_H - 0.6 };
  u.heading = -Math.PI / 2;
  run(u, 0.1, null);
  assert.ok(u.bird);
  const events = run(u, UG_BIRD_DIVE, 'down');
  assert.ok(events.some((e) => e.type === 'birdMiss'));
  assert.equal(u.wormState, 'free');
  assert.ok(u.head.y < UG_H - SURFACE_DANGER);
});

test('no birds while the worm stays deep', () => {
  const u = clear();
  const events = run(u, 5, 'down');
  assert.ok(!events.some((e) => e.type === 'birdDive'));
});

test('an awake mole that sees the worm ahead chases it — until the worm gets far enough away', () => {
  const u = clear();
  u.head = { x: 20, y: 12 };
  u.path = Array.from({ length: 48 }, (_, i) => ({ x: 20 + i * 0.05, y: 12 }));
  const m = mole(20 - MOLE_SIGHT + 1, 12, 0);
  u.moles = [m];
  run(u, 0.02, null); // wakes…
  Object.assign(m, { dir: 0, roamLeft: 10 }); // …facing the worm
  const spot = run(u, 0.1, null);
  assert.ok(spot.some((e) => e.type === 'moleChase'));
  assert.equal(m.state, 'chasing');
  // The worm flees along an open tunnel, faster than the mole can dig.
  for (let x = 20; x < 60; x += 0.25) for (const dy of [-0.25, 0, 0.25]) u.cells[Math.floor((12 + dy) / 0.25) * (64 / 0.25) + Math.floor(x / 0.25)] = 1;
  u.heading = 0;
  const flee = run(u, 12, 'right');
  assert.ok(flee.some((e) => e.type === 'moleGiveUp'), 'it gave up');
  assert.notEqual(m.state, 'chasing');
  assert.equal(u.wormState, 'free', 'and the worm got away');
  assert.ok(Math.hypot(u.head.x - m.x, u.head.y - m.y) > MOLE_GIVE_UP - 1);
});

test('…but a worm digging away through fresh dirt gets caught', () => {
  const u = clear();
  u.head = { x: 20, y: 12 };
  u.path = Array.from({ length: 48 }, (_, i) => ({ x: 20 - i * 0.05, y: 12 }));
  u.heading = 0;
  const m = mole(16, 12, 0);
  u.moles = [m];
  run(u, 0.02, null);
  Object.assign(m, { dir: 0, roamLeft: 10 });
  const events = run(u, 8, 'right');
  assert.ok(events.some((e) => e.type === 'moleChase'));
  assert.ok(events.some((e) => e.type === 'moleWake'), 'caught');
});
