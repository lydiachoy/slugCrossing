import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ASCEND_TIME, CROSSWALK_HALF, DEATH_TIME, GOAL_ROW, SHELL_FALL, Game as GameClass, HALF_W, LIGHT_ROWS, MUNCH_TIME, ROWS, SLOTS,
  SPAWN_MARGIN, type Game, type GameEvent, type Powerup, type Vehicle, type VehicleKind,
} from './sim.ts';
import { BirdModel } from './bird-model.ts';
import { GARDEN_Y0 } from './garden.ts';
import { GardenView } from './garden-view.ts';
import { Ghost, SLUG_PALETTE, SlugModel, type SlugPose } from './slug-model.ts';

// Sim (x, y) → world (x, 0, -y): the slug crawls away from the camera.
const W = (HALF_W + SPAWN_MARGIN) * 2 + 40; // ground runs well past the spawn points, into the fog
const TRAIL_OPACITY = 0.16; // per blob; they overlap into a glossy streak
const TRAIL_LIFE = 9; // seconds
const CAR_COLORS = [0xd8433a, 0x2f6fd1, 0xf2f2f2, 0x2a2a2e, 0x3aa35b, 0xf0a020, 0x7b4fc9];
const SIGNAL_SCALE = 1.4;
const SPLAT_LIFE = 6; // seconds a squashed-slug smear stays on the road

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

