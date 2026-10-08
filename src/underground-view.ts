import * as THREE from 'three';
import { BirdModel } from './bird-model.ts';
import { trophyMesh } from './garden-view.ts';
import {
  BANANA_EAT, MOLE_EAT, SEGMENTS, SEG_SPACING, UG_BIRD_DIVE, UG_H, UG_W, WORM_GROW, type Mole, type Underground,
} from './underground.ts';
import { WormModel } from './worm-model.ts';

const PX = 24; // texture pixels per world unit
const TUNNEL_R = 0.34;
// Depths behind the dirt face: the worm sits far enough back that its plump body doesn't poke
// through solid dirt, and the tunnel wall is behind that.
const WORM_Z = 0.32;
const WALL_Z = 0.7;

/**
 * The underground, side-on: a slab of dirt (a canvas texture that tunnels are carved
 * out of as the worm digs), a darker tunnel wall behind it, stones, and the worm.
 */
export class UndergroundView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  private built: Underground | null = null;
  private dirt = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private carved = 0; // how much of the dig log has been carved into the texture
  private worm = new WormModel(0.24); // plump enough to fill its tunnel
  private lamp = new THREE.PointLight(0xffd9a0, 30, 9, 1.6);
  private camAt = new THREE.Vector3(UG_W / 2, UG_H - 4, 0);
  private dust: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number }[] = [];
  private dustGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  private dustMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 1 });
  private moles: MoleModel[] = [];
  // The rotten banana (hidden in the dirt until dug up), with flies.
  private banana = rottenBanana();
  private flies: THREE.Mesh[] = [];
  // A bird overhead, inside a holder so it can be pitched into its dive.
  private birdHolder = new THREE.Group();
  private bird: BirdModel;
  // The trophy, and confetti, once the banana's found.
  private trophy = trophyMesh();
  private confetti: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: number; age: number }[] = [];
  private confettiGeo = new THREE.PlaneGeometry(0.09, 0.05);
  private celebrated = false;
  private zoom = 0;

  constructor() {
    this.dirt.width = UG_W * PX;
    this.dirt.height = UG_H * PX;
    this.ctx = this.dirt.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.dirt);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.scene.background = new THREE.Color(0x0c0705);
    this.scene.add(new THREE.AmbientLight(0xffe2c0, 0.55));
    const sky = new THREE.DirectionalLight(0xfff2dd, 0.9);
    sky.position.set(-4, 10, 8);
    this.scene.add(sky, this.lamp, this.worm.root);
    this.bird = new BirdModel(this.scene);
    this.birdHolder.add(this.bird.root); // (it adds itself to the scene; take it into the holder)
    this.scene.add(this.birdHolder);
    this.trophy.visible = false;
    this.scene.add(this.trophy);
  }

  /** Lay out the scenery for this underground (once). */
  private build(u: Underground): void {
    this.built = u;
    this.carved = 0;
    this.paintDirt(u);
    // The dirt slab, with tunnels cut out of it (alpha), and the tunnel wall behind.
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(UG_W, UG_H),
      new THREE.MeshStandardMaterial({ map: this.texture, transparent: true, alphaTest: 0.5, roughness: 1 }),
    );
    slab.position.set(UG_W / 2, UG_H / 2, 0);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(UG_W, UG_H), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 1 }));
    back.position.set(UG_W / 2, UG_H / 2, -WALL_Z);
    this.scene.add(slab, back);
    // Stones, poking out of the dirt.
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9, flatShading: true });
    for (const s of u.stones) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s.r, 1), stone);
      m.scale.set(1, 0.85, 0.45);
      m.rotation.z = s.x;
      m.position.set(s.x, s.y, 0.05);
      this.scene.add(m);
    }
    // Up top: a strip of grass and the sky above the surface.
    const grass = new THREE.Mesh(new THREE.BoxGeometry(UG_W + 40, 0.35, 1.2), new THREE.MeshStandardMaterial({ color: 0x5fa83e, roughness: 1 }));
    grass.position.set(UG_W / 2, UG_H + 0.17, 0);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(UG_W + 40, 12), new THREE.MeshBasicMaterial({ color: 0x9fd2e6 }));
    sky.position.set(UG_W / 2, UG_H + 6, -0.6);
    this.scene.add(grass, sky);
    // The rotten banana, buried (the dirt hides it until it's dug up), with its cloud of flies.
    this.banana.position.set(u.banana.x, u.banana.y, -WORM_Z);
    this.scene.add(this.banana);
    const fly = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), fly);
      this.flies.push(f);
      this.scene.add(f);
    }
    // The moles, asleep in their chambers.
    this.moles = u.moles.map((m, i) => {
      const model = new MoleModel(i % 2 ? 1 : -1);
      this.scene.add(model.root, model.zzz, model.alarm);
      return model;
    });
    // Grass blades.
    const blade = new THREE.MeshStandardMaterial({ color: 0x4f9a2f });
    for (let x = -10; x < UG_W + 10; x += 0.18) {
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.25 + Math.random() * 0.2, 4), blade);
      b.position.set(x + Math.random() * 0.1, UG_H + 0.45, (Math.random() - 0.5) * 0.8);
      b.rotation.z = (Math.random() - 0.5) * 0.4;
      this.scene.add(b);
    }
  }

  /** Bands of soil getting darker with depth, speckled with grit, roots and buried odds and ends. */
  private paintDirt(u: Underground): void {
    const ctx = this.ctx, w = this.dirt.width, h = this.dirt.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#6b4a2c'); // topsoil
    grad.addColorStop(0.08, '#5a3c22');
    grad.addColorStop(0.35, '#8a5a32'); // clay
    grad.addColorStop(0.65, '#6e4e36');
    grad.addColorStop(1, '#4a3a30'); // deep, stony
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Wavy strata lines.
    for (let band = 0; band < 9; band++) {
      const y0 = (0.1 + band * 0.1) * h;
      ctx.strokeStyle = `rgba(0,0,0,${0.08 + rand() * 0.08})`;
      ctx.lineWidth = 3 + rand() * 6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 20) ctx.lineTo(x, y0 + Math.sin(x * 0.004 + band) * 14 + Math.sin(x * 0.013) * 5);
      ctx.stroke();
    }
    // Grit.
    for (let i = 0; i < 16000; i++) {
      const light = rand() < 0.5;
      ctx.fillStyle = light ? `rgba(255,230,190,${rand() * 0.12})` : `rgba(0,0,0,${rand() * 0.18})`;
      const s = 1 + rand() * 3;
      ctx.fillRect(rand() * w, rand() * h, s, s);
    }
    // Roots dangling from the surface.
    ctx.strokeStyle = 'rgba(190,150,100,0.55)';
    for (let i = 0; i < 40; i++) {
      let x = rand() * w, y = 0;
      ctx.lineWidth = 1 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const len = 30 + rand() * 140;
      while (y < len) {
        x += (rand() - 0.5) * 10;
        y += 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Stink seeping up through the soil from the rotten banana: the only clue to where it is.
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, d = 0.6 + rand() * 2.6;
      let x = (u.banana.x + Math.cos(a) * d) * PX, y = (UG_H - u.banana.y - Math.sin(a) * d) * PX;
      ctx.strokeStyle = `rgba(140,190,60,${0.22 + rand() * 0.2})`;
      ctx.lineWidth = 2 + rand() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += Math.sin(k * 1.7 + i) * 5;
        y -= 5;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Buried things.
    for (const b of u.buried) {
      const x = b.x * PX, y = (UG_H - b.y) * PX;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.rot);
      if (b.kind === 'pebble') {
        ctx.fillStyle = '#8f877c';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5 + rand() * 6, 4 + rand() * 4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === 'bone') {
        ctx.fillStyle = '#e8dfc8';
        ctx.fillRect(-14, -3, 28, 6);
        for (const sx of [-14, 14]) for (const sy of [-4, 4]) {
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (b.kind === 'coin') {
        ctx.fillStyle = '#e0b440';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#a07a20';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // A spiral ammonite fossil.
        ctx.strokeStyle = '#b8a88a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let t = 0; t < 14; t += 0.2) ctx.lineTo(Math.cos(t) * t * 1.3, Math.sin(t) * t * 1.3);
        ctx.stroke();
      }
      ctx.restore();
    }
    this.texture.needsUpdate = true;
  }

  /** Cut any new bits of tunnel out of the dirt texture: a dark rim, then a hole. */
  private carve(u: Underground): boolean {
    if (this.carved >= u.digLog.length) return false;
    for (; this.carved < u.digLog.length; this.carved++) {
      const p = u.digLog[this.carved];
      this.hole(p.x, p.y, p.r ?? TUNNEL_R); // the worm's tunnels, or a mole's (wider)
    }
    this.texture.needsUpdate = true;
    return true;
  }

  /** Cut a round hole in the dirt, with a darker rim of packed earth round it. */
  private hole(wx: number, wy: number, radius: number): void {
    const ctx = this.ctx;
    const x = wx * PX, y = (UG_H - wy) * PX, r = radius * PX;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(30,18,10,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r + TUNNEL_R * PX * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  render(renderer: THREE.WebGLRenderer, u: Underground, dt: number, time: number): void {
    if (this.built !== u) this.build(u);
    this.carve(u);
    // The worm, lying in its tunnel (just behind the dirt face, in front of the wall).
    u.moles.forEach((m, i) => this.moles[i]?.update(m, time));
    this.poseWorm(u, time);
    this.updateBird(u, time);
    this.updateCelebration(u, dt, time);
    // The banana, going down the worm's throat; the worm, swelling up.
    this.banana.scale.setScalar(1.3 * u.bananaLeft());
    this.banana.visible = u.bananaLeft() > 0.02;
    if (u.wormState === 'won' && u.wonT < BANANA_EAT) this.banana.position.x = u.banana.x + Math.sin(time * 30) * 0.03;
    this.worm.thickness = u.wormScale();
    // Flies buzzing round the banana.
    this.flies.forEach((f, i) => f.position.set(
      u.banana.x + Math.cos(time * (5 + i) + i * 2) * (0.35 + i * 0.06),
      u.banana.y + 0.2 + Math.sin(time * (7 + i) + i) * 0.25,
      -WORM_Z + 0.1,
    ));
    this.lamp.position.set(u.head.x, u.head.y, 2.2);
    if (u.digging && Math.random() < dt * 40) this.puff(u.head.x, u.head.y, u.heading);
    for (const m of u.moles) if ((m.state === 'roaming' || m.state === 'chasing') && Math.random() < dt * 30) this.puff(m.x, m.y, m.dir, 0.7);
    for (const d of this.dust) {
      d.age += dt;
      d.vel.y -= 5 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
    }
    this.dust = this.dust.filter((d) => (d.age < 0.6 ? true : (d.mesh.removeFromParent(), false)));
    // Side-scrolling camera, easing after the worm.
    const canvas = renderer.domElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    // Zooming in on the champion once it's found the banana.
    // (Then zooming back out to follow it up to the surface.)
    const feasting = u.wormState === 'won' && u.wonT < BANANA_EAT + WORM_GROW;
    this.zoom = THREE.MathUtils.damp(this.zoom, feasting ? 1 : 0, feasting ? 2.5 : 4, dt);
    const viewH = 11 - 6 * this.zoom; // world units of dirt visible top to bottom
    const dist = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = (viewH / 2) * this.camera.aspect;
    const target = new THREE.Vector3(
      THREE.MathUtils.clamp(u.head.x, Math.min(UG_W / 2, halfW - 2), Math.max(UG_W / 2, UG_W - halfW + 2)),
      // (Room for more sky when there's a bird about, so you can see it coming.)
      THREE.MathUtils.clamp(u.head.y + this.zoom * 0.8, viewH / 2 - 0.5, UG_H + (u.bird || u.nearSurface() ? 3 : 1.5) - viewH / 2),
      0,
    );
    this.camAt.lerp(target, 1 - Math.exp(-dt * 4));
    this.camera.position.set(this.camAt.x, this.camAt.y, dist);
    this.camera.lookAt(this.camAt);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  /** The worm in its tunnel — or, if a mole has it, wriggling in its grip and being slurped down. */
  private poseWorm(u: Underground, time: number): void {
    const segs = u.segments().map((p) => new THREE.Vector3(p.x, p.y, -WORM_Z));
    const up = new THREE.Vector3(0, 0, 1);
    this.worm.root.visible = u.wormState !== 'eaten';
    if (u.wormState === 'snatched') {
      // Dangling from the bird's beak as it flies off.
      const beak = this.birdHolder.position.clone().add(new THREE.Vector3(0.6, -0.5, 0));
      const pts = segs.map((_, i) => beak.clone().add(new THREE.Vector3(Math.sin(time * 9 + i * 0.5) * 0.08 * i * 0.15, -i * SEG_SPACING, 0)));
      this.worm.pose(pts, time, true, up);
      return;
    }
    if (u.wormState === 'won') {
      this.worm.pose(segs, time, true, up); // a happy wriggle
      return;
    }
    const mole = u.captor >= 0 ? u.moles[u.captor] : null;
    if (u.wormState !== 'caught' || !mole) {
      this.worm.pose(segs, time, u.moving, up);
      return;
    }
    const mouth = this.moles[u.captor].mouth(mole);
    if (mole.state === 'waking') {
      // Thrashing in its paws.
      segs.forEach((p, i) => (p.y += Math.sin(time * 30 + i) * 0.05 * Math.max(0, 1 - i / 6)));
      this.worm.pose(segs, time, true, up);
      return;
    }
    // Slurped in like spaghetti: the body slides along itself into the mole's mouth.
    const swallowed = Math.min(SEGMENTS, (mole.t / MOLE_EAT) * SEGMENTS);
    const chain = [mouth, ...segs];
    const along = (dist: number) => {
      for (let i = 1; i < chain.length; i++) {
        const d = chain[i].distanceTo(chain[i - 1]);
        if (dist <= d) return chain[i - 1].clone().lerp(chain[i], dist / Math.max(d, 1e-6));
        dist -= d;
      }
      return chain[chain.length - 1].clone();
    };
    const pts = segs.map((_, i) => along(Math.max(0, (i - swallowed)) * SEG_SPACING + 0.05));
    pts.forEach((p, i) => (p.y += Math.sin(time * 25 + i) * 0.03));
    this.worm.pose(pts, time, true, up, Math.floor(swallowed));
  }

  /** A bird: diving from the sky at the worm's spot, then off (with or without it). */
  private updateBird(u: Underground, time: number): void {
    const b = u.bird;
    this.birdHolder.visible = !!b;
    if (!b) return;
    // Animate its wings (it thinks it's hovering), then place it ourselves for the side view.
    this.bird.update({ phase: 'carrying', t: 0, x: 0, y: 0, mash: 0 }, { x: 0, y: 0 }, time);
    this.bird.root.position.set(0, 0, 0);
    this.bird.root.rotation.set(0, -Math.PI / 2, 0); // facing +x
    const strike = new THREE.Vector3(b.x - 0.6, UG_H + 0.6, 0.6);
    let pitch = 0;
    if (b.phase === 'diving') {
      const k = Math.min(1, b.t / UG_BIRD_DIVE);
      // A long, low swoop in from the left, along the sky, then down at the worm.
      const from = strike.clone().add(new THREE.Vector3(-11, 2.6, 0));
      this.birdHolder.position.copy(from).lerp(strike, k);
      this.birdHolder.position.y = strike.y + 2.6 * (1 - k) ** 2;
      pitch = -0.45 * (1 - k * 0.6); // diving nose-down
    } else {
      const k = Math.min(1, b.t / 1.5);
      this.birdHolder.position.copy(strike).add(new THREE.Vector3(11 * k * k, 4 * k, 0));
      pitch = 0.5; // climbing away
    }
    this.birdHolder.rotation.z = pitch;
  }

  /** Found the banana: the worm holds up a trophy, confetti everywhere. */
  private updateCelebration(u: Underground, dt: number, time: number): void {
    const won = u.wormState === 'won' && u.wonT < BANANA_EAT + WORM_GROW + 0.3; // (until it heads up)
    this.trophy.visible = won;
    if (won) {
      const k = Math.min(1, u.wonT / 0.6);
      this.trophy.position.set(u.head.x, u.head.y + 0.45 * u.wormScale() + 0.35 * k + Math.sin(time * 5) * 0.05, 0.35);
      this.trophy.rotation.set(0, Math.sin(time * 2) * 0.5, 0);
      this.trophy.scale.setScalar(0.5 + 0.7 * k);
      if (!this.celebrated) {
        this.celebrated = true;
        for (let i = 0; i < 140; i++) this.popConfetti(u.head.x, u.head.y + 0.6, false);
      }
      if (Math.random() < dt * 20) this.popConfetti(u.head.x + (Math.random() - 0.5) * 8, UG_H + 1, true);
    }
    for (const c of this.confetti) {
      c.age += dt;
      c.vel.y = Math.max(-1.1, c.vel.y - 6 * dt);
      c.vel.x *= 1 - dt * 1.5;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin * dt;
      c.mesh.rotation.y += c.spin * 0.7 * dt;
    }
    this.confetti = this.confetti.filter((c) => (c.age < 6 ? true : (c.mesh.removeFromParent(), false)));
  }

  private popConfetti(x: number, y: number, fromSky: boolean): void {
    const colors = [0xff4f6d, 0xffd23f, 0x4fc3ff, 0x6ddf6d, 0xc77dff, 0xff9f43];
    const mesh = new THREE.Mesh(this.confettiGeo, new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)], side: THREE.DoubleSide }));
    mesh.position.set(x, y, 0.5);
    this.scene.add(mesh);
    const vel = fromSky ? new THREE.Vector3(0, -0.5, 0) : new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, 0);
    this.confetti.push({ mesh, vel, spin: Math.random() * 12, age: 0 });
  }

  /** Dirt flicked up by digging (the worm's, or a mole's). */
  private puff(x: number, y: number, dir: number, reach = 0.3): void {
    const mesh = new THREE.Mesh(this.dustGeo, this.dustMat);
    mesh.position.set(x + Math.cos(dir) * reach, y + Math.sin(dir) * reach, 0.1);
    this.scene.add(mesh);
    this.dust.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, 0.5), age: 0 });
  }
}

