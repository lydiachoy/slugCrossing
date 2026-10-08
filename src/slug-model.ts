import * as THREE from 'three';
import { shellMesh } from './garden-view.ts';
import { MUNCH_TIME, type Dir } from './sim.ts';

/** Slug colours: 0 is the player's banana slug, 1–3 the rivals. */
export const SLUG_PALETTE = [
  { body: 0xe3c13b, foot: 0xc9a52a, spots: 0x3d2c14, dry: 0x9a8a5a }, // banana slug
  { body: 0x9c978b, foot: 0x7d786d, spots: 0x2a2724, dry: 0x8a8478 }, // leopard slug
  { body: 0xe0702a, foot: 0xb85a20, spots: 0x6a2c0c, dry: 0x9a6a4a }, // red-orange roundback
  { body: 0x333036, foot: 0x222024, spots: 0x0c0c0c, dry: 0x5a5650 }, // black slug
];
/** Once it's a snail: soft grey-tan skin under the golden shell. */
const SNAIL_COLORS = { body: 0xb9a68a, foot: 0x9c8a70, spots: 0x6a5a48, dry: 0x8a7a64 };
export const SLUG_SCALE = 1.35; // drawn a little larger than its hit box, to read at a distance

const YAW: Record<Dir, number> = { up: 0, left: Math.PI / 2, down: Math.PI, right: -Math.PI / 2 };
const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

export interface SlugPose {
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  mode: 'hidden' | 'crawl' | 'squished' | 'dried' | 'salted' | 'munch' | 'flung' | 'carried' | 'cheer';
  /** Seconds into the current mode (dying / munching). */
  t: number;
  moisture: number;
  /** Height off the ground (when flung). */
  z?: number;
  /** Chewing on something as it goes (in the garden). */
  chewing?: boolean;
}