/** Everything drawn: the scene is rebuilt from the Game's state every frame. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private player = new SlugModel(0);
  private bird!: BirdModel;
  private gardenView!: GardenView;
  /** 0 = looking at the road; 1 = looking at the garden beyond the hedge. */
  private gardenPan = 0;
  private rivals = new Map<number, SlugModel>();
  private ghosts: Ghost[] = [];
  private splats: { mesh: THREE.Mesh; age: number }[] = [];
  private splatGeo = new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2);
  /** Bits of lettuce flying off a chomping slug. */
  private crumbs: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number }[] = [];
  private crumbGeo = new THREE.BoxGeometry(0.07, 0.02, 0.06);
  private crumbMat = std(0x8fd14f, { roughness: 0.6 });
  private crumbTimer = 0;
  private powerups = new Map<number, THREE.Group>();
  private saltPatches = new Map<number, THREE.Mesh>();
  private saltGeo = saltGeometry();
  private saltMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, transparent: true, emissive: 0x666666 });
  private vehicles = new Map<number, THREE.Group>();
  private warnings: THREE.Mesh[] = []; // two per road row: [left, right]
  private lettuce: THREE.Group[] = [];
  private sleepers: { group: THREE.Group; mat: THREE.MeshPhysicalMaterial }[] = [];
  private trail: { mesh: THREE.Mesh; age: number }[] = [];
  private trailMat = new THREE.MeshPhysicalMaterial({
    color: 0xe4f2f7, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: TRAIL_OPACITY, depthWrite: false,
  });
  private trailGeo = new THREE.CircleGeometry(0.14, 12).rotateX(-Math.PI / 2);
  /** Where each slug (0 = the player, else an NPC id) last dropped slime. */
  private lastTrail = new Map<number, THREE.Vector2>();
  /** Checkpoint flags on the grass medians, by row: raised once the slug reaches one. */
  private flags = new Map<number, THREE.Mesh>();
  /** Lamps of every traffic-light head, lit to match game.light. */
  private signal = { red: [] as THREE.MeshStandardMaterial[], green: [] as THREE.MeshStandardMaterial[], halos: [] as THREE.Sprite[] };
  private shake = 0;
  private time = 0;
  private lookAt = new THREE.Vector3(0, 0, -GOAL_ROW / 2 + 0.4);
  /** 0 = the whole playfield; 1 = swooped in close on a victorious slug. */
  private focus = 0;
  private focusAt = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;

    this.scene.background = new THREE.Color(0xa9d8e8);
    this.scene.fog = new THREE.Fog(0xa9d8e8, 24, 48);
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x5a7040, 1.6));
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
    sun.position.set(-6, 14, 4);
    sun.target.position.set(0, 0, -GOAL_ROW / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 40 });
    this.scene.add(sun, sun.target);

    this.buildGround();
    this.buildCrossing();
    this.scene.add(this.player.root);
    this.bird = new BirdModel(this.scene);
    this.gardenView = new GardenView(this.scene, glowTexture());
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Back the camera off until the whole playfield (plus a little) fits.
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const f = THREE.MathUtils.smootherstep(this.focus, 0, 1);
    const dist = Math.max(6.6 / tan, 8.4 / (tan * this.camera.aspect)) * (1 - 0.68 * f);
    const dir = new THREE.Vector3(0, 1.5, 0.95).lerp(new THREE.Vector3(0, 0.75, 1), f).normalize();
    const target = this.lookAt.clone().add(new THREE.Vector3(0, 0, -GARDEN_Y0 * this.gardenPan)).lerp(this.focusAt, f);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  /** React to one-off happenings: a squish leaves a smear and releases a soul. */
  handle(e: GameEvent, game: Game): void {
    if (e.type === 'squish') {
      this.shake = 0.35;
      this.addSplat(e.x, e.y, 0);
      this.addGhost(e.x, e.y);
    } else if (e.type === 'npcSquish') {
      this.shake = Math.max(this.shake, 0.12);
      this.addSplat(e.x, e.y, game.npcs.find((n) => n.id === e.id)?.color ?? 1);
      this.addGhost(e.x, e.y);
    }
  }

  private addSplat(x: number, y: number, palette: number): void {
    const mesh = new THREE.Mesh(this.splatGeo, new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(SLUG_PALETTE[palette].body).multiplyScalar(0.85), roughness: 0.2, clearcoat: 1,
      transparent: true, opacity: 0.85, depthWrite: false,
    }));
    mesh.position.set(x, 0.012 + this.splats.length * 0.0005, -y);
    mesh.scale.setScalar(0.3);
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.splats.push({ mesh, age: 0 });
  }

  private addGhost(x: number, y: number): void {
    const g = new Ghost(x, y, DEATH_TIME - 0.15);
    this.scene.add(g.root);
    this.ghosts.push(g);
  }

  render(game: Game, dt: number): void {
    this.time += dt;
    this.syncVehicles(game, dt);
    this.bird.update(game.bird, game.slug, this.time);
    this.gardenView.update(game, dt, this.time);
    // The camera follows the snail up into the garden as it glides over the hedge.
    this.gardenPan = game.state === 'garden' ? 1 : game.state === 'ascending' ? this.ascendGlide(game) : 0;
    this.syncSlugs(game, dt);
    this.syncPowerups(game);
    this.syncSalt(game);
    this.syncTrail(game, dt);
    this.ghosts = this.ghosts.filter((g) => g.update(dt));
    for (const sp of this.splats) {
      sp.age += dt;
      sp.mesh.scale.setScalar(THREE.MathUtils.damp(sp.mesh.scale.x, 1, 14, dt));
      (sp.mesh.material as THREE.MeshPhysicalMaterial).opacity = 0.85 * Math.min(1, (SPLAT_LIFE - sp.age) / 1.5);
    }
    while (this.splats.length && this.splats[0].age > SPLAT_LIFE) {
      const sp = this.splats.shift()!;
      sp.mesh.removeFromParent();
      (sp.mesh.material as THREE.Material).dispose();
    }

    // Lane warnings flash while a vehicle is about to come in from that side.
    for (const m of this.warnings) m.visible = false;
    const flash = Math.sin(this.time * 22) > -0.2;
    for (const w of game.warnings()) {
      const m = this.warnings[(this.roadRows.indexOf(w.row)) * 2 + (w.side < 0 ? 0 : 1)];
      if (m) m.visible = flash;
    }

    // Lettuce being eaten shrinks bite by bite; afterwards a contented slug naps on the stump.
    game.filled.forEach((f, i) => {
      const rival = game.npcs.find((n) => n.state === 'munching' && n.slot === i);
      const progress = game.state === 'munching' && game.munchSlot === i ? game.munchT / MUNCH_TIME
        : rival ? 1 - rival.timer / MUNCH_TIME : null;
      const l = this.lettuce[i];
      if (progress !== null) {
        l.scale.setScalar(1 - 0.55 * progress);
        l.position.y = 0.05 + Math.abs(Math.sin(this.time * 20)) * 0.03; // shaking under the chomps
        this.spawnCrumbs(i, dt);
      } else {
        l.scale.setScalar(THREE.MathUtils.damp(l.scale.x, f ? 0.45 : 1, 8, dt));
        l.position.y = 0.05;
      }
      const sleeper = this.sleepers[i];
      sleeper.group.visible = f && progress === null;
      if (sleeper.group.visible) {
        sleeper.mat.color.setHex(SLUG_PALETTE[Math.max(0, game.eater[i])].body);
        sleeper.group.children[0].scale.y = 1 + Math.sin(this.time * 2 + i) * 0.06; // breathing
      }
    });
    this.syncCrumbs(dt);
    // Checkpoint flags run up the pole and flutter.
    for (const [r, flag] of this.flags) {
      const up = game.checkpoint >= r;
      flag.position.y = THREE.MathUtils.damp(flag.position.y, up ? 1.28 : 0.4, 5, dt);
      flag.rotation.y = up ? Math.sin(this.time * 6) * 0.25 : 0;
    }
    // Traffic light: one lamp lit, with a soft glow.
    for (const m of this.signal.red) m.emissiveIntensity = game.light.red ? 3 : 0;
    for (const m of this.signal.green) m.emissiveIntensity = game.light.red ? 0 : 2.4;
    for (const h of this.signal.halos) {
      const isRed = h.userData.red as boolean;
      h.visible = isRed === game.light.red;
    }

    // The player's victory munch gets a close-up.
    const munching = game.state === 'munching';
    if (munching) this.focusAt.set(game.slug.x, 0.4, -game.slug.y + 0.2);
    const swoopIn = munching && game.munchT < MUNCH_TIME - 0.45;
    this.focus = THREE.MathUtils.clamp(this.focus + (swoopIn ? dt / 0.45 : -dt / 0.5), 0, 1);

    this.shake = Math.max(0, this.shake - dt);
    const s = this.shake * 0.5;
    this.resize();
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.renderer.render(this.scene, this.camera);
  }

  // ---- static scenery --------------------------------------------------------

  private roadRows: number[] = [];

  private buildGround(): void {
    const grass = std(0x6fb04a), grassDark = std(0x5c9a3d), asphalt = std(0x3b3d42, { roughness: 0.95 });
    const white = std(0xf4f4ee, { roughness: 0.6 }), curb = std(0xb9b6ad);
    ROWS.forEach((kind, r) => {
      const z = -r;
      if (kind === 'road') {
        this.roadRows.push(r);
        const lane = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 1), asphalt);
        lane.position.set(0, -0.05, z);
        lane.receiveShadow = true;
        this.scene.add(lane);
        // Dashes between lanes, solid lines at the road's edges.
        const above = ROWS[r + 1] === 'road';
        if (above) {
          for (let x = -W / 2 + 0.5; x < W / 2; x += 1.6) {
            const dash = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.01, 0.06), white);
            dash.position.set(x, 0.005, z - 0.5);
            this.scene.add(dash);
          }
        }
        for (const edge of [ROWS[r - 1] !== 'road' ? 0.46 : null, !above ? -0.46 : null]) {
          if (edge === null) continue;
          const line = new THREE.Mesh(new THREE.BoxGeometry(W, 0.01, 0.05), white);
          line.position.set(0, 0.005, z + edge);
          this.scene.add(line);
        }
        // A warning chevron at each end of the lane.
        for (const side of [-1, 1]) {
          const m = new THREE.Mesh(chevron(), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
          m.position.set(side * (HALF_W - 0.45), 0.03, z);
          m.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2; // point into the road
          m.visible = false;
          this.warnings.push(m);
          this.scene.add(m);
        }
      } else {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.24, 1), r % 2 ? grassDark : grass);
        strip.position.set(0, -0.08, z);
        strip.receiveShadow = true;
        this.scene.add(strip);
        if (kind === 'grass') this.scatter(z, r);
        if (kind === 'grass' && r > 0) this.buildFlag(z, r);
        // Curbs where grass meets road.
        for (const dz of [-0.5, 0.5]) {
          const next = ROWS[r + (dz < 0 ? 1 : -1)];
          if (next !== 'road') continue;
          const c = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, 0.1), curb);
          c.position.set(0, 0.0, z + dz * 0.9);
          c.receiveShadow = true;
          this.scene.add(c);
        }
      }
    });

    // The goal: a hedge with gaps for lettuce patches.
    const hedge = std(0x2f6b2c, { roughness: 1 });
    const z = -GOAL_ROW;
    const edges = [-HALF_W - SPAWN_MARGIN, ...SLOTS.flatMap((x) => [x - 0.75, x + 0.75]), HALF_W + SPAWN_MARGIN];
    for (let i = 0; i < edges.length; i += 2) {
      const [a, b] = [edges[i], edges[i + 1]];
      const h = new THREE.Mesh(new RoundedBoxGeometry(b - a, 0.8, 1, 3, 0.2), hedge);
      h.position.set((a + b) / 2, 0.3, z);
      h.castShadow = h.receiveShadow = true;
      this.scene.add(h);
    }
    SLOTS.forEach((x) => {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1), std(0x6b4a2e, { roughness: 1 }));
      soil.position.set(x, 0.02, z);
      this.scene.add(soil);
      const l = lettuceMesh();
      l.position.set(x, 0.05, z);
      this.scene.add(l);
      this.lettuce.push(l);
      const mat = new THREE.MeshPhysicalMaterial({ color: SLUG_PALETTE[0].body, roughness: 0.25, clearcoat: 1 });
      const sleeper = new THREE.Group();
      const nap = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 10).rotateZ(Math.PI / 2), mat);
      nap.scale.set(1, 0.7, 1);
      sleeper.add(nap);
      sleeper.position.set(x, 0.32, z);
      sleeper.rotation.y = 0.6;
      sleeper.visible = false;
      this.scene.add(sleeper);
      this.sleepers.push({ group: sleeper, mat });
    });
    // Far side: a bit more lawn so the hedge isn't floating.
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(W, 0.24, 8), grassDark);
    lawn.position.set(0, -0.08, z - 4.5);
    lawn.receiveShadow = true;
    this.scene.add(lawn);
    const near = new THREE.Mesh(new THREE.BoxGeometry(W, 0.24, 8), grass);
    near.position.set(0, -0.08, 4.5);
    near.receiveShadow = true;
    this.scene.add(near);
  }

  private buildFlag(z: number, r: number): void {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.3, 8), std(0xdddddd, { metalness: 0.5, roughness: 0.4 }));
    pole.position.set(-HALF_W + 0.6, 0.65, z);
    pole.castShadow = true;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.7, -0.2);
    s.lineTo(0, -0.4);
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshStandardMaterial({ color: 0xe3c13b, side: THREE.DoubleSide }));
    flag.position.set(-HALF_W + 0.63, 0.4, z);
    flag.castShadow = true;
    this.scene.add(pole, flag);
    this.flags.set(r, flag);
  }

  /** Zebra stripes and stop lines across the first road, and a traffic light on each side. */
  private buildCrossing(): void {
    const white = std(0xf4f4ee, { roughness: 0.6 });
    for (const r of LIGHT_ROWS) {
      const z = -r;
      for (let x = -CROSSWALK_HALF + 0.2; x < CROSSWALK_HALF; x += 0.48) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.86), white);
        stripe.position.set(x + 0.04, 0.006, z);
        stripe.receiveShadow = true;
        this.scene.add(stripe);
      }
      // Stop line on the approach side of each lane.
      const laneDir = r % 2 ? 1 : -1; // row 1 drives right, then the lanes alternate
      const stop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.86), white);
      stop.position.set(GameClass.stopLine(laneDir) - laneDir * 0.06, 0.006, z);
      this.scene.add(stop);
    }
    // Poles on the near verge and on the median, either side of the crosswalk.
    this.buildSignal(-CROSSWALK_HALF - 0.7, 0.05);
    this.buildSignal(CROSSWALK_HALF + 0.7, -5 + 0.3);
  }

  private buildSignal(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(SIGNAL_SCALE);
    const metal = std(0x3a3d40, { metalness: 0.6, roughness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 10), metal);
    pole.position.y = 0.85;
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.86, 0.26, 2, 0.06), std(0x1f2124, { roughness: 0.5 }));
    head.position.y = 1.95;
    pole.castShadow = head.castShadow = true;
    g.add(pole, head);
    const lamps: [number, number, 'red' | 'amber' | 'green'][] = [[0.26, 0xff2a1f, 'red'], [0, 0xffb020, 'amber'], [-0.26, 0x2cff6a, 'green']];
    for (const [dy, color, which] of lamps) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0, roughness: 0.3 });
      // Two faces: towards the camera and away, so it reads from any angle.
      for (const side of [1, -1]) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), mat);
        lamp.position.set(0, 1.95 + dy, side * 0.135);
        if (side < 0) lamp.rotation.y = Math.PI;
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12, 1, true, -Math.PI / 2, Math.PI), std(0x1f2124));
        visor.rotation.x = side * Math.PI / 2;
        visor.position.set(0, 1.95 + dy + 0.02, side * 0.17);
        g.add(lamp, visor);
      }
      if (which === 'amber') continue;
      this.signal[which].push(mat);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
      }));
      halo.scale.setScalar(0.75);
      halo.position.set(0, 1.95 + dy, 0.2);
      halo.userData.red = which === 'red';
      this.signal.halos.push(halo);
      g.add(halo);
    }
    this.scene.add(g);
  }

  /** Daisies and pebbles on a grass strip (deterministic, from the row number). */
  private scatter(z: number, r: number): void {
    let seed = r * 97 + 13;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const petal = std(0xffffff), centre = std(0xf5c518), pebble = std(0x9b968c);
    for (let i = 0; i < 22; i++) {
      const x = (rand() - 0.5) * W, dz = (rand() - 0.5) * 0.8;
      if (rand() < 0.6) {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), petal);
        f.position.set(x, 0.05, z + dz);
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), centre);
        c.position.set(x, 0.065, z + dz);
        this.scene.add(f, c);
      } else {
        const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06 + rand() * 0.05), pebble);
        p.position.set(x, 0.05, z + dz);
        p.castShadow = true;
        this.scene.add(p);
      }
    }
  }

  // ---- slugs -----------------------------------------------------------------

  /** 0 → 1 as the new snail glides from the lettuce up into the garden. */
  private ascendGlide(game: Game): number {
    const k = THREE.MathUtils.clamp((game.ascendT - SHELL_FALL - 0.4) / (ASCEND_TIME - SHELL_FALL - 0.4), 0, 1);
    return k * k * (3 - 2 * k);
  }

  private syncSlugs(game: Game, dt: number): void {
    const s = game.slug;
    this.player.setShell(game.isSnail);
    if (game.state === 'ascending' || game.state === 'garden') {
      this.syncSnail(game, dt);
      this.syncRivals(game, dt);
      return;
    }
    const bird = game.bird;
    const eaten = game.state === 'dying' && game.deathCause === 'eaten';
    let mode: SlugPose['mode'] = game.state === 'ready' || game.state === 'gameOver' ? 'hidden'
      : game.state === 'munching' ? 'munch'
      : game.state === 'grabbed' ? 'carried'
      : eaten ? (bird ? 'carried' : 'hidden')
      : game.state === 'dying' ? (game.deathCause === 'eaten' ? 'hidden' : game.deathCause ?? 'dried') : 'crawl';
    const t = game.state === 'munching' ? game.munchT : game.deathT;
    if (mode === 'carried') {
      // In the bird's talons (and, if it's being eaten, gone once the bird is offscreen).
      const at = this.bird.talons;
      if (eaten && bird!.t > 1.3) mode = 'hidden';
      this.player.update({ ...s, x: at.x, y: -at.z, z: at.y, facing: 'down', mode, t }, dt, this.time);
    } else {
      // Just let go: a short fall to the ground.
      const falling = bird && bird.phase === 'leaving' && !bird.ate && bird.t < 0.35;
      const z = falling ? 1.4 * Math.pow(1 - bird.t / 0.35, 2) : 0;
      this.player.update({ ...s, mode, t, z }, dt, this.time);
    }
    this.syncRivals(game, dt);
  }

  /** The snail: gliding up during the ascension; in the garden, roaming, chewing, held or thrown. */
  private syncSnail(game: Game, dt: number): void {
    const s = game.slug;
    if (game.state === 'ascending') {
      const k = this.ascendGlide(game);
      const mode = game.ascendT < SHELL_FALL ? 'munch' : 'crawl';
      this.player.update({ ...s, mode, t: MUNCH_TIME / 2, z: Math.sin(k * Math.PI) * 1.8 }, dt, this.time);
      return;
    }
    const g = game.garden!;
    if (g.phase === 'caught') {
      this.player.update({ ...s, mode: 'carried', t: 0, z: g.z + 0.5 }, dt, this.time);
    } else if (g.phase === 'thrown') {
      this.player.update({ ...s, mode: 'flung', t: g.phaseT, z: g.z + 0.5 }, dt, this.time);
    } else {
      const chewing = g.veg.some((v) => v.eaten > 0 && v.eaten < 1 && Math.hypot(v.x - s.x, v.y - s.y) < v.r + 0.4);
      this.player.update({ ...s, mode: 'crawl', t: 0, chewing }, dt, this.time);
    }
  }

  private syncRivals(game: Game, dt: number): void {
    const seen = new Set<number>();
    for (const n of game.npcs) {
      seen.add(n.id);
      let m = this.rivals.get(n.id);
      if (!m) {
        m = new SlugModel(n.color);
        this.rivals.set(n.id, m);
        this.scene.add(m.root);
      }
      const nmode: SlugPose['mode'] = n.state === 'dying' ? n.cause ?? 'squished'
        : n.state === 'munching' ? 'munch' : n.state === 'flung' ? 'flung' : 'crawl';
      const t = n.state === 'munching' ? MUNCH_TIME - n.timer : n.state === 'flung' ? 2.2 - n.timer : DEATH_TIME - n.timer;
      m.update({ x: n.x, y: n.y, facing: n.facing, moving: n.moving, mode: nmode, t, moisture: 100, z: n.fling?.z }, dt, this.time);
    }
    for (const [id, m] of this.rivals) {
      if (seen.has(id)) continue;
      m.dispose();
      this.rivals.delete(id);
      this.lastTrail.delete(id);
    }
  }

  /** Power-ups bob and spin where they lie. */
  private syncPowerups(game: Game): void {
    const seen = new Set<number>();
    for (const p of game.powerups) {
      seen.add(p.id);
      let g = this.powerups.get(p.id);
      if (!g) {
        g = powerupMesh(p);
        this.powerups.set(p.id, g);
        this.scene.add(g);
      }
      g.position.set(p.x, 0.35 + Math.sin(this.time * 3 + p.id) * 0.08, -p.y);
      (g.userData.spin as THREE.Object3D).rotation.y = this.time * 2.2;
      const pulse = 1 + Math.sin(this.time * 6) * 0.08;
      (g.userData.glow as THREE.Sprite).scale.setScalar(1.3 * pulse);
    }
    for (const [id, g] of this.powerups) {
      if (seen.has(id)) continue;
      g.removeFromParent();
      this.powerups.delete(id);
    }
  }

  /** Salt patches: bright white crystals, dissolving away at the end of their life. */
  private syncSalt(game: Game): void {
    const seen = new Set<number>();
    for (const p of game.salt) {
      seen.add(p.id);
      let m = this.saltPatches.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.saltGeo, this.saltMat.clone());
        m.position.set(p.x, 0.01, -p.row + (Math.random() - 0.5) * 0.3);
        m.rotation.y = Math.random() * Math.PI * 2;
        m.userData.size = 0.8 + Math.random() * 0.4;
        this.saltPatches.set(p.id, m);
        this.scene.add(m);
      }
      // Dissolves away: shrinks and fades over its last moments.
      const left = Math.min(1, p.t / 0.6);
      (m.material as THREE.MeshStandardMaterial).opacity = left;
      m.scale.setScalar((m.userData.size as number) * (0.4 + 0.6 * left));
    }
    for (const [id, m] of this.saltPatches) {
      if (seen.has(id)) continue;
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
      this.saltPatches.delete(id);
    }
  }

  /** Green bits flying off a lettuce being chomped. */
  private spawnCrumbs(slot: number, dt: number): void {
    this.crumbTimer -= dt;
    if (this.crumbTimer > 0) return;
    this.crumbTimer = 0.05;
    for (let k = 0; k < 2; k++) {
      const mesh = new THREE.Mesh(this.crumbGeo, this.crumbMat);
      mesh.position.set(SLOTS[slot] + (Math.random() - 0.5) * 0.3, 0.45, -GOAL_ROW + 0.25);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.scene.add(mesh);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.5 + Math.random() * 1.5, 0.4 + Math.random() * 1.2);
      this.crumbs.push({ mesh, vel, age: 0 });
    }
  }

  private syncCrumbs(dt: number): void {
    for (const c of this.crumbs) {
      c.age += dt;
      c.vel.y -= 9 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += dt * 8;
      if (c.mesh.position.y < 0.02) c.age = 99;
    }
    this.crumbs = this.crumbs.filter((c) => (c.age < 0.8 ? true : (c.mesh.removeFromParent(), false)));
  }

  /** Slime: a glistening streak left behind every slug, fading over a few seconds. */
  private syncTrail(game: Game, dt: number): void {
    if (game.state === 'playing' || (game.state === 'garden' && game.garden!.phase === 'free')) this.slime(0, game.slug.x, game.slug.y);
    for (const n of game.npcs) if (n.state === 'waiting' || n.state === 'crawling') this.slime(n.id, n.x, n.y);
    for (const t of this.trail) {
      t.age += dt;
      (t.mesh.material as THREE.MeshPhysicalMaterial).opacity = TRAIL_OPACITY * Math.max(0, 1 - t.age / TRAIL_LIFE);
    }
    while (this.trail.length && (this.trail[0].age > TRAIL_LIFE || this.trail.length > 400)) {
      const t = this.trail.shift()!;
      this.scene.remove(t.mesh);
      (t.mesh.material as THREE.Material).dispose();
    }
  }

  private slime(key: number, x: number, y: number): void {
    const here = new THREE.Vector2(x, y);
    const last = this.lastTrail.get(key);
    if (!last || here.distanceTo(last) > 0.5) {
      this.lastTrail.set(key, here); // new or respawned
      return;
    }
    if (here.distanceTo(last) < 0.06) return;
    const m = new THREE.Mesh(this.trailGeo, this.trailMat.clone());
    m.position.set(x, 0.008, -y);
    m.scale.set(1, 1, 0.8 + Math.random() * 0.4);
    this.scene.add(m);
    this.trail.push({ mesh: m, age: 0 });
    last.copy(here);
  }

  // ---- traffic ---------------------------------------------------------------

  private syncVehicles(game: Game, dt: number): void {
    const seen = new Set<number>();
    for (const v of game.vehicles) {
      seen.add(v.id);
      let g = this.vehicles.get(v.id);
      if (!g) {
        g = vehicleMesh(v);
        this.vehicles.set(v.id, g);
        this.scene.add(g);
      }
      g.position.set(v.x, 0, -v.row);
      // Wheels spin; a slight bounce sells the speed.
      g.position.y = Math.abs(Math.sin(this.time * 30 + v.id)) * 0.015;
      for (const w of g.userData.wheels as THREE.Mesh[]) w.rotation.z -= (Math.sign(v.speed) * v.vel * dt) / 0.17;
      // Brake lights glow when slowing or stopped.
      const braking = v.vel < Math.abs(v.speed) - 0.5;
      (g.userData.tail as THREE.MeshBasicMaterial).color.setHex(braking ? 0xff1a1a : 0x8a1414);
      for (const s of g.userData.streaks as THREE.Mesh[]) s.visible = v.vel > 4;
    }
    for (const [id, g] of this.vehicles) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      g.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      this.vehicles.delete(id);
    }
  }
}

