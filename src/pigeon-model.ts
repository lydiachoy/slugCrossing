import * as THREE from 'three';

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

/**
 * A dopey city pigeon: plump and grey, a shimmering green-and-purple neck, a stubby
 * beak, orange feet, and big googly eyes that don't quite look the same way.
 * Faces +x, back up (+y); about 0.35 long.
 */
export class PigeonModel {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private wings: THREE.Group[] = [];
  private pupils: THREE.Mesh[] = [];

  constructor() {
    const grey = std(0x9aa0aa), dark = std(0x5a606a), pale = std(0xc4c8ce);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), grey);
    body.scale.set(1.25, 0.85, 0.9);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), pale);
    belly.scale.set(1.1, 0.7, 0.8);
    belly.position.y = -0.12;
    // The tail: dark-tipped feathers fanning out behind.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.45), dark);
    tail.position.set(-0.7, 0.05, 0);
    tail.rotation.z = 0.15;
    this.root.add(body, belly, tail);
    // The neck: iridescent.
    const neck = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshPhysicalMaterial({
      color: 0x4a7a6a, roughness: 0.3, metalness: 0.4, iridescence: 1, iridescenceIOR: 1.6, sheen: 1, sheenColor: new THREE.Color(0x9a4ac0),
    }));
    neck.position.set(0.45, 0.25, 0);
    this.root.add(neck);
    // The head: small and round, with a stubby beak and that white cere.
    this.head.position.set(0.68, 0.48, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), grey);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 8), std(0x3a3a3a));
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.28, -0.04, 0);
    const cere = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xf4f0e8));
    cere.position.set(0.2, 0.02, 0);
    this.head.add(skull, beak, cere);
    // Googly eyes — big, bulging, and pointing slightly different ways.
    const white = std(0xffffff, { roughness: 0.3 }), black = std(0x111111, { roughness: 0.1 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), white);
      eye.position.set(0.08, 0.08, side * 0.17);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), std(0xff7a1a));
      ring.position.copy(eye.position);
      ring.rotation.y = Math.PI / 2;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), black);
      this.pupils.push(pupil);
      this.head.add(eye, ring, pupil);
    }
    this.root.add(this.head);
    // Wings, hinged at the shoulders.
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(0.05, 0.2, side * 0.3);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.85), grey);
      wing.position.z = side * 0.42;
      const bars = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.055, 0.7), dark); // the two dark wing bars
      bars.position.set(-0.15, 0, side * 0.45);
      const bars2 = bars.clone();
      bars2.position.x = 0.05;
      const tips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.25), dark);
      tips.position.set(-0.15, 0, side * 0.92);
      hinge.add(wing, bars, bars2, tips);
      this.wings.push(hinge);
      this.root.add(hinge);
    }
    // Little orange feet, tucked up.
    const orange = std(0xff7a4a);
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.12), orange);
      foot.position.set(0.05, -0.45, side * 0.15);
      this.root.add(foot);
    }
    this.root.traverse((o) => (o.castShadow = true));
  }

  /** Flap (clumsily), bob the head, and roll those eyes. */
  /** `walking`: wings folded, waddling along on the ground. */
  update(time: number, flying: boolean, walking = false): void {
    const rate = flying ? 12 : 6;
    const flap = Math.sin(time * rate);
    this.wings.forEach((w, i) => (w.rotation.x = walking ? (i ? 1 : -1) * 1.35 + (i ? -1 : 1) * Math.abs(Math.sin(time * 6)) * 0.08 : (i ? 1 : -1) * (0.25 + flap * (flying ? 0.9 : 0.5))));
    // Pigeon head-bob: forward and back.
    this.head.position.x = 0.68 + Math.max(0, Math.sin(time * 7)) * 0.12;
    this.root.position.y = walking ? 0 : Math.sin(time * rate) * 0.06;
    this.root.rotation.x = walking && flying ? Math.sin(time * 12) * 0.18 : 0; // waddle
    // Each eye wanders on its own — dopey.
    this.pupils.forEach((p, i) => {
      const a = time * (i ? 1.3 : 0.8) + i * 2;
      const side = i ? 1 : -1;
      p.position.set(0.15 + Math.cos(a) * 0.02, 0.08 + Math.sin(a) * 0.05, side * (0.17 + 0.07));
    });
  }
}