/** A slug: glossy body, mantle hump, spots, eye stalks and a mouth. Head points -z. */
export class SlugModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private mat: THREE.MeshPhysicalMaterial;
  private stalks: THREE.Group[] = [];
  private mouth: THREE.Mesh;
  private yaw = 0;
  private colors: (typeof SLUG_PALETTE)[number];
  private slugColors: (typeof SLUG_PALETTE)[number];
  private footMat: THREE.MeshStandardMaterial;
  /** Slug-only parts (mantle hump, spots), hidden on a snail. */
  private slugBits: THREE.Object3D[] = [];
  private tube: THREE.Mesh;
  /** The golden shell, once it's a snail. */
  private shell: THREE.Group | null = null;

  constructor(palette: number, scale = SLUG_SCALE) {
    this.colors = this.slugColors = SLUG_PALETTE[palette];
    this.mat = new THREE.MeshPhysicalMaterial({ color: this.colors.body, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.15 });
    const body = this.body;
    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 6, 16).rotateX(Math.PI / 2), this.mat);
    tube.scale.set(1, 0.72, 1);
    tube.position.y = 0.12;
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), this.mat);
    mantle.scale.set(0.95, 0.75, 1.3);
    mantle.position.set(0, 0.17, -0.12);
    this.footMat = std(this.colors.foot, { roughness: 0.4 });
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.5, 4, 16).rotateX(Math.PI / 2), this.footMat);
    foot.scale.set(1, 0.25, 1.02);
    foot.position.y = 0.04;
    body.add(tube, mantle, foot);
    this.tube = tube;
    this.slugBits.push(mantle);
    const spots = std(this.colors.spots, { roughness: 0.4 });
    for (const [x, z, r] of [[0.08, 0.05, 0.022], [-0.1, 0.15, 0.03], [0.05, 0.3, 0.025], [-0.04, -0.1, 0.02], [0.1, -0.2, 0.018]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), spots);
      s.position.set(x, 0.2, z);
      s.scale.y = 0.4;
      body.add(s);
      this.slugBits.push(s);
    }
    const eye = std(0x111111, { roughness: 0.2 });
    for (const side of [-1, 1]) {
      const stalk = new THREE.Group();
      stalk.position.set(side * 0.06, 0.2, -0.36);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.24, 6), this.mat);
      stem.position.y = 0.12;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), eye);
      ball.position.y = 0.25;
      stalk.add(stem, ball);
      stalk.rotation.set(-0.5, 0, side * 0.25);
      body.add(stalk);
      this.stalks.push(stalk);
      const feeler = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.09, 5), this.mat);
      feeler.position.set(side * 0.08, 0.1, -0.43);
      feeler.rotation.set(-1.1, 0, side * 0.4);
      body.add(feeler);
    }
    // The mouth: a dark gape under the feelers, shut unless it's eating.
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), std(0x4a0e1c, { roughness: 0.5 }));
    this.mouth.position.set(0, 0.075, -0.4);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std(0xe0607a, { roughness: 0.5 }));
    tongue.position.set(0, -0.035, -0.035); // resting on the floor of the mouth
    tongue.scale.set(1, 0.45, 0.9);
    this.mouth.add(tongue);
    body.add(this.mouth);
    body.traverse((o) => (o.castShadow = true));
    this.root.add(body);
    this.root.scale.setScalar(scale);
  }

  /** Turn it into a snail (or back): golden shell on its back, snail skin, longer neck and eye stalks. */
  setShell(on: boolean): void {
    if (on && !this.shell) {
      const coil = shellMesh();
      // Coiled side-on, like a real snail's, spun so the opening faces down onto the body
      // (the coil ends 0.3 of a turn round, i.e. 108°; turn that to point straight down).
      coil.rotation.set(0, Math.PI / 2, -THREE.MathUtils.degToRad(108 + 90));
      this.shell = new THREE.Group();
      this.shell.add(coil);
      this.shell.rotation.z = 0.35; // tipped a little towards the camera so the spiral shows from above
      this.shell.position.set(0, 0.38, 0.08);
      this.shell.scale.setScalar(1.55);
      this.body.add(this.shell);
    }
    if (!this.shell) return;
    if (this.shell.visible === on && this.colors === (on ? SNAIL_COLORS : this.slugColors)) return;
    this.shell.visible = on;
    this.colors = on ? SNAIL_COLORS : this.slugColors;
    this.footMat.color.setHex(this.colors.foot);
    for (const o of this.slugBits) o.visible = !on;
    this.tube.scale.set(on ? 0.9 : 1, 0.72, on ? 1.18 : 1); // a slimmer, longer body: neck out front, tail behind
    for (const st of this.stalks) st.scale.set(1, on ? 1.45 : 1, 1); // tall eye stalks
  }

  update(p: SlugPose, dt: number, time: number): void {
    this.root.visible = p.mode !== 'hidden';
    if (!this.root.visible) return;
    this.root.position.set(p.x, p.z ?? 0, -p.y);
    this.root.rotation.set(0, 0, 0);
    let d = YAW[p.facing] - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * (p.mode === 'munch' ? 14 : 10));
    this.root.rotation.y = this.yaw;
    if (p.mode === 'flung') {
      // Tumbling head over tail as it sails away.
      this.root.rotation.x = p.t * 17;
      this.root.rotation.z = p.t * 11;
    } else if (p.mode === 'carried') {
      // Dangling from the talons, wriggling for dear life.
      this.root.rotation.x = -0.5 + Math.sin(time * 13) * 0.35;
      this.root.rotation.z = Math.sin(time * 9) * 0.5;
    }

    const b = this.body;
    const color = this.mat.color;
    b.rotation.x = 0;
    b.position.y = 0;
    this.mouth.scale.set(1, 0.05, 0.5);
    this.mouth.visible = false;
    color.setHex(this.colors.body);
    if (p.mode === 'squished') {
      const damp = (a: number, to: number) => THREE.MathUtils.damp(a, to, 30, dt);
      b.scale.set(damp(b.scale.x, 1.9), damp(b.scale.y, 0.12), damp(b.scale.z, 1.4));
    } else if (p.mode === 'dried' || p.mode === 'salted') {
      // Shrivels up: salt does it fast and leaves it crusty and pale.
      const salted = p.mode === 'salted';
      const k = Math.min(1, p.t / (salted ? 0.5 : 1.2));
      const wobble = salted ? Math.sin(p.t * 40) * 0.05 * (1 - k) : 0;
      b.scale.set(1 - 0.4 * k + wobble, 1 - 0.5 * k, 1 - 0.38 * k - wobble);
      color.lerp(new THREE.Color(salted ? 0xd9d2bf : 0x6d5a3a), k);
      this.mat.clearcoat = 1 - k;
      for (const st of this.stalks) st.rotation.x = -0.5 + 1.4 * k;
    } else if (p.mode === 'carried') {
      const wriggle = Math.sin(time * 18);
      b.scale.set(1 - wriggle * 0.12, 1 + wriggle * 0.1, 1 + wriggle * 0.18);
      this.stalks.forEach((st, i) => {
        st.rotation.x = -1 + Math.sin(time * 20 + i * 2) * 0.6;
        st.rotation.z = (i ? 1 : -1) * (0.6 + Math.sin(time * 15 + i) * 0.3);
      });
      this.mouth.visible = true; // screaming
      this.mouth.scale.set(1, 0.7 + Math.abs(wriggle) * 0.3, 0.55);
    } else if (p.mode === 'cheer') {
      // Champion: reared up proud, beaming, eye stalks waving, bouncing for joy.
      const up = Math.min(1, p.t / 0.4);
      b.rotation.x = 0.7 * up;
      b.position.y = 0.06 * up + Math.abs(Math.sin(time * 6)) * 0.05;
      this.mouth.visible = true;
      this.mouth.scale.set(1.4, 0.45, 0.55); // a big grin
      this.stalks.forEach((st, i) => {
        st.rotation.x = -0.1 + Math.sin(time * 8 + i * 2) * 0.3;
        st.rotation.z = (i ? 1 : -1) * (0.55 + Math.sin(time * 7 + i) * 0.25);
      });
      this.mat.clearcoat = 1;
    } else if (p.mode === 'munch') {
      // Rear up to face the camera, mouth chomping away, eyes waggling with joy.
      const up = Math.min(1, p.t / 0.25) * Math.min(1, (MUNCH_TIME - p.t) / 0.3);
      b.rotation.x = 0.75 * up;
      b.position.y = 0.06 * up + Math.abs(Math.sin(p.t * 10)) * 0.03 * up;
      const chomp = Math.abs(Math.sin(p.t * 10));
      this.mouth.visible = true;
      this.mouth.scale.set(1.1 + 0.2 * chomp, 0.1 + 0.95 * chomp * up, 0.55);
      b.scale.set(1 + chomp * 0.05, 1 - chomp * 0.04, 1);
      this.stalks.forEach((st, i) => {
        st.rotation.x = -0.2 + Math.sin(time * 14 + i * 2) * 0.35;
        st.rotation.z = (i ? 1 : -1) * (0.45 + Math.sin(time * 9 + i) * 0.2);
      });
      this.mat.clearcoat = 1;
    } else {
      // Crawling: a ripple of stretch and squash along the body.
      const crawl = p.moving ? Math.sin(time * 5.5) * 0.07 : Math.sin(time * 1.5) * 0.015;
      b.scale.set(1 - crawl * 0.4, 1 - crawl * 0.6, 1 + crawl);
      if (p.chewing) {
        const chomp = Math.abs(Math.sin(time * 11));
        this.mouth.visible = true;
        this.mouth.scale.set(1.1, 0.1 + 0.8 * chomp, 0.55);
        b.rotation.x = 0.15 + chomp * 0.08;
      }
      // Drying out: the gloss goes dull and the colour fades.
      const dry = 1 - p.moisture / 100;
      color.lerp(new THREE.Color(this.colors.dry), dry * 0.8);
      this.mat.clearcoat = 1 - dry * 0.9;
      this.stalks.forEach((st, i) => {
        st.rotation.x = -0.5 + Math.sin(time * 3 + i * 1.7) * 0.15 + dry * 0.6;
        st.rotation.z = (i ? 1 : -1) * (0.25 + Math.sin(time * 2.3 + i) * 0.08);
      });
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** A ghostly slug soul with angel wings and a halo, floating up out of a squished slug. */
export class Ghost {
  readonly root = new THREE.Group();
  private age = 0;
  private mats: THREE.MeshBasicMaterial[] = [];
  private wings: THREE.Mesh[] = [];
  private startX: number;
  private startZ: number;
  private life: number;

  constructor(x: number, y: number, life: number) {
    this.startX = x;
    this.startZ = -y;
    this.life = life;
    const ghostly = (color: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      this.mats.push(m);
      return m;
    };
    const soul = ghostly(0xf2f8ff);
    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 6, 16).rotateX(Math.PI / 2), soul);
    tube.scale.set(1, 0.72, 1);
    tube.position.y = 0.12;
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), soul);
    mantle.scale.set(0.95, 0.75, 1.3);
    mantle.position.set(0, 0.17, -0.12);
    this.root.add(tube, mantle);
    // Wispy eye stalks with hollow dark eyes.
    const eyes = ghostly(0x56607a);
    for (const side of [-1, 1]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.22, 6), soul);
      stem.position.set(side * 0.07, 0.3, -0.38);
      stem.rotation.set(-0.5, 0, side * 0.3);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyes);
      eye.position.set(side * 0.11, 0.4, -0.45);
      this.root.add(stem, eye);
    }
    // Feathery angel wings off the mantle, flapping.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.bezierCurveTo(0.15, 0.25, 0.45, 0.35, 0.62, 0.22);
    wingShape.bezierCurveTo(0.52, 0.18, 0.55, 0.1, 0.5, 0.06);
    wingShape.bezierCurveTo(0.42, 0.04, 0.44, -0.03, 0.36, -0.05);
    wingShape.bezierCurveTo(0.28, -0.06, 0.26, -0.12, 0.18, -0.12);
    wingShape.bezierCurveTo(0.1, -0.12, 0.04, -0.06, 0, 0);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 12).rotateX(-Math.PI / 2);
    const feather = ghostly(0xffffff);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Mesh(wingGeo, feather);
      pivot.position.set(side * 0.12, 0.26, 0.02);
      pivot.scale.x = side;
      this.root.add(pivot);
      this.wings.push(pivot);
    }
    // Halo.
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.024, 8, 24), ghostly(0xffe27a));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.56, -0.3);
    this.root.add(halo);
    this.root.position.set(x, 0.1, -y);
    this.root.scale.setScalar(SLUG_SCALE);
  }

  /** Returns false once it has faded away. */
  update(dt: number): boolean {
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) {
      this.dispose();
      return false;
    }
    // Rise (quickly at first), sway, tilt heavenward, flap.
    this.root.position.y = 0.1 + 2.8 * (1 - Math.pow(1 - k, 2));
    this.root.position.x = this.startX + Math.sin(this.age * 4) * 0.18;
    this.root.position.z = this.startZ - 1.6 * k; // drifting off up the screen as it ascends
    this.root.rotation.set(0.45, Math.sin(this.age * 2.5) * 0.2, Math.sin(this.age * 4) * 0.12);
    this.root.scale.setScalar(SLUG_SCALE * (1 + 0.25 * k));
    const flap = Math.sin(this.age * 16);
    this.wings.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (0.35 + 0.55 * flap)));
    const opacity = Math.min(1, this.age / 0.2) * (k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55);
    for (const m of this.mats) m.opacity = 0.75 * opacity;
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    for (const m of this.mats) m.dispose();
  }
}