/** A flat arrowhead pointing along +z (rotated to point into the lane). */
function chevron(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3);
  s.lineTo(0.28, -0.1);
  s.lineTo(0.12, -0.1);
  s.lineTo(0, 0.07);
  s.lineTo(-0.12, -0.1);
  s.lineTo(-0.28, -0.1);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

function lettuceMesh(): THREE.Group {
  const g = new THREE.Group();
  const greens = [std(0x8fd14f, { roughness: 0.55 }), std(0x6dbb3c, { roughness: 0.55 }), std(0xb8e57a, { roughness: 0.55 })];
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), greens[2]);
  core.position.y = 0.24;
  core.scale.y = 0.85;
  g.add(core);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), greens[i % 2]);
    leaf.scale.set(1, 0.6, 0.45);
    leaf.position.set(Math.cos(a) * 0.24, 0.17, Math.sin(a) * 0.24);
    leaf.rotation.set(0, -a, 0.5);
    g.add(leaf);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A chunky toy-like vehicle, `len` long along x, nose towards its direction of travel. */
function vehicleMesh(v: Vehicle): THREE.Group {
  const g = new THREE.Group();
  const nose = Math.sign(v.speed);
  const paint = std(CAR_COLORS[v.id % CAR_COLORS.length], { roughness: 0.35, metalness: 0.2 });
  const glass = std(0x1d2a38, { roughness: 0.15, metalness: 0.4 });
  const tyre = std(0x161616, { roughness: 0.9 });
  const L = v.len;
  const kind: VehicleKind = v.kind;
  const body = (w: number, h: number, d: number, x: number, y: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.08, h / 3)), m);
    b.position.set(x * nose, y, 0);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  if (kind === 'dumptruck') {
    // A yellow tipper truck, its bed heaped with road salt.
    const yellow = std(0xf2b81c, { roughness: 0.45, metalness: 0.2 });
    body(L * 0.3, 0.62, 0.66, L * 0.33, 0.48, yellow); // cab
    body(L * 0.1, 0.26, 0.6, L * 0.44, 0.62, glass);
    const bed = body(L * 0.62, 0.42, 0.7, -L * 0.17, 0.5, std(0x8a8d90, { roughness: 0.5, metalness: 0.5 }));
    bed.rotation.z = nose * -0.12; // tipped up at the front
    const heap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), std(0xf4f4f4, { roughness: 0.9 }));
    heap.scale.set(1.6, 0.45, 0.8);
    heap.position.set(-L * 0.17 * nose, 0.78, 0);
    g.add(heap);
    // Hazard stripes on the bed's tail.
    for (const z of [-0.2, 0, 0.2]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.09), std(z === 0 ? 0x111111 : 0xf2b81c));
      stripe.position.set(-nose * (L * 0.48 + 0.01), 0.5, z);
      g.add(stripe);
    }
  } else if (kind === 'truck') {
    body(L * 0.7, 0.75, 0.66, -L * 0.13, 0.55, std(0xe9e6df, { roughness: 0.6 })); // box trailer
    body(L * 0.24, 0.6, 0.62, L * 0.36, 0.45, paint); // cab
    body(L * 0.08, 0.26, 0.56, L * 0.43, 0.6, glass);
  } else if (kind === 'van') {
    body(L, 0.6, 0.64, 0, 0.45, paint);
    body(L * 0.2, 0.3, 0.6, L * 0.38, 0.55, glass);
  } else {
    const low = kind === 'sports';
    body(L, low ? 0.24 : 0.32, 0.62, 0, low ? 0.24 : 0.28, paint);
    body(L * 0.5, low ? 0.2 : 0.26, 0.54, -L * 0.06, low ? 0.42 : 0.53, glass);
    if (low) body(0.1, 0.06, 0.56, -L * 0.47, 0.42, paint); // spoiler
  }
  const lamp = (x: number, color: number) => {
    const mat = new THREE.MeshBasicMaterial({ color });
    for (const z of [-0.22, 0.22]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.12), mat);
      l.position.set(x * nose, kind === 'sports' ? 0.26 : 0.32, z);
      g.add(l);
    }
    return mat;
  };
  lamp(L / 2 + 0.005, 0xfff6c8);
  g.userData.tail = lamp(-L / 2 - 0.005, 0x8a1414);
  const wheels: THREE.Mesh[] = [];
  const axles = kind === 'truck' || kind === 'dumptruck' ? [L * 0.36, -L * 0.1, -L * 0.36] : [L * 0.32, -L * 0.32];
  for (const x of axles) {
    for (const z of [-0.33, 0.33]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14).rotateX(Math.PI / 2), tyre);
      w.position.set(x * nose, 0.17, z);
      w.castShadow = true;
      g.add(w);
      wheels.push(w);
    }
  }
  // Speed streaks trailing behind.
  const streak = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  for (const [y, z, len] of [[0.5, -0.2, 1.6], [0.3, 0.25, 2.2], [0.65, 0.1, 1.2]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.03).rotateX(-Math.PI / 2), streak);
    s.position.set(-nose * (L / 2 + len / 2 + 0.1), y, z);
    g.add(s);
  }
  g.userData.wheels = wheels;
  g.userData.streaks = g.children.slice(-3);
  return g;
}

