import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BirdModel } from './bird-model.ts';
import { PigeonModel } from './pigeon-model.ts';
import {
  CAT_SEGMENTS, EMERGE_AT, FLY_AT, GATE_Y, LEAVES_NEEDED, MORPH_TIME, SHADOW_TIME, SPARKLES, SPECIAL_LEN, SPECIAL_Y, SWOOP_TIME,
  TREE_H, TRUNK_HALF, WRAP_TIME, type Food, type Tree,
} from './tree.ts';
import { WormModel } from './worm-model.ts';

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const CAT_Z = 0.35; // the caterpillar crawls on the front face of the bark

/**
 * Act four, side-on: a colossal tree, its branches thick with leaves and flowers,
 * and the caterpillar climbing it (the camera follows it up into the sky).
 */
export class TreeView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
  private built: Tree | null = null;
  private food = new Map<number, THREE.Object3D>();
  private caterpillar = new CaterpillarModel();
  private worm = new WormModel(0.48); // the big worm, popping out of the ground before it changes
  private sparkles: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number }[] = [];
  private sparkleGeo = new THREE.OctahedronGeometry(0.07);
  private sparkleMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
  private morphed = false;
  private camAt = new THREE.Vector3(0, 4, 0);
  private skyLow = new THREE.Color(0xa9d8e8);
  private skyHigh = new THREE.Color(0x5a9fe0);
  // The bird: its shadow on the tree, and the bird itself (in a holder, for side-on flight).
  private shadow: THREE.Mesh;
  private shadowRing: THREE.Mesh;
  private birdHolder = new THREE.Group();
  private bird: BirdModel;
  // Day and night (racing by during the metamorphosis).
  private hemi: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private sunDisc: THREE.Sprite;
  private moonDisc: THREE.Sprite;
  private stars: THREE.Points;
  // The sparkling branch's tip; the gate sign; the cocoon; the pigeon that comes out of it.
  private tipGlow: THREE.Sprite;
  private gateSign: THREE.Sprite;
  private cocoon = new THREE.Group();
  private cocoonHalves: THREE.Mesh[] = [];
  private thread: THREE.Mesh;
  private pigeon = new PigeonModel();
  private pigeonHolder = new THREE.Group();
  private pigeonFacing = 1;
  private cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x666666 });
  /** Streaks of wind, for the gust. */
  private wind: { mesh: THREE.Mesh; speed: number }[] = [];
  private windMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });

  constructor() {
    this.scene.background = new THREE.Color(0xa9d8e8);
    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x5a7040, 1.5);
    this.scene.add(this.hemi);
    const sun = (this.sunLight = new THREE.DirectionalLight(0xfff3dd, 2));
    sun.position.set(-6, 10, 10);
    this.scene.add(sun, this.caterpillar.root, this.worm.root);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0,
    }));
    this.shadow.visible = false;
    // A warning ring round its edge (a dark shadow alone hardly shows on dark bark).
    this.shadowRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, depthWrite: false }));
    this.shadow.add(this.shadowRing);
    this.scene.add(this.shadow);
    this.bird = new BirdModel(this.scene);
    this.birdHolder.add(this.bird.root);
    this.scene.add(this.birdHolder);
    // The sun and moon on their arcs, and stars for the night.
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#fff6c0', '#ffb030'), transparent: true, depthWrite: false, fog: false }));
    this.sunDisc.scale.setScalar(9);
    this.moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#f4f4ff', '#9aa8d0'), transparent: true, depthWrite: false }));
    this.moonDisc.scale.setScalar(6);
    const starPos: number[] = [];
    for (let i = 0; i < 500; i++) starPos.push((Math.random() - 0.5) * 220, Math.random() * 140 - 20, -80);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0, depthWrite: false }));
    this.scene.add(this.sunDisc, this.moonDisc, this.stars);
    // The sparkling tip's golden glow; the "100 leaves" sign at the gate.
    this.tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('rgba(255,240,160,0.9)', 'rgba(255,200,60,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.tipGlow.scale.setScalar(3);
    this.tipGlow.position.set(SPARKLES.x, SPARKLES.y, 0.5);
    this.gateSign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(`🍃 ${LEAVES_NEEDED} leaves`, 'to climb higher'), transparent: true }));
    this.gateSign.scale.set(3.2, 1.6, 1);
    this.gateSign.position.set(0, GATE_Y + 0.4, 0.3);
    this.scene.add(this.tipGlow, this.gateSign);
    // The cocoon: two silky halves (so it can split open), hanging by a thread.
    const silk = new THREE.MeshStandardMaterial({ map: silkTexture(), roughness: 0.5, side: THREE.DoubleSide });
    for (const half of [0, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16, half * Math.PI, Math.PI), silk);
      m.scale.set(1, 1.9, 1);
      this.cocoonHalves.push(m);
      this.cocoon.add(m);
    }
    this.thread = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 4), new THREE.MeshBasicMaterial({ color: 0xf4f0e0 }));
    this.cocoon.visible = this.thread.visible = false;
    this.pigeonHolder.add(this.pigeon.root);
    this.pigeonHolder.visible = false;
    this.scene.add(this.cocoon, this.thread, this.pigeonHolder);
  }

  private build(t: Tree): void {
    this.built = t;
    const bark = std(0x6b4a2e, { map: barkTexture() });
    // The trunk: a great wide column, flaring at the roots.
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(TRUNK_HALF * 2, TREE_H + 6, 1.6), bark);
    trunk.position.set(0, (TREE_H + 6) / 2, -0.8);
    this.scene.add(trunk);
    for (const side of [-1, 1]) {
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.6, 2.4, 6), bark);
      root.position.set(side * (TRUNK_HALF + 0.4), 0.9, -0.8);
      root.rotation.z = side * 0.55;
      this.scene.add(root);
    }
    // Branches, tapering out from the trunk, each with lush clumps of foliage behind.
    const leafy = [std(0x4f9a2f, { roughness: 0.7 }), std(0x5fb03a, { roughness: 0.7 }), std(0x3f8a2a, { roughness: 0.7 })];
    const clumps: THREE.BufferGeometry[][] = [[], [], []];
    t.branches.forEach((b, i) => {
      const len = b.x1 - b.x0, thick = b.y1 - b.y0;
      const out = b.x0 < 0 ? -1 : 1; // which way it grows
      const g = new THREE.CylinderGeometry(thick * 0.32, thick * 0.55, len, 8).rotateZ(Math.PI / 2);
      if (out < 0) g.rotateY(Math.PI);
      const branch = new THREE.Mesh(g, bark);
      branch.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -0.15);
      branch.scale.set(1, 1, 1.6);
      this.scene.add(branch);
      // Foliage: blobs along the outer half and around the tip, behind the branch.
      for (let k = 0; k < 7; k++) {
        const f = 0.45 + k * 0.09;
        const x = out > 0 ? b.x0 + len * f : b.x1 - len * f;
        const r = 0.7 + ((i * 7 + k * 3) % 5) * 0.18;
        const blob = new THREE.IcosahedronGeometry(r, 1);
        blob.translate(x, (b.y0 + b.y1) / 2 + ((k % 3) - 1) * 0.6, -0.9 - (k % 2) * 0.4);
        clumps[(i + k) % 3].push(blob);
      }
    });
    clumps.forEach((geos, i) => {
      if (geos.length) this.scene.add(new THREE.Mesh(mergeGeometries(geos), leafy[i]));
    });
    // The special branch at the very top, reaching out to its sparkles.
    const special = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, SPECIAL_LEN + 0.3, 8).rotateZ(Math.PI / 2), bark);
    special.position.set(TRUNK_HALF + SPECIAL_LEN / 2, SPECIAL_Y, -0.15);
    special.scale.set(1, 1, 1.6);
    this.scene.add(special);
    // The canopy, crowning the top.
    const canopy: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const blob = new THREE.IcosahedronGeometry(2 + (i % 4) * 0.6, 1);
      blob.translate(Math.cos(a) * (6 + (i % 3) * 3), TREE_H + 4 + Math.sin(a) * 3.5 + (i % 5), -2 - (i % 3));
      canopy.push(blob);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(canopy), leafy[1]));
    // The ground: a strip of grass, with the hole the worm came up through.
    const grass = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 6), std(0x5fa83e));
    grass.position.set(0, -0.5, -1);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(200, 6, 6), std(0x5a3c22));
    soil.position.set(0, -4, -1);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a1a0c }));
    hole.position.set(0, 0.01, 0.6);
    this.scene.add(grass, soil, hole);
    // Hills and clouds in the distance.
    for (let i = 0; i < 6; i++) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(18 + i * 4, 16, 8), std(i % 2 ? 0x8cc06a : 0x7ab25a));
      hill.position.set(-60 + i * 25, -12, -40 - i * 4);
      this.scene.add(hill);
    }
    const cloud = this.cloudMat;
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2 + (k % 3) * 0.5, 10, 8), cloud);
        puff.position.set(k * 1.3 - 2.6, Math.sin(k * 1.7) * 0.5, 0);
        c.add(puff);
      }
      c.position.set(((i * 37) % 70) - 35, 14 + i * 3.6, -14 - (i % 4) * 5);
      this.scene.add(c);
    }
    // Leaves and flowers to eat.
    for (const f of t.food) {
      const m = f.kind === 'leaf' ? leafMesh(f) : flowerMesh(f);
      m.position.set(f.x, f.y, 0.15);
      this.scene.add(m);
      this.food.set(f.id, m);
    }
  }

  render(renderer: THREE.WebGLRenderer, t: Tree, dt: number, time: number): void {
    if (this.built !== t) this.build(t);
    // Eaten food pops away; regrown food pops back.
    for (const f of t.food) {
      const m = this.food.get(f.id)!;
      if (f.eaten && m.visible) {
        m.scale.multiplyScalar(Math.max(0, 1 - dt * 10));
        if (m.scale.x < 0.05) m.visible = false;
      } else if (!f.eaten && m.scale.x < (m.userData.size as number)) {
        m.visible = true;
        m.scale.setScalar(Math.min(m.userData.size as number, Math.max(0.05, m.scale.x) * (1 + dt * 6)));
      }
    }
    // Sparkles at the tip of the special branch; the gate sign until it's big enough.
    if (Math.random() < dt * 14) this.sparkle(new THREE.Vector3(SPARKLES.x + (Math.random() - 0.5) * 1.2, SPARKLES.y + (Math.random() - 0.5) * 1, 0.5), 0.6);
    (this.tipGlow.material as THREE.SpriteMaterial).opacity = t.won ? 0 : 0.6 + Math.sin(time * 4) * 0.3;
    this.gateSign.visible = t.eaten < LEAVES_NEEDED;
    // First the big worm pokes out of the ground and — poof — becomes a caterpillar.
    const morphing = t.t < MORPH_TIME;
    this.worm.root.visible = morphing;
    this.caterpillar.root.visible = !morphing;
    if (morphing) {
      const rise = Math.min(1, t.t / 0.8);
      const pts = Array.from({ length: 16 }, (_, i) => new THREE.Vector3(Math.sin(time * 6 + i * 0.5) * 0.12, rise * 2.6 - i * 0.34, CAT_Z));
      this.worm.pose(pts, time, true, new THREE.Vector3(0, 0, 1));
    } else if (!this.morphed) {
      this.morphed = true;
      for (let i = 0; i < 50; i++) this.sparkle(new THREE.Vector3(t.head.x, t.head.y + 1, CAT_Z), 4);
    }
    if (!morphing) this.caterpillar.update(t, time);
    this.updateMetamorphosis(t, dt, time);
    this.updateBird(t, time);
    for (const s of this.sparkles) {
      s.age += dt;
      s.vel.y -= 3 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0, 1 - s.age));
    }
    this.sparkles = this.sparkles.filter((s) => (s.age < 1 ? true : (s.mesh.removeFromParent(), false)));
    if (t.won && Math.random() < dt * 25) this.sparkle(new THREE.Vector3(t.head.x + (Math.random() - 0.5) * 6, t.head.y + 3, CAT_Z), 1.5);
    this.updateSky(t);
    // Camera: follows the caterpillar up the tree.
    const canvas = renderer.domElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    const viewH = t.won ? 10 : 12 + (t.size() - 1) * 2;
    const dist = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // (During the metamorphosis: the cocoon, then the pigeon.)
    const focus = !t.won ? { x: t.head.x * 0.6, y: t.head.y + 1.5 } : t.emerged ? { x: t.fly.x, y: t.fly.y } : { x: SPARKLES.x - 1, y: SPARKLES.y - 0.5 };
    const target = new THREE.Vector3(focus.x, Math.max(viewH / 2 - 1.5, focus.y), 0);
    this.camAt.lerp(target, 1 - Math.exp(-dt * 3));
    this.camera.position.set(this.camAt.x, this.camAt.y, dist);
    this.camera.lookAt(this.camAt);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  /** The bird: shadow darkening on the bark, the bird circling above, then the swoop. */
  private updateBird(t: Tree, time: number): void {
    const b = t.bird;
    this.shadow.visible = this.birdHolder.visible = !!b;
    if (!b) return;
    const mat = this.shadow.material as THREE.MeshBasicMaterial;
    this.bird.update({ phase: 'carrying', t: 0, x: 0, y: 0, mash: 0 }, { x: 0, y: 0 }, time); // (flaps its wings)
    this.bird.root.position.set(0, 0, 0);
    this.bird.root.rotation.set(0, -Math.PI / 2, 0); // facing +x
    let pitch = 0;
    if (b.phase === 'shadow') {
      // The shadow darkens and tightens as it nears; the bird wheels overhead.
      const k = b.t / SHADOW_TIME;
      mat.opacity = 0.35 + 0.45 * k;
      (this.shadowRing.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(time * (5 + k * 12)));
      this.shadow.scale.setScalar(b.r * (1.25 - 0.25 * k));
      this.birdHolder.position.set(b.x + Math.sin(time * 1.4) * 4, b.y + 6.5 - k * 1.5, 1.5);
      this.birdHolder.scale.setScalar(0.6 + 0.3 * k);
      pitch = Math.sin(time * 1.4 + 1.57) * 0.25;
    } else {
      // The swoop: down through the shadow, and away (with the caterpillar, if it's still there).
      const k = Math.min(1, b.t / SWOOP_TIME);
      mat.opacity = 0.8 * (1 - k);
      (this.shadowRing.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      const from = new THREE.Vector3(b.x - 7, b.y + 6, 1.5), at = new THREE.Vector3(b.x, b.y + 0.4, 1.2), to = new THREE.Vector3(b.x + 9, b.y + 7, 1.5);
      this.birdHolder.position.copy(k < 0.4 ? from.lerp(at, k / 0.4) : at.lerp(to, (k - 0.4) / 0.6));
      this.birdHolder.scale.setScalar(1);
      pitch = k < 0.4 ? -0.6 : 0.5;
    }
    this.birdHolder.rotation.z = pitch;
    this.shadow.position.set(b.x, b.y, 0.2);
    // Snatched: dangling from the talons as it flies away.
    if (b.caught && b.phase === 'swoop' && b.t > SWOOP_TIME * 0.4) this.caterpillar.carriedFrom(this.birdHolder.position, time);
  }

  /** Day, sunset, night, sunrise: the sky, the sun and moon, the stars and the light all follow the sun round. */
  private updateSky(t: Tree): void {
    const a = t.sunAngle();
    const height = Math.sin(a); // 1 at noon, 0 at the horizon, -1 at midnight
    const day = THREE.MathUtils.clamp(height * 1.8 + 0.35, 0, 1);
    const glow = Math.exp(-height * height * 14); // the warm colours, near the horizon
    const sky = new THREE.Color(0x0a1030).lerp(this.skyLow.clone().lerp(this.skyHigh, t.progress()), day);
    sky.lerp(new THREE.Color(0xff8a4a), glow * 0.55);
    (this.scene.background as THREE.Color).copy(sky);
    this.hemi.intensity = 0.35 + 1.15 * day;
    this.sunLight.intensity = 0.2 + 1.8 * day;
    this.sunLight.color.setHex(0xfff3dd).lerp(new THREE.Color(0xff9a50), glow);
    // Sun and moon arc across behind the tree, around wherever the camera is.
    const c = this.camAt;
    this.sunDisc.position.set(c.x + Math.cos(a) * 34, c.y - 6 + height * 22, -60);
    this.moonDisc.position.set(c.x - Math.cos(a) * 34, c.y - 6 - height * 22, -62);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - day * 1.6);
    // The sun sinks out of sight at night, the moon by day; clouds dim in the dark.
    (this.sunDisc.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp(height * 5 + 0.7, 0, 1);
    (this.moonDisc.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp(-height * 5 + 0.3, 0, 1);
    this.cloudMat.emissive.setScalar(0.08 + 0.32 * day);
    this.cloudMat.color.setScalar(0.35 + 0.65 * day);
    this.stars.position.set(c.x, c.y - 30, 0);
  }

  /** The cocoon (wrapping, swelling night by night, splitting) and — of all things — the pigeon that comes out. */
  private updateMetamorphosis(t: Tree, dt: number, time: number): void {
    const hangX = SPARKLES.x, hangY = SPARKLES.y - 0.35;
    const k = t.won ? Math.min(1, t.wonT / WRAP_TIME) : 0;
    const splitting = t.won && t.wonT >= EMERGE_AT;
    const split = splitting ? Math.min(1, (t.wonT - EMERGE_AT) / 0.8) : 0;
    this.cocoon.visible = this.thread.visible = t.won && split < 1;
    this.caterpillar.root.visible = this.caterpillar.root.visible && (!t.won || k < 1);
    if (t.won && k < 1) this.caterpillar.wrapUp(new THREE.Vector3(hangX, hangY - 1, 0.35), k, time);
    if (this.cocoon.visible) {
      const size = (0.4 + 0.6 * k) * (1 + 0.12 * Math.min(4, t.nights()));
      const len = 1.05 * size * 1.9;
      this.cocoon.position.set(hangX, hangY - 0.35 - len / 2, 0.35);
      this.cocoon.scale.setScalar(size);
      // An occasional twitch from inside.
      this.cocoon.rotation.z = Math.sin(time * 2.3) * 0.06 + (Math.sin(time * 9) > 0.97 ? 0.15 : 0);
      // Splitting open down the middle.
      this.cocoonHalves.forEach((h, i) => {
        h.rotation.y = (i ? 1 : -1) * split * 1.4;
        h.position.x = (i ? 1 : -1) * split * 0.4;
      });
      this.thread.position.set(hangX, hangY - 0.17, 0.35);
      this.thread.scale.y = 0.35;
    }
    if (splitting && Math.random() < dt * 20) this.sparkle(new THREE.Vector3(t.fly.x, t.fly.y, 0.6), 1.5);
    // The pigeon: popping out (growing to full size), then flapping wherever it's steered, facing its way.
    this.pigeonHolder.visible = splitting;
    if (splitting) {
      const unfold = Math.min(1, (t.wonT - EMERGE_AT) / (FLY_AT - EMERGE_AT));
      const dx = t.fly.x - this.pigeonHolder.position.x;
      if (Math.abs(dx) > 0.01 && !t.gusting) this.pigeonFacing = Math.sign(dx);
      this.pigeon.update(time, t.moving || t.gusting || unfold < 1);
      this.pigeonHolder.position.set(t.fly.x, t.fly.y + Math.sin(time * 3) * 0.12 * unfold, 0.6);
      this.pigeonHolder.scale.set(1.3 * (0.4 + 0.6 * unfold) * this.pigeonFacing, 1.3 * (0.4 + 0.6 * unfold), 1.3 * (0.4 + 0.6 * unfold));
      // Turned three-quarters to the camera, so you can see its dopey face; tumbling head over heels in the gust.
      this.pigeonHolder.rotation.set(0, -0.6 * this.pigeonFacing, t.gusting ? (t.wonT - t.gustAt) * 9 : 0);
    }
    // The gust: streaks of wind tearing across the sky.
    if (t.gusting && Math.random() < dt * 60) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3 + Math.random() * 5, 0.06), this.windMat);
      m.position.set(this.camAt.x - 18, this.camAt.y + (Math.random() - 0.5) * 12, 1 + Math.random());
      this.scene.add(m);
      this.wind.push({ mesh: m, speed: 40 + Math.random() * 30 });
    }
    for (const w of this.wind) w.mesh.position.x += w.speed * dt;
    this.wind = this.wind.filter((w) => (w.mesh.position.x < this.camAt.x + 25 ? true : (w.mesh.removeFromParent(), w.mesh.geometry.dispose(), false)));
  }

  private sparkle(at: THREE.Vector3, speed: number): void {
    const mesh = new THREE.Mesh(this.sparkleGeo, this.sparkleMat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, (Math.random() - 0.5) * 0.3).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    this.sparkles.push({ mesh, vel, age: 0 });
  }
}

