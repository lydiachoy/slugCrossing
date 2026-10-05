// Guards the tuning: a slug with perfect timing (it looks ahead by simulating a copy
// of the game) must be able to reach the lettuce without ever getting hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, ROWS, SLOTS, rowKind, type Dir } from '../src/sim.ts';

const STEP = 1 / 120;
const K = 12; // sim steps per decision (0.1 s)

/** Would holding `first` for one decision, then crawling up to the next safe row, survive? */
function crossingSurvives(g: Game, first: Dir | null): boolean {
  const c = g.clone();
  for (let k = 0; k < K; k++) if (c.update(STEP, first), c.state !== 'playing') return false;
  const startY = c.slug.y;
  const target = ROWS.findIndex((kind, r) => kind !== 'road' && r > startY + 0.05);
  for (let t = 0; t < 12; t += STEP) {
    c.update(STEP, 'up');
    if (c.state === 'munching') return true; // made it to the lettuce
    if (c.state !== 'playing') return false;
    if (c.slug.y < startY - 0.1 || c.slug.y >= target - 0.05) return true;
  }
  return false;
}

function decide(g: Game): Dir | null {
  const s = g.slug;
  const free = SLOTS.filter((_, i) => !g.filled[i]).sort((a, b) => Math.abs(a - s.x) - Math.abs(b - s.x))[0];
  const settledOnGrass = rowKind(s.y) === 'grass' && Math.abs(s.y - Math.round(s.y)) < 0.05;
  if (settledOnGrass && Math.abs(s.x - free) > 0.15) return s.x < free ? 'right' : 'left';
  if (rowKind(s.y + 0.5) === 'goal') return 'up';
  if (crossingSurvives(g, 'up')) return 'up';
  return settledOnGrass ? null : 'down';
}

test('a slug with perfect timing reaches the lettuce unharmed', () => {
  const g = new Game(7);
  g.start();
  let munches = 0, deaths = 0;
  (g as unknown as { npcTimer: number }).npcTimer = Infinity; // rivals could pinch the lettuce
  (g as unknown as { birdTimer: number }).birdTimer = Infinity; // the bot can't mash space
  for (let t = 0; t < 70 && g.state !== 'gameOver'; t += 0.1) {
    const act = g.state === 'playing' ? decide(g) : null;
    for (let k = 0; k < K; k++) {
      for (const e of g.update(STEP, act)) {
        if (e.type === 'munch') munches++;
        if (e.type === 'squish' || e.type === 'dried') deaths++;
      }
    }
  }
  assert.equal(deaths, 0);
  assert.ok(munches >= 1, `only ${munches} lettuces in 70 s`);
});