/** The inside of a tunnel: dark, damp, packed earth. */
function wallTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2e1d12';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(90,60,40,${Math.random() * 0.4})` : `rgba(0,0,0,${Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(UG_W / 16, UG_H / 6);
  return t;
}

/** A mole: velvety grey, pink snout and big pink digging paws, asleep until disturbed. */
class MoleModel {
  readonly root = new THREE.Group();
  readonly zzz: THREE.Sprite;
  readonly alarm: THREE.Sprite;
  private body: THREE.Mesh;
  private jaw: THREE.Mesh;
  private eyesShut: THREE.Mesh[] = [];
  private eyesOpen: THREE.Mesh[] = [];
  private paws: THREE.Group[] = [];
  /** Which way it faces: +1 right, -1 left (it turns to face where it's tunnelling). */
  private face: number;

  constructor(face: number) {
    this.face = face;
    face = 1; // the model is built facing right, and flipped to face left
    const fur = new THREE.MeshStandardMaterial({ color: 0x4a4248, roughness: 1 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xf2a0a8, roughness: 0.5 });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), fur);
    this.body.scale.set(1.25, 0.85, 0.8);
    this.root.add(this.body);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 12), pink);
    snout.rotation.z = -face * Math.PI / 2;
    snout.position.set(face * 0.72, 0.02, 0);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe0607a, roughness: 0.3 }));
    nose.position.set(face * 0.93, 0.02, 0);
    this.root.add(snout, nose);
    // The lower jaw (with teeth), which drops open when it eats.
    this.jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.22), new THREE.MeshStandardMaterial({ color: 0x8a3040 }));
    this.jaw.geometry.translate(face * 0.15, 0, 0);
    this.jaw.position.set(face * 0.48, -0.12, 0);
    for (let i = 0; i < 3; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      tooth.position.set(face * (0.1 + i * 0.07), 0.05, 0.06);
      this.jaw.add(tooth);
    }
    this.root.add(this.jaw);
    // Eyes: little closed lines while asleep, beady and wide when woken.
    for (const z of [0.25, -0.25]) {
      const shut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.02), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      shut.position.set(face * 0.42, 0.18, z);
      const open = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1 }));
      open.position.set(face * 0.42, 0.18, z);
      this.eyesShut.push(shut);
      this.eyesOpen.push(open);
      this.root.add(shut, open);
    }
    // Huge pink spade paws, with claws.
    for (const [dx, dy] of [[0.35, -0.3], [-0.25, -0.38]]) {
      const paw = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), pink);
      palm.scale.set(1, 0.45, 1);
      paw.add(palm);
      for (let c = 0; c < 4; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 4), new THREE.MeshStandardMaterial({ color: 0xf4efe0 }));
        claw.rotation.z = -face * Math.PI / 2;
        claw.position.set(face * 0.17, 0, -0.1 + c * 0.067);
        paw.add(claw);
      }
      paw.position.set(face * dx, dy, 0.3);
      this.paws.push(paw);
      this.root.add(paw);
    }
    this.zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: textSprite('Zzz', '#ffffff', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    this.zzz.scale.set(0.9, 0.45, 1);
    this.alarm = new THREE.Sprite(new THREE.SpriteMaterial({ map: textSprite('!', '#e0302a', '#ffffff'), depthTest: false }));
    this.alarm.scale.setScalar(0.6);
  }

  /** Where its mouth is, in world space. */
  mouth(m: Mole): THREE.Vector3 {
    return new THREE.Vector3(m.x + this.face * 0.72, m.y - 0.14, -WORM_Z);
  }

  update(m: Mole, time: number): void {
    const asleep = m.state === 'asleep' || m.state === 'full';
    const roaming = m.state === 'roaming' || m.state === 'chasing';
    if (roaming && Math.abs(Math.cos(m.dir)) > 0.2) this.face = Math.sign(Math.cos(m.dir));
    this.root.scale.set(1.2 * this.face, 1.2, 1.2);
    this.root.position.x = m.x;
    // Nose up or down when burrowing upwards or downwards.
    const tilt = roaming ? THREE.MathUtils.clamp(Math.atan2(Math.sin(m.dir), Math.abs(Math.cos(m.dir))), -0.7, 0.7) : 0;
    for (const e of this.eyesShut) e.visible = asleep;
    for (const e of this.eyesOpen) e.visible = !asleep;
    // Breathing slowly asleep (a fat belly when full); jolting when it wakes; chomping when it eats.
    const breathe = 1 + Math.sin(time * 1.8 + m.x) * 0.04;
    const full = m.state === 'full' ? 1.15 : 1;
    this.body.scale.set(1.25 * full, 0.85 * breathe * full, 0.8 * full);
    this.root.position.y = m.y - 0.05 + (m.state === 'waking' ? Math.abs(Math.sin(m.t * 30)) * 0.12 : 0);
    this.root.rotation.z = (m.state === 'waking' ? Math.sin(m.t * 40) * 0.08 : 0) + tilt * this.face;
    if (roaming) this.root.position.y += Math.abs(Math.sin(m.t * 12)) * 0.04;
    this.jaw.rotation.z = m.state === 'eating' ? -(0.15 + Math.abs(Math.sin(m.t * 10)) * 0.6) : 0;
    // Paws: furiously shovelling while it tunnels, clawing at its meal while it eats.
    this.paws.forEach((p, i) => {
      p.rotation.z = roaming ? Math.sin(time * 18 + i * Math.PI) * 0.7 : m.state === 'eating' || m.state === 'waking' ? Math.sin(time * 14 + i) * 0.4 : 0;
      p.position.x = roaming ? (i ? -0.25 : 0.35) + Math.sin(time * 18 + i * Math.PI) * 0.12 : i ? -0.25 : 0.35;
    });
    // Floating Zzz while it sleeps; a "!" when it wakes.
    this.zzz.visible = asleep;
    const drift = (time * 0.4 + m.x) % 1;
    this.zzz.position.set(m.x - this.face * 0.2 + drift * 0.3, m.y + 0.6 + drift * 0.5, 0.2);
    (this.zzz.material as THREE.SpriteMaterial).opacity = Math.sin(drift * Math.PI) * 0.9;
    this.alarm.visible = m.state === 'waking' || m.state === 'chasing';
    this.alarm.position.set(m.x, m.y + 0.95 + Math.abs(Math.sin(time * 12)) * 0.08, 0.3);
  }
}

/** A word on a little round badge (or just text, with a transparent background). */
function textSprite(text: string, color: string, bg: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(64, 32, 30, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 64, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A rotten banana: curved, blotched brown and black, gone soft. */
function rottenBanana(): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.42, 0.05, 0), new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(0.42, 0.08, 0));
  const geo = new THREE.TubeGeometry(curve, 24, 0.12, 10);
  // Blotchy: per-vertex colours from yellowish-brown to black.
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(0x9a7a2a), b = new THREE.Color(0x2a1a0a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const n = Math.sin(pos.getX(i) * 23) * Math.sin(pos.getY(i) * 31 + pos.getZ(i) * 17);
    c.copy(a).lerp(b, THREE.MathUtils.clamp(0.35 + n * 0.6, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
  for (const [x, y] of [[-0.42, 0.05], [0.42, 0.08]]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1008 }));
    tip.position.set(x, y, 0);
    g.add(tip);
  }
  g.rotation.z = 0.25;
  g.scale.setScalar(1.3);
  return g;
}
