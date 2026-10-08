import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_STAGES, DAY_CYCLE, EMERGE_AT, FLY_AT, GATE_Y, LEAVES_NEEDED, MAX_SIZE, MORPH_TIME, REGROW_TIME, SHADOW_TIME, SPARKLES,
  SWOOP_TIME, TREE_BIRD_EVERY, TREE_H, TRUNK_HALF, Tree, GUST_TIME, FLY_TIME, WRAP_TIME, type TreeEvent,
} from '../src/tree.ts';
import type { Dir } from '../src/sim.ts';

const STEP = 1 / 120;
function run(t: Tree, secs: number, input: Dir | null): TreeEvent[] {
  const events: TreeEvent[] = [];
  for (let s = 0; s < secs; s += STEP) t.update(STEP, input, events);
  return events;
}

test('a tall tree, branching all the way up, hung with leaves and flowers', () => {
  const t = new Tree(1);
  assert.ok(t.branches.length >= 15, `${t.branches.length} branches`);
  assert.ok(t.branches.some((b) => b.x1 <= -TRUNK_HALF + 0.5) && t.branches.some((b) => b.x0 >= TRUNK_HALF - 0.5), 'both sides');
  assert.ok(Math.max(...t.branches.map((b) => b.y1)) > TREE_H * 0.85, 'right up near the top');
  assert.ok(t.food.filter((f) => f.kind === 'leaf').length > 80);
  assert.ok(t.food.some((f) => f.kind === 'flower'));
});

test('first the worm turns into a caterpillar; then it can climb', () => {
  const t = new Tree(1);
  const early = run(t, MORPH_TIME - 0.1, 'up');
  assert.equal(t.head.y, 0.4, 'not yet');
  assert.ok(!early.some((e) => e.type === 'caterpillar'));
  assert.ok(run(t, 0.2, null).some((e) => e.type === 'caterpillar'));
  run(t, 2, 'up');
  assert.ok(t.head.y > 3, 'climbing the trunk');
});

test('it can only crawl on bark: off the end of a branch is thin air', () => {
  const t = new Tree(1);
  run(t, MORPH_TIME, null);
  run(t, 3, 'right');
  assert.ok(t.head.x <= TRUNK_HALF + 0.06, 'stopped at the edge of the trunk (no branch at the bottom)');
  const b = t.branches.find((q) => q.x0 >= TRUNK_HALF - 0.5)!;
  t.head = { x: TRUNK_HALF - 0.5, y: (b.y0 + b.y1) / 2 };
  t.heading = 0;
  run(t, 10, 'right');
  assert.ok(Math.abs(t.head.x - b.x1) < 0.1, 'to the tip of the branch, no further');
});

test('eating leaves and flowers makes it bigger and more colourful', () => {
  const t = new Tree(1);
  run(t, MORPH_TIME, null);
  assert.equal(t.size(), 1);
  assert.equal(t.colorStage(), 0);
  const events: TreeEvent[] = [];
  let points = 0;
  for (const f of t.food.slice(0, 40)) {
    t.head = { x: f.x, y: f.y - Math.sign(Math.sin(f.angle)) * 0.3 };
    points += (t as unknown as { munch(e: TreeEvent[]): number }).munch(events);
  }
  assert.ok(points > 0);
  assert.ok(events.filter((e) => e.type === 'leafEaten').length >= 30);
  assert.ok(t.size() > 1.8, `size ${t.size().toFixed(2)}`);
  assert.ok(t.size() <= MAX_SIZE);
  assert.ok(t.colorStage() >= 3, `colour stage ${t.colorStage()}`);
  assert.ok(events.some((e) => e.type === 'colorUp'));
  assert.ok(t.eaten >= COLOR_STAGES[3]);
});

test('too small to climb to the top until it has eaten 100 leaves', () => {
  const t = new Tree(1);
  run(t, MORPH_TIME, null);
  t.head = { x: 0, y: GATE_Y - 1 };
  const events = run(t, 3, 'up');
  assert.ok(t.head.y <= GATE_Y + 0.01, 'stuck below the gate');
  assert.ok(events.some((e) => e.type === 'tooSmall'));
  t.eaten = LEAVES_NEEDED;
  run(t, 3, 'up');
  assert.ok(t.head.y > GATE_Y + 1, 'big enough now');
});

test('eaten leaves grow back after 30 s', () => {
  const t = new Tree(1);
  run(t, MORPH_TIME, null);
  const f = t.food[0];
  t.head = { x: f.x, y: f.y - Math.sign(Math.sin(f.angle)) * 0.3 };
  (t as unknown as { munch(e: TreeEvent[]): number }).munch([]);
  assert.ok(f.eaten);
  t.head = { x: 0, y: 2 }; // well away
  run(t, REGROW_TIME - 1, null);
  assert.ok(f.eaten, 'not yet');
  const events = run(t, 1.1, null);
  assert.ok(!f.eaten);
  assert.ok(events.some((e) => e.type === 'leafRegrow'));
});