let glow: THREE.Texture | null = null;
/** A soft round falloff, for lamp halos. */
function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffffff');
  grad.addColorStop(0.35, '#ffffff66');
  grad.addColorStop(1, '#ffffff00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

/** A scatter of salt crystals, lying on the road. */
function saltGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.BoxGeometry(0.05, 0.035, 0.05);
    c.rotateY(Math.random() * 3);
    c.translate((Math.random() - 0.5) * 0.32, 0.017, (Math.random() - 0.5) * 0.5);
    parts.push(c);
  }
  const film = new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2);
  film.scale(1, 1, 1.4);
  parts.push(film.toNonIndexed());
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Slow-mo: a spinning blue hourglass. 1UP: a green "1UP" badge. Both glow. */
function powerupMesh(p: Powerup): THREE.Group {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  let glowColor: number;
  if (p.kind === 'slow') {
    glowColor = 0x6ec8ff;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, transmission: 0.6, thickness: 0.2, transparent: true, opacity: 0.85 });
    const gold = std(0xe0b040, { metalness: 0.8, roughness: 0.3 });
    const sand = std(0xf2d48a, { roughness: 0.9 });
    for (const dir of [1, -1]) {
      const bulb = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 16, 1, true), glass);
      bulb.rotation.x = dir > 0 ? Math.PI : 0;
      bulb.position.y = dir * 0.11;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), gold);
      cap.position.y = dir * 0.24;
      spin.add(bulb, cap);
    }
    const pile = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.1, 12), sand);
    pile.position.y = -0.17;
    spin.add(pile);
    for (const [x, z] of [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.48, 6), gold);
      rod.position.set(x, 0, z);
      spin.add(rod);
    }
  } else {
    glowColor = 0x6dff7a;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2fb84a';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 50px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1UP', 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // A sprite, so the badge always faces the camera.
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    badge.scale.setScalar(0.62);
    spin.add(badge);
  }
  spin.traverse((o) => (o.castShadow = true));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: glowColor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7,
  }));
  g.add(glow);
  g.userData.spin = spin;
  g.userData.glow = glow;
  return g;
}