/** Colour stages, plain to fabulous: the colours of its segments (cycled) and its spots. */
const STAGES: { body: number[]; spots: number | null }[] = [
  { body: [0x7ccf4a, 0x6cbf3e], spots: null }, // plain green
  { body: [0x7ccf4a, 0xffd23f], spots: null }, // + yellow bands
  { body: [0x7ccf4a, 0xffd23f, 0x1a1a1a], spots: null }, // + black stripes (a monarch!)
  { body: [0x7ccf4a, 0xffd23f, 0x1a1a1a], spots: 0xff7a1a }, // + orange spots
  { body: [0x3fa0ff, 0x8a5aff, 0xffd23f, 0x1a1a1a], spots: 0xff4fa0 }, // blues and violets
  { body: [0xff4f4f, 0xff9f3f, 0xffe04f, 0x5fdf5f, 0x4fb0ff, 0xa06fff], spots: 0xffffff }, // rainbow
];

/** A plump caterpillar: round segments with little feet, a big round head, antennae. */
class CaterpillarModel {
  readonly root = new THREE.Group();
  private segs: THREE.Mesh[] = [];
  private spots: THREE.Mesh[] = [];
  private head: THREE.Group;
  private stage = -1;

  constructor() {
    const geo = new THREE.SphereGeometry(0.22, 14, 10);
    const foot = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    for (let i = 0; i < CAT_SEGMENTS; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x7ccf4a, roughness: 0.45, clearcoat: 0.6 }));
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), foot);
        f.position.set(0, -0.17, side * 0.12);
        m.add(f);
      }
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff7a1a }));
      spot.position.set(0, 0.12, 0.17);
      spot.visible = false;
      m.add(spot);
      this.spots.push(spot);
      this.segs.push(m);
      this.root.add(m);
    }
    // The head: bigger, with a cheerful face and two antennae.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0x5fae3a, roughness: 0.4, clearcoat: 0.6 }));
    this.head.add(skull);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      eye.position.set(0.13, 0.08, side * 0.13 + 0.12);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      pupil.position.set(0.18, 0.08, side * 0.13 + 0.15);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
      stalk.position.set(0.05, 0.38, side * 0.12);
      stalk.rotation.z = -0.3;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff4fa0 }));
      tip.position.set(0.1, 0.55, side * 0.12);
      this.head.add(eye, pupil, stalk, tip);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a1a1a }));
    smile.rotation.z = Math.PI;
    smile.position.set(0.2, -0.08, 0.2);
    this.head.add(smile);
    this.root.add(this.head);
  }

  /** Curling up into a ball as the cocoon wraps round it (k: 0 → 1). */
  wrapUp(at: THREE.Vector3, k: number, time: number): void {
    this.segs.forEach((m, i) => {
      const a = i * 0.55 + time * 2;
      const r = 0.5 * (1 - k);
      m.position.lerp(new THREE.Vector3(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, at.z), Math.min(1, k * 1.5));
      m.scale.multiplyScalar(1 - k * 0.5);
    });
    this.head.position.lerp(at, Math.min(1, k * 1.5));
  }

  /** Dangling below a point (the bird's talons), wriggling. */
  carriedFrom(at: THREE.Vector3, time: number): void {
    const step = this.segs[0].scale.x * 0.22; // about a segment's width apart
    this.segs.forEach((m, i) => m.position.set(at.x + Math.sin(time * 10 + i * 0.6) * 0.03 * i, at.y - 0.9 - i * step, at.z));
    this.head.position.set(at.x, at.y - 0.7, at.z + 0.05);
    this.head.rotation.set(0, 0, Math.PI / 2);
  }

  update(t: Tree, time: number): void {
    const size = t.size();
    const stage = t.colorStage();
    if (stage !== this.stage) {
      this.stage = stage;
      const s = STAGES[stage];
      this.segs.forEach((m, i) => (m.material as THREE.MeshPhysicalMaterial).color.setHex(s.body[i % s.body.length]));
      this.spots.forEach((sp, i) => {
        sp.visible = s.spots !== null && i % 2 === 0;
        if (s.spots !== null) (sp.material as THREE.MeshStandardMaterial).color.setHex(s.spots);
      });
    }
    const pts = t.segments();
    this.segs.forEach((m, i) => {
      const p = pts[i];
      // The classic caterpillar ripple: segments humping up one after another.
      const hump = t.moving ? Math.max(0, Math.sin(time * 9 - i * 0.7)) * 0.12 * size : 0;
      m.position.set(p.x, p.y, CAT_Z * size + hump);
      m.scale.setScalar(size * (i === 0 ? 0.9 : 1 - i / (CAT_SEGMENTS * 3)));
    });
    // Head just ahead of the first segment, facing the way it's going.
    const a = pts[0], b = pts[1];
    const dir = Math.atan2(a.y - b.y, a.x - b.x || 1e-6);
    this.head.position.set(a.x + Math.cos(dir) * 0.25 * size, a.y + Math.sin(dir) * 0.25 * size, CAT_Z * size + 0.05);
    this.head.rotation.set(0, 0, dir);
    this.head.scale.setScalar(size);
    if (t.won) this.head.position.y += Math.abs(Math.sin(time * 6)) * 0.2; // bouncing for joy
  }
}

