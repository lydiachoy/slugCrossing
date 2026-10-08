import { Sfx } from './audio.ts';
import { Music } from './music.ts';
import { Game, HALF_W, LIVES, MASH_TIME, MUNCH_TIME, type Dir, type GameEvent } from './sim.ts';
import { CAR_POINTS, PERSON_POINTS, POINTS_TO_WIN } from './city.ts';
import { LEAVES_NEEDED as TREE_LEAVES } from './tree.ts';
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
view.cityView.onBang = () => sfx.firework();

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
  // After the final victory, "Play again" means a whole new game.
  if (game.city?.phase === 'landed') {
    location.reload();
    return;
  }
  // After the final victory, "Play again" means a whole new game.

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
  } else if (e.code === 'Space' && game.state === 'city') {
    e.preventDefault();
    if (!e.repeat) for (const ev of game.poop()) handleEvent(ev);
  } else if (e.code === 'Space' && game.state === 'grabbed') {
    e.preventDefault();
    if (!e.repeat) mash();
  } else if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    start();
  } else if (e.code === 'KeyM') music.toggle();
  else if (e.code === 'KeyN') sfx.enabled = !sfx.enabled;
  else if (e.code === 'Tab') {
    // Tab: jump to the next checkpoint (same as the Skip button). (And don't move keyboard focus.)
    e.preventDefault();
    if (!e.repeat) for (const ev of game.skip()) handleEvent(ev);
  }
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
  snoring(dt);
  cityNoise(dt);
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
    case 'gardenCleared':
      $('toast').hidden = true;
      sfx.scratch();
      music.duck(true);
      sfx.tantrum();
      break;
    case 'trophy':
      sfx.fanfare();
      music.duck(false);
      break;
    case 'portal':
      sfx.hellfire();
      music.duck(true);
      break;
    case 'wormMorph': sfx.squelch(); break;
    case 'underground':
      // Down here the band plays on, slow and muffled, like it's coming through the dirt.
      music.setSlow(true);
      music.setChase(false);
      music.duck(false);
      toast('You\'re an <b>earthworm</b> now. Find the <b>rotten banana</b> buried somewhere deep — follow the stink! '
        + 'Don\'t wake the <b>moles</b>, and keep away from the surface: <b>birds</b> are watching.');
      break;
    case 'dig': sfx.dig(); break;
    case 'moleWake': sfx.snort(); break;
    case 'moleRoam': sfx.yawn(moleNearness()); break;
    case 'moleSettle': sfx.sigh(moleNearness()); break;
    case 'moleChase':
      sfx.snort();
      toast('A <b>mole</b> is after you — run! (crawl back down your tunnels, it can\'t keep up there)');
      break;
    case 'moleGiveUp': sfx.sigh(0.6); break;
    case 'moleChomp': sfx.crunch(); break;
    case 'wormEaten': sfx.gulp(); break;
    case 'wormRespawn': sfx.pop(); break;
    case 'birdDive': sfx.screech(); break;
    case 'birdSnatch':
      sfx.grabbed();
      sfx.gulp();
      break;
    case 'birdMiss': sfx.whoosh(0.8, 0); break;
    case 'bananaFound':
      sfx.fanfare();
      toast('🍌 You found the <b>rotten banana</b>!');
      break;
    case 'wormGrow': sfx.grow(); break;
    case 'surfaced': sfx.pop(); break;
    case 'treeStart':
      music.setSlow(false); // out in the fresh air, the band's back up to speed
      toast('Up into the daylight, at the foot of an enormous tree…');
      break;
    case 'caterpillar':
      sfx.squelch();
      sfx.bell();
      toast(`You're a <b>caterpillar</b>! Munch ${TREE_LEAVES} leaves to grow big enough to reach the <b>sparkling branch</b> at the top. Watch out for birds!`);
      break;
    case 'leafEaten':
      if (e.kind === 'flower') sfx.gobble();
      else sfx.crunch();
      break;
    case 'colorUp':
      sfx.grow();
      toast(['', 'Ooh — <b>yellow bands</b>!', '<b>Stripes</b>! Very fetching.', '<b>Orange spots</b>!', '<b>Blues and violets</b>!', 'A <b>RAINBOW</b> caterpillar!'][e.stage]);
      break;
    case 'shadow':
      sfx.screech();
      toast('A <b>shadow</b> falls across the tree… get out of it, quick!');
      break;
    case 'swoop':
      sfx.whoosh(1, 0);
      if (e.caught) {
        sfx.grabbed();
        sfx.gulp();
      }
      break;
    case 'treeRespawn': sfx.pop(); break;
    case 'tooSmall':
      toast(`Too little to climb any higher — eat more leaves! (<b>${e.eaten}</b>/${TREE_LEAVES})`);
      break;
    case 'cocoon':
      sfx.choir();
      music.duck(true);
      toast('The sparkles! Time to rest… and <b>change</b>.');
      break;
    case 'sunset': sfx.dusk(); break;
    case 'sunrise': sfx.dawn(); break;
    case 'emerge':
      sfx.bell();
      sfx.fanfare();
      music.duck(false);
      toast('Out pops… a <b>pigeon</b>?! Well, fly free (arrow keys) while the breeze is gentle…');
      break;
    case 'gust':
      sfx.gale();
      toast('Whoa — a <b>gust of wind</b>!');
      break;
    case 'cityStart':
      toast(`…blown far, far away, into a <b>big city</b>. Press <kbd>Space</kbd> to poop! Cars <b>+${CAR_POINTS}</b>, people <b>${PERSON_POINTS}</b>. Get <b>${POINTS_TO_WIN}</b> to win.`);
      break;
    case 'bump': sfx.bonk(); break;
    case 'poop': sfx.plop(); break;
    case 'tired':
      sfx.dusk();
      toast('Out of <b>energy</b>! You\'ll have to walk. Eat <b>junk food</b> off the sidewalk to fly again — and watch out for cars!');
      break;
    case 'eatFood':
      sfx.gobble();
      sfx.crunch();
      break;
    case 'takeOff':
      sfx.wheee();
      toast('Full of beans — <b>flying</b> again!');
      break;
    case 'squashed':
      sfx.squish();
      view.cityView.popLabel(game.city!.pos.x, game.city!.pos.y, e.points);
      break;
    case 'unsquash': sfx.pop(); break;
    case 'splat': sfx.splat(false); break;
    case 'hitCar':
      sfx.splat(true);
      sfx.ding();
      view.cityView.popLabel(e.x, e.y, e.points);
      break;
    case 'hitPerson':
      sfx.splat(true);
      sfx.eww();
      view.cityView.popLabel(e.x, e.y, e.points);
      break;
    case 'cityWin':
      sfx.fanfare();
      toast('<b>Good Job!</b>');
      break;
    case 'landTrophy':
      sfx.bell();
      sfx.fanfare();
      toast('🏆 Perched in the giant trophy! 🎆');
      break;
    case 'victory':
      panelText.innerHTML = `🏆 <b>You won!</b><br />Slug, snail, worm, caterpillar, pigeon — and champion.<br />Final score: <b>${game.score}</b>`;
      startBtn.textContent = 'Play again';
      panel.hidden = false;
      break;
    case 'gameOver':
      sfx.gameOver();
      panelText.innerHTML = `The slug's journey is over.<br />Final score: <b>${e.score}</b>`;
      startBtn.textContent = 'Crawl again';
      panel.hidden = false;
      break;
  }
}

