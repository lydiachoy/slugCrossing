import * as THREE from 'three';
import { SEGMENTS } from './underground.ts';


/** A pink earthworm: a chain of ringed segments, a paler saddle near the front, and a face. */
export class WormModel {
  readonly root = new THREE.Group();
  private segs: THREE.Mesh[] = [];
  private head: THREE.Group;
  private mats: THREE.MeshPhysicalMaterial[] = [];
  private base: number[] = [];
  /** How plump it is (1 normally; 2 once it's eaten the banana). */
  thickness = 1;

  /** `radius` is the body's thickness (segments' radius). */
  constructor(radius = 0.13) {
    const SEG_R = radius;
    const pink = (color: number) => {
      // Opaque: underground, it must sort behind the (transparent, cut-out) dirt so solid dirt hides it.
      const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.3 });
      this.mats.push(m);
      return m;
    };
    const body = [pink(0xe58a8f), pink(0xd47479)];
    const saddle = pink(0xf2b0a8); // the clitellum
    const geo = new THREE.SphereGeometry(SEG_R, 14, 10);
    for (let i = 0; i < SEGMENTS; i++) {
      const m = new THREE.Mesh(geo, i >= 3 && i <= 5 ? saddle : body[i % 2]);
      // Plump at the front, tapering to the tail.
      const taper = i === 0 ? 1.05 : 1 - Math.max(0, i - 5) / (SEGMENTS * 1.6);
      m.scale.setScalar(taper * (i >= 3 && i <= 5 ? 1.12 : 1));
      this.base.push(m.scale.x);
      m.castShadow = true;
      this.segs.push(m);
      this.root.add(m);
    }
    // A face on the front segment: tiny eyes and a little mouth.
    this.head = new THREE.Group();
    const eye = new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.2 });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(SEG_R * 0.2, 8, 6), eye);
      e.position.set(SEG_R * 0.7, SEG_R * 0.4, side * SEG_R * 0.55);
      this.head.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(SEG_R * 0.23, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6a1e2a }));
    mouth.scale.set(0.6, 0.4, 1.4);
    mouth.position.set(SEG_R * 0.92, -SEG_R * 0.23, 0);
    this.head.add(mouth);
    this.segs[0].add(this.head);
  }

  /**
   * Lay the body along a list of points (head first), in the root's space. `up` is
   * which way the face's top should point; the head faces from segment 1 to segment 0.
   */
  pose(points: THREE.Vector3[], time: number, moving: boolean, up = new THREE.Vector3(0, 1, 0), swallowed = 0): void {
    this.segs.forEach((m, i) => {
      m.visible = i >= swallowed; // the front end may already be down a mole's throat
      const p = points[Math.min(i, points.length - 1)];
      // A ripple running down the body as it inches along.
      const pulse = moving ? 1 + Math.sin(time * 12 - i * 0.9) * 0.08 : 1 + Math.sin(time * 2 - i * 0.5) * 0.02;
      m.position.copy(p);
      const k = this.base[i] * this.thickness;
      m.scale.set(k, k * pulse, k);
    });
    const a = points[0], b = points[1] ?? points[0].clone().add(new THREE.Vector3(-1, 0, 0));
    const fwd = a.clone().sub(b);
    if (fwd.lengthSq() > 1e-6) {
      fwd.normalize();
      const side = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const realUp = new THREE.Vector3().crossVectors(side, fwd);
      const z = new THREE.Vector3().crossVectors(fwd, realUp); // right-handed: x forward, y up
      this.segs[0].quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, realUp, z));
    }
  }

}
