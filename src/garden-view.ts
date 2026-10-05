import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GARDEN_Y0, GARDEN_Y1, VISION_HALF, VISION_RANGE, type Garden, type Gardener, type Veg, type VegKind,
} from './garden.ts';
import { HALF_W } from './layout.ts';
import { SHELL_FALL, type Game } from './sim.ts';

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
// Not fully metallic: there's no environment for a pure metal to reflect, so it would render dark.
const GOLD = () => new THREE.MeshStandardMaterial({ color: 0xffcf40, metalness: 0.45, roughness: 0.28, emissive: 0xb07a00, emissiveIntensity: 0.55 });

/** A coiled snail shell, built from shrinking beads along a spiral. About 0.5 across. */
export function shellMesh(material: THREE.Material = GOLD()): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const turns = 2.6, beads = 34;
  for (let i = 0; i < beads; i++) {
    const k = i / (beads - 1);
    const theta = k * turns * Math.PI * 2;
    const r = 0.21 * Math.exp(-0.2 * theta); // logarithmic spiral, tightening to the tip
    const bead = new THREE.SphereGeometry(Math.max(0.025, r * 0.78), 12, 8);
    bead.translate(r * Math.cos(theta), r * Math.sin(theta), k * 0.12); // a little conical
    parts.push(bead);
  }
  const m = new THREE.Mesh(mergeGeometries(parts), material);
  m.castShadow = true;
  return m;
}