/** The city's din: a car horn somewhere, every few seconds. */
let hornTimer = 4;
function cityNoise(dt: number): void {
  if (game.state !== 'city' || (hornTimer -= dt) > 0) return;
  hornTimer = 3 + Math.random() * 6;
  sfx.honk();
}

/** How close the nearest awake (tunnelling) mole is to the worm: 1 right on top, 0 far away. */
function moleNearness(): number {
  const u = game.underground;
  if (!u) return 0;
  const d = Math.min(...u.moles.filter((m) => m.state === 'roaming' || m.state === 'chasing').map((m) => Math.hypot(m.x - u.head.x, m.y - u.head.y)));
  return Math.max(0.15, 1 - d / 12);
}

/** Underground, sleeping moles snore — louder as the worm gets near (a warning, of sorts). */
let snoreTimer = 0;
function snoring(dt: number): void {
  const u = game.state === 'underground' ? game.underground : null;
  if (!u || (snoreTimer -= dt) > 0) return;
  snoreTimer = 2.4;
  const near = Math.min(...u.moles.filter((m) => m.state === 'asleep').map((m) => Math.hypot(m.x - u.head.x, m.y - u.head.y)));
  sfx.snore(Math.max(0, 1 - near / 7));
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
  skip.hidden = !game.hasNextCheckpoint;
  skip.disabled = !game.canSkip;
  // In the garden: no drying out, but a vegetable tally. Underground: how much you've dug.
  const underground = game.state === 'underground';
  const inTree = game.state === 'tree';
  const inGarden = !!game.garden && !underground && !inTree && game.state !== 'city';
  $('tree-stat').hidden = !inTree;
  $('city-stat').hidden = game.state !== 'city';
  if (game.city) {
    $('city-points').textContent = `${game.city.points}/${POINTS_TO_WIN}`;
    const en = $('energy');
    en.style.width = `${game.city.energy}%`;
    en.classList.toggle('low', game.city.energy < 30);
  }
  $('energy-stat').hidden = game.state !== 'city';
  $('height-stat').hidden = !inTree;
  if (inTree) {
    const t = game.tree!;
    $('leaves').textContent = t.eaten < TREE_LEAVES ? `${t.eaten}/${TREE_LEAVES}` : `${t.eaten} ✓`;
    $('height').textContent = t.emerged ? '🐦' : `${Math.round(t.progress() * 100)}%`;
  }
  $('moist-stat').hidden = !!game.garden;
  $('veg-stat').hidden = !inGarden;
  $('dug-stat').hidden = !underground;
  $('veg-stat').hidden = !inGarden;
  if (underground) $('dug').textContent = `${(game.underground!.dugShare() * 100).toFixed(1)}%`;
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
