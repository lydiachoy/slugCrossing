import { Sfx } from './audio.ts';
import { Music } from './music.ts';
import { Game, HALF_W, LIVES, MASH_TIME, MUNCH_TIME, type Dir, type GameEvent } from './sim.ts';
import { View } from './view.ts';

const STEP = 1 / 120; // fixed sim step: traffic is fast, so keep it small

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel')!;
const panelText = document.getElementById('panel-text')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const $ = (id: string) => document.getElementById(id)!;

const params = new URLSearchParams(location.search);
// Infinite lives, unless ?lives asks for the classic 10.
const game = new Game(Number(params.get('seed') ?? Date.now() % 1e9), { infiniteLives: !params.has('lives') });
const view = new View(canvas);
// ?debug exposes the game in the console, for poking at it (and screenshot scripts).
if (params.has('debug')) Object.assign(window, { game });
const sfx = new Sfx();
const music = new Music();
addEventListener('resize', () => view.resize());
view.resize();

// ---- input: the most recently pressed direction that's still held wins --------

const held: Dir[] = [];
const press = (d: Dir) => {
  if (!held.includes(d)) held.push(d);
};
const release = (d: Dir) => {
  const i = held.indexOf(d);
  if (i >= 0) held.splice(i, 1);
};
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

/** One press in the struggle against the bird. */
const mash = () => {
  for (const ev of game.mash()) handleEvent(ev);
};
// On touch screens, any tap counts as a press.
canvas.addEventListener('pointerdown', () => game.state === 'grabbed' && mash());
$('mash').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  mash();
});

$('skip').addEventListener('click', () => {
  sfx.unlock();
  for (const ev of game.skip()) handleEvent(ev);
  ($('skip') as HTMLButtonElement).blur(); // so Space doesn't press it again
});

const start = () => {
  sfx.unlock();
  music.start();
  if (game.state === 'ready' || game.state === 'gameOver') {
    game.start();
    music.setLevel(game.level);
    music.setSlow(false);
    panel.hidden = true;
  }
};
startBtn.addEventListener('click', start);

addEventListener('keydown', (e) => {
  sfx.unlock();
  const d = KEYS[e.code];
  if (d) {
    e.preventDefault();
    press(d);
  } else if (e.code === 'Space' && game.state === 'grabbed') {
    e.preventDefault();
    if (!e.repeat) mash();
  } else if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    start();
  } else if (e.code === 'KeyM') music.toggle();
  else if (e.code === 'KeyN') sfx.enabled = !sfx.enabled;
});
addEventListener('keyup', (e) => {
  const d = KEYS[e.code];
  if (d) release(d);
});
addEventListener('blur', () => (held.length = 0));

for (const btn of document.querySelectorAll<HTMLButtonElement>('#pad button')) {
  const d = btn.dataset.dir as Dir;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.unlock();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('on');
    if (game.state === 'grabbed') mash();
    press(d);
  });
  const up = () => {
    btn.classList.remove('on');
    release(d);
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
}

// ---- loop ----------------------------------------------------------------------

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    acc -= STEP;
    for (const e of game.update(STEP, held.at(-1) ?? null)) handleEvent(e);
  }
  view.render(game, dt);
  hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Sounds, music and one-off visuals for whatever just happened in the game. */
function handleEvent(e: GameEvent): void {
  view.handle(e, game);
  switch (e.type) {
    case 'whoosh': sfx.whoosh(e.closeness, (e.x / HALF_W) * 0.7); break;
    case 'squish':
      sfx.squish();
      sfx.soul();
      break;
    case 'npcSquish':
      sfx.squish();
      sfx.soul();
      break;
    case 'npcMunch': sfx.munch(MUNCH_TIME, false); break;
    case 'lane': sfx.ding(); break;
    case 'pickup':
      if (e.kind === 'slow') {
        sfx.slowDown();
        music.setSlow(true);
      } else sfx.oneUp();
      break;
    case 'slowmoEnd':
      sfx.speedUp();
      music.setSlow(false);
      break;
    case 'npcBounce': sfx.boing(); break;
    case 'dumptruck': sfx.horn(); break;
    case 'salted':
    case 'npcSalted':
      sfx.salted();
      break;
    case 'dried': sfx.dried(); break;
    case 'munch': sfx.munch(MUNCH_TIME); break;
    case 'levelUp':
      sfx.levelUp();
      music.setLevel(e.level);
      break;
    case 'light': sfx.signal(e.red); break;
    case 'checkpoint': sfx.checkpoint(); break;
    case 'birdDive': sfx.screech(); break;
    case 'birdGrab': sfx.grabbed(); break;
    case 'mash': sfx.squeak(e.mash); break;
    case 'birdDrop': sfx.wheee(); break;
    case 'eaten': sfx.gulp(); break;
    case 'skip': sfx.wheee(); break;
    case 'ascend':
      sfx.choir();
      music.duck(true);
      break;
    case 'shellLands': sfx.bell(); break;
    case 'gardenStart':
      music.duck(false);
      toast('You\'re a <b>snail</b> now! Eat the garden — but hide from the gardener behind the rocks.');
      break;
    case 'vegBite': sfx.crunch(); break;
    case 'vegEaten': sfx.gobble(); break;
    case 'spotted':
      sfx.alarm();
      music.setChase(true);
      break;
    case 'caught': sfx.grabbed(); break;
    case 'thrown': sfx.yeet(); break;
    case 'gardenRespawn':
      sfx.pop();
      music.setChase(false);
      break;
    case 'gameOver':
      sfx.gameOver();
      panelText.innerHTML = `The slug's journey is over.<br />Final score: <b>${e.score}</b>`;
      startBtn.textContent = 'Crawl again';
      panel.hidden = false;
      break;
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A message across the middle of the screen for a few seconds. */
function toast(html: string): void {
  const t = $('toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

function hud(): void {
  $('score').textContent = String(game.score);
  $('level').textContent = String(game.level);
  $('lives').textContent = game.infiniteLives ? '∞' : `${Math.max(0, game.lives)} / ${LIVES}`;
  // The skip button: only on the road, and only while you're free to move.
  const skip = $('skip') as HTMLButtonElement;
  skip.hidden = !!game.garden || game.state === 'ready' || game.state === 'gameOver';
  skip.disabled = !game.canSkip;
  // In the garden: no drying out, but a vegetable tally.
  const inGarden = !!game.garden;
  $('moist-stat').hidden = inGarden;
  $('veg-stat').hidden = !inGarden;
  if (game.garden) $('veg').textContent = String(game.garden.eatenCount);
  const m = game.slug.moisture;
  const bar = $('moisture');
  bar.style.width = `${m}%`;
  bar.classList.toggle('low', m < 30);
  // Slow-mo: a blue tint and a countdown.
  document.body.classList.toggle('slowmo', game.slowmo > 0);
  $('slowmo').textContent = game.slowmo > 0 ? `SLOW-MO ${game.slowmo.toFixed(1)}` : '';
  // The bird's got you: the mash meter.
  const b = game.bird;
  const struggling = game.state === 'grabbed' && b?.phase === 'carrying';
  $('mash').hidden = !struggling;
  if (struggling) {
    $('mash-fill').style.width = `${b.mash * 100}%`;
    $('mash-time').style.width = `${Math.max(0, 1 - b.t / MASH_TIME) * 100}%`;
  }
}