/** The garden's scenery, the gardener, and the golden-shell ascension. */
export class GardenView {
  private root = new THREE.Group();
  private built: Garden | null = null;
  private vegMeshes = new Map<number, THREE.Group>();
  private gardener = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private cone: THREE.Mesh;
  private coneMat = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  private alarm: THREE.Sprite;
  private lastPos = new THREE.Vector2();
  private stride = 0;
  // Ascension.
  private beam: THREE.Mesh;
  private fallingShell: THREE.Group;
  private flash: THREE.Sprite;
  private sparkles: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number }[] = [];
  private sparkleGeo = new THREE.OctahedronGeometry(0.05);
  private sparkleMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  private landed = false;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, glow: THREE.Texture) {
    this.scene = scene;
    scene.add(this.root);
    this.root.visible = false;

    // The vision cone: a translucent fan on the ground (rotation.y = gaze).
    this.cone = new THREE.Mesh(
      new THREE.CircleGeometry(VISION_RANGE, 28, -VISION_HALF, VISION_HALF * 2).rotateX(-Math.PI / 2),
      this.coneMat,
    );
    this.cone.position.y = 0.03;
    this.scene.add(this.cone);
    this.cone.visible = false;
    this.buildGardener();
    this.alarm = new THREE.Sprite(new THREE.SpriteMaterial({ map: exclaim(), depthTest: false }));
    this.alarm.scale.setScalar(0.7);
    this.alarm.visible = false;
    this.scene.add(this.alarm);

    // Ascension: a beam from the heavens, the shell coming down it, a flash on landing.
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.9, 30, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.visible = false;
    this.scene.add(this.beam);
    this.fallingShell = new THREE.Group();
    const s = shellMesh();
    s.scale.setScalar(2.2);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(2.2);
    this.fallingShell.add(s, halo);
    this.fallingShell.visible = false;
    this.scene.add(this.fallingShell);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff6c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.flash.visible = false;
    this.scene.add(this.flash);
  }

  update(game: Game, dt: number, time: number): void {
    this.updateAscension(game, dt, time);
    const g = game.garden;
    if (g && this.built !== g) this.build(g);
    this.root.visible = !!g;
    this.gardener.visible = this.cone.visible = !!g;
    this.alarm.visible = false;
    if (!g) return;
    for (const v of g.veg) this.updateVeg(v, dt);
    this.updateGardener(g.gardener, dt, time);
  }

  // ---- the ascension ----------------------------------------------------------------

  private updateAscension(game: Game, dt: number, time: number): void {
    const ascending = game.state === 'ascending';
    const t = game.ascendT;
    const s = game.slug;
    const beamMat = this.beam.material as THREE.MeshBasicMaterial;
    this.beam.visible = ascending && t < SHELL_FALL + 1.2;
    if (this.beam.visible) {
      const fadeIn = Math.min(1, t / 0.5), fadeOut = Math.min(1, Math.max(0, (SHELL_FALL + 1.2 - t) / 0.8));
      beamMat.opacity = 0.32 * fadeIn * fadeOut * (0.85 + Math.sin(time * 12) * 0.15);
      this.beam.position.set(s.x, 15, -s.y);
    }
    this.fallingShell.visible = ascending && t < SHELL_FALL;
    if (this.fallingShell.visible) {
      // Floats down from the sky, turning, slowing as it nears.
      const k = Math.min(1, t / SHELL_FALL);
      const height = 0.5 + 13 * Math.pow(1 - k, 1.6);
      this.fallingShell.position.set(s.x, height, -s.y);
      this.fallingShell.rotation.set(0.3, time * 2.5, Math.sin(time * 3) * 0.3);
      this.fallingShell.scale.setScalar(1 - 0.55 * k);
      if (Math.random() < dt * 30) this.sparkle(this.fallingShell.position, 1.5);
    }
    if (ascending && t >= SHELL_FALL && !this.landed) {
      this.landed = true;
      this.flash.visible = true;
      this.flash.position.set(s.x, 0.6, -s.y);
      for (let i = 0; i < 40; i++) this.sparkle(this.flash.position, 4);
    }
    if (!ascending) this.landed = false;
    const flashMat = this.flash.material;
    if (this.flash.visible) {
      const k = ascending ? (t - SHELL_FALL) / 0.7 : 1;
      flashMat.opacity = Math.max(0, 1 - k);
      this.flash.scale.setScalar(1 + k * 7);
      if (k >= 1) this.flash.visible = false;
    }
    for (const p of this.sparkles) {
      p.age += dt;
      p.vel.y -= 2 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0, 1 - p.age / 1.2));
    }
    this.sparkles = this.sparkles.filter((p) => (p.age < 1.2 ? true : (p.mesh.removeFromParent(), false)));
  }

  private sparkle(at: THREE.Vector3, speed: number): void {
    const mesh = new THREE.Mesh(this.sparkleGeo, this.sparkleMat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    this.sparkles.push({ mesh, vel, age: 0 });
  }

  // ---- the garden itself -----------------------------------------------------------

  private build(g: Garden): void {
    this.root.clear();
    this.vegMeshes.clear();
    this.built = g;
    const zMid = -(GARDEN_Y0 + GARDEN_Y1) / 2;
    const depth = GARDEN_Y1 - GARDEN_Y0 + 6;
    // Lush lawn, with a gravel path round the edge.
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 60, 0.24, depth + 8), std(0x5fa83e));
    lawn.position.set(0, -0.075, zMid - 2);
    lawn.receiveShadow = true;
    this.root.add(lawn);
    const path = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 1.4, 0.02, GARDEN_Y1 - GARDEN_Y0 + 1.6), std(0xcdbb95, { roughness: 1 }));
    path.position.set(0, 0.05, zMid - 0.2);
    path.receiveShadow = true;
    const lawnInner = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 - 0.2, 0.02, GARDEN_Y1 - GARDEN_Y0 + 0.4), std(0x6cb848));
    lawnInner.position.set(0, 0.06, zMid - 0.2);
    lawnInner.receiveShadow = true;
    this.root.add(path, lawnInner);
    // Dark soil beds under each vegetable.
    const soil = std(0x5a3d26, { roughness: 1 });
    for (const v of g.veg) {
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(v.r + 0.25, v.r + 0.3, 0.06, 18), soil);
      bed.position.set(v.x, 0.07, -v.y);
      bed.receiveShadow = true;
      this.root.add(bed);
      const mesh = vegMesh(v.kind);
      mesh.position.set(v.x, 0.09, -v.y);
      mesh.rotation.y = v.id * 1.7;
      this.root.add(mesh);
      this.vegMeshes.set(v.id, mesh);
    }
    // Big mossy rocks.
    const stone = std(0x8d8a84, { roughness: 0.95, flatShading: true }), moss = std(0x5d8a3a, { roughness: 1, flatShading: true });
    for (const r of g.rocks) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r * 1.05, 1), stone);
      rock.scale.set(1, 0.85, 1);
      rock.position.set(r.x, r.r * 0.55, -r.y);
      rock.rotation.set(r.x, r.y, 0);
      rock.castShadow = rock.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r.r * 0.75, 10, 6, 0, Math.PI * 2, 0, 1), moss);
      cap.position.set(r.x - r.r * 0.1, r.r * 1.15, -r.y + r.r * 0.05);
      cap.scale.set(1, 0.5, 1);
      this.root.add(rock, cap);
    }
    // Flowers.
    const stem = std(0x3f8a2e);
    const stems: THREE.BufferGeometry[] = [];
    const heads = new Map<number, THREE.BufferGeometry[]>();
    for (const f of g.flowers) {
      const h = 0.18 + ((f.x * 13.7 + f.y * 7.1) % 1 + 1) % 1 * 0.18;
      stems.push(new THREE.CylinderGeometry(0.012, 0.015, h, 4).translate(f.x, 0.07 + h / 2, -f.y));
      const head = new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.55, 1).translate(f.x, 0.07 + h, -f.y);
      if (!heads.has(f.color)) heads.set(f.color, []);
      heads.get(f.color)!.push(head);
    }
    if (stems.length) this.root.add(new THREE.Mesh(mergeGeometries(stems), stem));
    for (const [color, geos] of heads) {
      const m = new THREE.Mesh(mergeGeometries(geos), std(color, { roughness: 0.6 }));
      m.castShadow = true;
      this.root.add(m);
    }
    // A white picket fence round the back and sides.
    const white = std(0xf4f1e8, { roughness: 0.7 });
    const pickets: THREE.BufferGeometry[] = [];
    const backZ = -(GARDEN_Y1 + 0.9);
    for (let x = -HALF_W - 0.6; x <= HALF_W + 0.6; x += 0.32) pickets.push(new THREE.BoxGeometry(0.12, 0.6, 0.05).translate(x, 0.35, backZ));
    for (const side of [-1, 1]) {
      for (let z = -GARDEN_Y0 + 0.4; z >= backZ; z -= 0.32) pickets.push(new THREE.BoxGeometry(0.05, 0.6, 0.12).translate(side * (HALF_W + 0.65), 0.35, z));
    }
    pickets.push(new THREE.BoxGeometry(HALF_W * 2 + 1.4, 0.07, 0.04).translate(0, 0.45, backZ + 0.04));
    const fence = new THREE.Mesh(mergeGeometries(pickets), white);
    fence.castShadow = true;
    this.root.add(fence);
  }

  private updateVeg(v: Veg, dt: number): void {
    const m = this.vegMeshes.get(v.id);
    if (!m) return;
    // Shrinks as it's eaten (with a wobble), gone when finished, pops back when it regrows.
    const target = v.eaten >= 1 ? 0 : 1 - 0.7 * v.eaten;
    const s = THREE.MathUtils.damp(m.scale.x, target, v.eaten > 0 && v.eaten < 1 ? 20 : 6, dt);
    m.scale.setScalar(s);
    m.visible = s > 0.02;
    m.rotation.z = v.eaten > 0 && v.eaten < 1 ? Math.sin(performance.now() / 40) * 0.08 : 0;
  }

  // ---- the gardener -----------------------------------------------------------------

  /** Straw hat, beard, plaid shirt, blue overalls, big boots. Faces -z. */
  private buildGardener(): void {
    const g = this.gardener;
    const denim = std(0x3c5f9c), shirt = std(0xc4473a), skin = std(0xf0c8a0), boot = std(0x3a2a1c), straw = std(0xe3c47a, { roughness: 0.9 });
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0.75, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.2), denim);
      leg.position.y = -0.33;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.32), boot);
      foot.position.set(0, -0.66, -0.05);
      hip.add(leg, foot);
      g.add(hip);
      this.legs.push(hip);
    }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3), shirt);
    torso.position.y = 1.03;
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.04), denim);
    bib.position.set(0, 0.98, -0.16);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.32), denim);
    belly.position.y = 0.82;
    g.add(torso, bib, belly);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.32, 1.25, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.15), shirt);
      arm.position.y = -0.27;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skin);
      hand.position.y = -0.58;
      shoulder.add(arm, hand);
      g.add(shoulder);
      this.arms.push(shoulder);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin);
    head.position.y = 1.5;
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0x8a5a32));
    beard.position.set(0, 1.47, -0.06);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), std(0xe8a080));
    nose.position.set(0, 1.5, -0.2);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), std(0x111111));
      eye.position.set(side * 0.07, 1.56, -0.18);
      g.add(eye);
    }
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20), straw);
    brim.position.y = 1.66;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.2, 16), straw);
    crown.position.y = 1.77;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.05, 16), std(0x7a2a1c));
    band.position.y = 1.7;
    g.add(head, beard, nose, brim, crown, band);
    g.traverse((o) => (o.castShadow = true));
    g.scale.setScalar(1.15);
    this.scene.add(g);
  }

  private updateGardener(gd: Gardener, dt: number, time: number): void {
    const g = this.gardener;
    g.position.set(gd.x, 0, -gd.y);
    g.rotation.y = gd.heading - Math.PI / 2;
    // Walk cycle, from how far he actually moved.
    const moved = Math.hypot(gd.x - this.lastPos.x, gd.y - this.lastPos.y);
    this.lastPos.set(gd.x, gd.y);
    this.stride += moved * 5.5;
    const swing = moved > 0.001 ? Math.sin(this.stride) * Math.min(0.8, 0.35 + moved / dt * 0.12) : 0;
    this.legs.forEach((l, i) => (l.rotation.x = (i ? 1 : -1) * swing));
    g.position.y = Math.abs(Math.sin(this.stride)) * 0.04 * (moved > 0.001 ? 1 : 0);
    // Arms: swinging, or holding the snail up, or the big throw.
    if (gd.state === 'carry') {
      this.arms[1].rotation.set(-2.6, 0, 0); // snail held high in his right hand
      this.arms[0].rotation.set(-0.3, 0, 0.3);
    } else if (gd.state === 'throw') {
      const k = Math.min(1, gd.t / 0.3);
      this.arms[1].rotation.set(-2.6 + 2.2 * k, 0, 0);
      this.arms[0].rotation.set(0, 0, 0);
    } else if (gd.state === 'alert') {
      this.arms.forEach((a, i) => a.rotation.set(-0.4, 0, (i ? -1 : 1) * 0.9)); // hands up: "HEY!"
    } else {
      this.arms.forEach((a, i) => a.rotation.set((i ? -1 : 1) * swing * 0.8, 0, 0));
    }
    // The cone of sight.
    const angry = gd.state === 'alert' || gd.state === 'chase';
    this.cone.position.set(gd.x, 0.08, -gd.y);
    this.cone.rotation.y = gd.gaze;
    this.coneMat.color.setHex(angry ? 0xff4a3a : 0xfff27a);
    this.coneMat.opacity = angry ? 0.3 : 0.2 + Math.sin(time * 3) * 0.03;
    this.cone.visible = gd.state !== 'carry' && gd.state !== 'throw';
    if (angry) {
      this.alarm.visible = true;
      this.alarm.position.set(gd.x, 2.6 + Math.abs(Math.sin(time * 10)) * 0.1, -gd.y);
    }
  }
}