function leafMesh(f: Food): THREE.Object3D {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.18, 0.12, 0.2, 0.38, 0, 0.55);
  s.bezierCurveTo(-0.2, 0.38, -0.18, 0.12, 0, 0);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s, 8), new THREE.MeshStandardMaterial({
    color: [0x5fbf3a, 0x4faa30, 0x7ad04a][f.id % 3], side: THREE.DoubleSide, roughness: 0.6,
  }));
  m.rotation.z = f.angle - Math.PI / 2;
  m.scale.setScalar(1.3);
  m.userData.size = 1.3;
  return m;
}

function flowerMesh(f: Food): THREE.Object3D {
  const g = new THREE.Group();
  const petal = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), petal);
    p.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0);
    g.add(p);
  }
  const centre = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), new THREE.MeshStandardMaterial({ color: 0xffb020 }));
  centre.position.z = 0.01;
  g.add(centre);
  g.scale.setScalar(1.4);
  g.userData.size = 1.4;
  return g;
}

/** Rough bark: vertical ridges and furrows. */
function barkTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#6b4a2e';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 40; i++) {
    let x = Math.random() * c.width;
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(40,24,12,0.55)' : 'rgba(140,100,70,0.35)';
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= c.height; y += 16) {
      x += (Math.random() - 0.5) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 12);
  return t;
}

/** A soft-edged round shadow. */
function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.8)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A glowing disc (sun, moon, glow), bright in the middle, fading at the edge. */
function discTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, inner);
  g.addColorStop(0.55, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A little wooden sign. */
function signTexture(line1: string, line2: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c89a5a';
  ctx.strokeStyle = '#6b4a2e';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b2610';
  ctx.textAlign = 'center';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillText(line1, 128, 58);
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillText(line2, 128, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Silk, wound round and round. */
function silkTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8dcae';
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,250,230' : '170,150,90'},${0.3 + Math.random() * 0.4})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(40, y - 20, 90, y + 20, 128, y + (Math.random() - 0.5) * 30);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