test('the sparkles: a cocoon, three days and nights, and a butterfly at the fourth sunrise', () => {
  const t = new Tree(1);
  run(t, MORPH_TIME, null);
  t.eaten = LEAVES_NEEDED;
  t.head = { x: SPARKLES.x - 1.5, y: SPARKLES.y };
  t.heading = 0;
  const reach = run(t, 1.5, 'right');
  assert.ok(reach.some((e) => e.type === 'cocoon'));
  assert.ok(t.won && !t.emerged);
  const story = run(t, EMERGE_AT + 0.05, null);
  const order = story.map((e) => e.type).filter((x) => x === 'sunset' || x === 'sunrise' || x === 'emerge');
  assert.deepEqual(order, ['sunset', 'sunrise', 'sunset', 'sunrise', 'sunset', 'sunrise', 'sunset', 'sunrise', 'emerge']);
  assert.ok(t.emerged);
  assert.equal(t.nights(), 4, 'the cocoon grew through four nights');
  assert.ok(EMERGE_AT - WRAP_TIME > 3 * DAY_CYCLE);
  // Wings dry, and away it flutters.
  const x = t.fly.x;
  run(t, FLY_AT - EMERGE_AT + 1, 'left');
  assert.ok(t.fly.x < x - 2, 'flying');
  // About a minute of that… then a gust of wind blows it away.
  const flying = t.gustAt - FLY_AT;
  assert.ok(flying >= FLY_TIME[0] && flying <= FLY_TIME[1], `blown away after ${flying.toFixed(1)} s of flying`);
  const gust = run(t, t.gustAt - t.wonT + 0.1, null);
  assert.ok(gust.some((e) => e.type === 'gust'));
  const fx = t.fly.x;
  const gone = run(t, GUST_TIME, 'left');
  assert.ok(t.fly.x > fx + 10, 'swept away, whatever you press');
  assert.ok(gone.some((e) => e.type === 'blownAway'));
});

// ---- the bird's shadow -----------------------------------------------------------

/** Make the bird come over right now. */
function callBird(t: Tree): void {
  (t as unknown as { birdTimer: number }).birdTimer = 0;
}

test('a bird passes over every 20 s to 1 min', () => {
  const t = new Tree(3);
  run(t, MORPH_TIME, null);
  const times: number[] = [];
  let clock = 0;
  for (; clock < 400; clock += STEP) {
    const events: TreeEvent[] = [];
    t.update(STEP, clock % 6 < 3 ? 'up' : 'down', events); // keep moving so it always escapes
    if (events.some((e) => e.type === 'shadow')) times.push(clock);
  }
  assert.ok(times.length >= 6, `${times.length} birds`);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= TREE_BIRD_EVERY[0] && gap <= TREE_BIRD_EVERY[1] + SHADOW_TIME + SWOOP_TIME + 0.1, `gap ${gap.toFixed(1)}`);
  }
});

test('stay in the shadow and the bird eats you: back on a nearby branch', () => {
  const t = new Tree(3);
  run(t, MORPH_TIME, null);
  t.head = { x: 0, y: 30 };
  callBird(t);
  const events = run(t, 0.05, null);
  assert.ok(events.some((e) => e.type === 'shadow'));
  assert.ok(t.inShadow());
  const strike = run(t, SHADOW_TIME, null);
  assert.ok(strike.some((e) => e.type === 'swoop' && e.caught));
  assert.ok(t.snatched);
  const back = run(t, SWOOP_TIME + 0.1, 'up');
  assert.ok(back.some((e) => e.type === 'treeRespawn'));
  assert.ok(!t.snatched);
  assert.ok(t.onBark(t.head.x, t.head.y), 'on the tree');
  assert.ok(Math.abs(t.head.x) > TRUNK_HALF, 'out on a branch');
  assert.ok(Math.abs(t.head.y - 30) < 6, 'a nearby one');
});

test('crawl out of the shadow in time and it swoops past — even when fully grown', () => {
  const t = new Tree(3);
  run(t, MORPH_TIME, null);
  t.eaten = 999; // as big as it gets: the biggest shadow
  t.head = { x: 0, y: 30 };
  callBird(t);
  run(t, 0.05, null);
  const events = run(t, SHADOW_TIME, 'up');
  assert.ok(events.some((e) => e.type === 'swoop' && !e.caught));
  assert.ok(!t.snatched);
});