/** A red "!" for when he spots you. */
function exclaim(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e0302a';
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One of the garden's vegetables, sitting on the ground at the origin. */
function vegMesh(kind: VegKind): THREE.Group {
  const g = new THREE.Group();
  const leaf = std(0x4f9a2f, { roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  if (kind === 'carrot') {
    // Orange shoulders poking out of the soil under a big leafy top.
    add(new THREE.CylinderGeometry(0.11, 0.07, 0.16, 10), std(0xf07a1e, { roughness: 0.6 }), 0, 0.06);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const f = add(new THREE.ConeGeometry(0.05, 0.38, 5), leaf, Math.cos(a) * 0.04, 0.3, Math.sin(a) * 0.04);
      f.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    }
  } else if (kind === 'cabbage') {
    const greens = [std(0x8ccf5e, { roughness: 0.55 }), std(0x6fb447, { roughness: 0.55 })];
    add(new THREE.SphereGeometry(0.26, 14, 10), std(0xb4e08a, { roughness: 0.5 }), 0, 0.22).scale.y = 0.9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = add(new THREE.SphereGeometry(0.22, 10, 8), greens[i % 2], Math.cos(a) * 0.22, 0.14, Math.sin(a) * 0.22);
      l.scale.set(1, 0.5, 0.5);
      l.rotation.set(0, -a, 0.6);
    }
  } else if (kind === 'tomato') {
    // A staked vine hung with red tomatoes.
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5), std(0x9a7448), 0, 0.4);
    for (let i = 0; i < 6; i++) {
      const a = i * 2.1, h = 0.15 + i * 0.09;
      add(new THREE.SphereGeometry(0.13, 8, 6), leaf, Math.cos(a) * 0.12, h + 0.05, Math.sin(a) * 0.12).scale.set(1, 0.5, 1);
      if (i % 2 === 0) add(new THREE.SphereGeometry(0.075, 10, 8), std(0xe0342a, { roughness: 0.35 }), Math.cos(a + 1) * 0.15, h, Math.sin(a + 1) * 0.15);
    }
  } else if (kind === 'pumpkin') {
    const orange = std(0xe8771e, { roughness: 0.55 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const lobe = add(new THREE.SphereGeometry(0.22, 12, 10), orange, Math.cos(a) * 0.16, 0.22, Math.sin(a) * 0.16);
      lobe.scale.set(0.75, 0.95, 0.75);
    }
    add(new THREE.CylinderGeometry(0.03, 0.045, 0.14, 6), std(0x5a6a2a), 0, 0.46);
    add(new THREE.SphereGeometry(0.2, 8, 6), leaf, 0.3, 0.05, 0.1).scale.set(1, 0.3, 1);
  } else if (kind === 'lettuce') {
    const greens = [std(0x8fd14f, { roughness: 0.55 }), std(0x6dbb3c, { roughness: 0.55 })];
    add(new THREE.SphereGeometry(0.22, 12, 10), std(0xb8e57a, { roughness: 0.55 }), 0, 0.19).scale.y = 0.85;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const l = add(new THREE.SphereGeometry(0.18, 10, 8), greens[i % 2], Math.cos(a) * 0.2, 0.13, Math.sin(a) * 0.2);
      l.scale.set(1, 0.6, 0.45);
      l.rotation.set(0, -a, 0.5);
    }
  } else {
    // Eggplant: glossy purple, lying in its leaves.
    const e = add(new THREE.CapsuleGeometry(0.1, 0.22, 6, 12), std(0x4a2462, { roughness: 0.25 }), 0, 0.12);
    e.rotation.z = Math.PI / 2 - 0.3;
    add(new THREE.ConeGeometry(0.08, 0.1, 6), leaf, 0.2, 0.18).rotation.z = -Math.PI / 2;
    for (const a of [0.5, 2.5, 4.4]) add(new THREE.SphereGeometry(0.17, 8, 6), leaf, Math.cos(a) * 0.2, 0.04, Math.sin(a) * 0.2).scale.set(1, 0.25, 0.6);
  }
  return g;
}
