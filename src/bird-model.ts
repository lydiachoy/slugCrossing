import * as THREE from 'three';
import { BIRD_CARRY, BIRD_DIVE, type Bird } from './sim.ts';

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

const HOVER = 2.4; // how high the bird holds the slug up while it struggles
/** Where the bird comes from and goes to: high up, off the top right. */
const OFFSTAGE = new THREE.Vector3(7, 9, -5);

/** A big cartoon hawk: brown body, white head, hooked yellow beak, huge flapping wings. */
export class BirdModel {
  readonly root = new THREE.Group();
  private wings: THREE.Group[] = [];
  private head = new THREE.Group();
  private shadow: THREE.Mesh;
  /** Where the slug hangs, in world space (updated every frame). */
  readonly talons = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const brown = std(0x7a4a26), dark = std(0x4e2e16), white = std(0xf4efe4), yellow = std(0xf2b51c, { roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), brown);
    body.scale.set(0.8, 0.75, 1.35);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), std(0xd9c3a0));
    belly.scale.set(0.7, 0.6, 1.1);
    belly.position.set(0, -0.12, 0.05);
    this.root.add(body, belly);

    // Head with a fierce brow, glaring eyes and a hooked beak (faces -z).
    this.head.position.set(0, 0.32, -0.62);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), white);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 10), yellow);
    beak.rotation.x = -Math.PI / 2 - 0.5;
    beak.position.set(0, -0.06, -0.33);
    const eyeWhite = std(0xffffff, { roughness: 0.3 }), pupil = std(0x111111);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeWhite);
      eye.position.set(side * 0.13, 0.08, -0.22);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), pupil);
      p.position.set(side * 0.13, 0.08, -0.29);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.05), dark);
      brow.position.set(side * 0.13, 0.17, -0.25);
      brow.rotation.z = side * -0.45; // angry
      this.head.add(eye, p, brow);
    }
    this.head.add(skull, beak);
    this.root.add(this.head);

    // Wings: long feathered paddles from the shoulders.
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(side * 0.32, 0.15, -0.05);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.62), brown);
      inner.position.x = side * 0.45;
      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.5), dark);
      outer.position.set(side * 1.2, 0, 0.08);
      wing.add(inner, outer);
      for (let i = 0; i < 4; i++) {
        const feather = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.42), dark);
        feather.position.set(side * (1.45 + i * 0.1), 0, 0.12 + i * 0.07);
        feather.rotation.y = side * (0.2 + i * 0.12);
        wing.add(feather);
      }
      this.wings.push(wing);
      this.root.add(wing);
    }
    // Tail fan.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), dark);
    tail.position.set(0, 0.05, 0.75);
    this.root.add(tail);
    // Talons, reaching down.
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6), yellow);
      leg.position.set(side * 0.13, -0.5, 0.05);
      this.root.add(leg);
      for (const a of [-0.5, 0, 0.5]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), dark);
        claw.position.set(side * 0.13 + Math.sin(a) * 0.06, -0.72, 0.05 - Math.cos(a) * 0.06);
        claw.rotation.x = Math.PI;
        this.root.add(claw);
      }
    }
    this.root.traverse((o) => (o.castShadow = true));
    this.root.scale.setScalar(1.25);
    this.root.visible = false;
    scene.add(this.root);

    // Its shadow on the ground, growing as it dives.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.shadow.position.y = 0.02;
    this.shadow.scale.set(1, 1, 0.6);
    scene.add(this.shadow);
  }

  update(bird: Bird | null, slug: { x: number; y: number }, time: number): void {
    this.root.visible = !!bird;
    const shadowMat = this.shadow.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = 0;
    if (!bird) return;
    const over = new THREE.Vector3(slug.x, HOVER, -slug.y);
    const pos = new THREE.Vector3();
    let flapRate = 9, pitch = 0, flapSize = 0.8;
    if (bird.phase === 'diving') {
      // Swoop in on an arc from offstage, ending right over the slug.
      const k = Math.min(1, bird.t / BIRD_DIVE);
      const target = new THREE.Vector3(bird.x, 1.1, -bird.y);
      pos.copy(target).add(OFFSTAGE.clone().multiplyScalar(Math.pow(1 - k, 2)));
      pitch = 0.6 * (1 - k); // nose down, then pull up to grab
      flapSize = 0.25; // wings swept back in the dive
      flapRate = 4;
      shadowMat.opacity = 0.15 + 0.35 * k;
      this.shadow.position.set(bird.x, 0.02, -bird.y);
      this.shadow.scale.set(0.4 + 1.2 * k, 1, (0.4 + 1.2 * k) * 0.6);
    } else if (bird.phase === 'carrying') {
      // Hovering, flapping like mad, being wriggled at.
      pos.copy(over).add(new THREE.Vector3(Math.sin(time * 9) * 0.12 * bird.mash, Math.sin(time * 6) * 0.1, 0));
      flapRate = 16;
      flapSize = 1;
    } else if (bird.phase === 'dropping') {
      pos.copy(over);
      flapRate = 12;
      pitch = 0.2;
      if (bird.t > BIRD_CARRY - 0.1) pos.y += 0.2;
    } else {
      // Leaving: up and away, off the top of the screen.
      const k = Math.min(1, bird.t / 1.6);
      pos.set(bird.x, HOVER, -bird.y).add(OFFSTAGE.clone().multiplyScalar(k * k));
      pitch = -0.4;
      flapRate = 13;
    }
    this.root.position.copy(pos);
    this.root.rotation.set(pitch, Math.PI * 0.85, Math.sin(time * 3) * 0.08);
    const flap = Math.sin(time * flapRate) * flapSize;
    this.wings.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * flap * 0.9));
    this.head.rotation.x = bird.phase === 'carrying' ? Math.sin(time * 5) * 0.2 : 0;
    // The slug hangs under the talons, a little towards the camera so the bird doesn't hide it.
    this.talons.copy(pos).add(new THREE.Vector3(0, -1.1, 0.75));
  }
}
