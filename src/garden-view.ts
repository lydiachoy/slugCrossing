import * as THREE from 'three';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GARDEN_Y0, GARDEN_Y1, UPSET_TIME, VISION_HALF, VISION_RANGE, type Garden, type Gardener, type Veg, type VegKind,
} from './garden.ts';
import { HALF_W } from './layout.ts';
import { PORTAL_MORPH, SHELL_FALL, type Game } from './sim.ts';

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

/**
 * A coiled snail shell: a tube that widens as it winds out along a logarithmic
 * spiral, each whorl nestling against the last, with a slight spire. Coils in the
 * XY plane (axis along z), about 0.5 across, with amber bands following the whorls.
 */
export function shellMesh(material?: THREE.Material): THREE.Mesh {
  const turns = 2.3; // (the tiny innermost whorls are left off: they'd just be a wisp)
  const b = 0.16; // growth per radian: each whorl is e^(2πb) ≈ 2.7× the last
  const a = 0.16 * Math.exp(-b * turns * Math.PI * 2); // so the outer whorl's centre is 0.16 out
  // Fat whorls that overlap the one inside, like a real shell (just touching would be 1).
  const fit = (1 - Math.exp(-2 * Math.PI * b)) / (1 + Math.exp(-2 * Math.PI * b)) * 1.55;
  const geo = new ParametricGeometry((u, v, target) => {
    const theta = u * turns * Math.PI * 2; // along the coil, tip (u = 0) to mouth (u = 1)
    const phi = v * Math.PI * 2; // around the tube
    const R = a * Math.exp(b * theta);
    const r = R * fit;
    const spire = 0.07 * (1 - u) ** 2; // the centre bulges a little out of the plane
    target.set(
      (R + r * Math.cos(phi)) * Math.cos(theta),
      (R + r * Math.cos(phi)) * Math.sin(theta),
      spire + r * Math.sin(phi) * 1.15,
    );
  }, 160, 18);
  geo.computeVertexNormals();
  // Bands along the whorls: gold with darker amber stripes.
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const gold = new THREE.Color(0xffd24a), amber = new THREE.Color(0xc07812), c = new THREE.Color();
  const segs = 18 + 1;
  for (let i = 0; i < pos.count; i++) {
    const v = (i % segs) / (segs - 1);
    const band = Math.max(0, Math.sin(v * Math.PI * 2 * 3)) ** 3; // three stripes round the tube
    c.copy(gold).lerp(amber, band * 0.85);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, material ?? new THREE.MeshStandardMaterial({
    // Not fully metallic: there's no environment for a pure metal to reflect, so it would render dark.
    vertexColors: true, metalness: 0.45, roughness: 0.28, emissive: 0x8a5a00, emissiveIntensity: 0.45,
  }));
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
  // The tantrum: his hat (it gets flung down), his face (it goes red), and a cloud of swearing.
  private hat = new THREE.Group();
  private skinMat = std(0xf0c8a0);
  private grawlix: THREE.Sprite;
  // The trophy, and confetti.
  private trophy: THREE.Group;
  private confetti: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; age: number }[] = [];
  private confettiGeo = new THREE.PlaneGeometry(0.09, 0.05);
  private trophyShown = false;
  // The portal from hell.
  private portal: THREE.Group;
  private portalSwirl: THREE.Mesh;
  private portalLight = new THREE.PointLight(0xff3a10, 0, 8, 1.5);
  private flames: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number; life: number }[] = [];
  private flameGeo = new THREE.TetrahedronGeometry(0.09);
  private smokeShown = false;
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
    this.grawlix = new THREE.Sprite(new THREE.SpriteMaterial({ map: grawlixTexture(), depthTest: false }));
    this.grawlix.scale.set(1.5, 0.75, 1);
    this.grawlix.visible = false;
    this.scene.add(this.grawlix);
    this.trophy = trophyMesh();
    this.trophy.visible = false;
    this.scene.add(this.trophy);
    // A swirling disc of hellfire with a scorched, cracked rim.
    this.portal = new THREE.Group();
    this.portalSwirl = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: hellTexture(), transparent: true }),
    );
    this.portalSwirl.position.y = 0.09;
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.25, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a0805 }));
    rim.position.y = 0.085;
    const fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff4a10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    fireGlow.scale.setScalar(3.5);
    fireGlow.position.y = 0.3;
    this.portal.add(rim, this.portalSwirl, fireGlow);
    this.portal.visible = false;
    this.scene.add(this.portal, this.portalLight);

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
    this.updateTrophy(game, dt, time);
    this.updatePortal(game, dt, time);
  }

  /** A portal from hell opening up beneath the snail. */
  private updatePortal(game: Game, dt: number, time: number): void {
    const open = game.state === 'portal';
    this.portal.visible = open;
    this.portalLight.intensity = 0;
    if (open) {
      const t = game.portalT, s = game.slug;
      const k = Math.min(1, t / 1.1);
      const size = 0.15 + 1.1 * (1 - Math.pow(1 - k, 3)) + Math.sin(time * 9) * 0.03;
      this.portal.position.set(s.x, 0, -s.y + 0.1);
      this.portal.scale.setScalar(size);
      this.portalSwirl.rotation.y = -time * 3;
      this.portalLight.position.set(s.x, 0.6, -s.y);
      this.portalLight.intensity = 25 * k * (0.8 + Math.sin(time * 17) * 0.2);
      // Flames licking up round the edge.
      for (let i = 0; i < 3; i++) {
        if (Math.random() > dt * 60 * k) continue;
        const a = Math.random() * Math.PI * 2, r = size * (0.5 + Math.random() * 0.6);
        const mesh = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({ color: [0xff3a10, 0xff8a1a, 0xffd23a][Math.floor(Math.random() * 3)], transparent: true }));
        mesh.position.set(s.x + Math.cos(a) * r, 0.1, -s.y + 0.1 + Math.sin(a) * r);
        this.scene.add(mesh);
        this.flames.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.4), age: 0, life: 0.5 + Math.random() * 0.5 });
      }
      // The moment it turns into a worm: a big puff of brimstone smoke.
      if (t >= PORTAL_MORPH && !this.smokeShown) {
        this.smokeShown = true;
        for (let i = 0; i < 40; i++) this.sparkle(new THREE.Vector3(s.x, 0.5, -s.y), 2.5);
      }
    } else this.smokeShown = false;
    for (const f of this.flames) {
      f.age += dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += dt * 9;
      f.mesh.scale.setScalar(Math.max(0, 1 - f.age / f.life));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - f.age / f.life;
    }
    this.flames = this.flames.filter((f) => (f.age < f.life ? true : (f.mesh.removeFromParent(), (f.mesh.material as THREE.Material).dispose(), false)));
  }

  /** Garden cleared: after the tantrum, the snail holds up its trophy amid confetti. */
  private updateTrophy(game: Game, dt: number, time: number): void {
    const g = game.garden!;
    const show = g.phase === 'won' && g.phaseT >= UPSET_TIME;
    this.trophy.visible = show;
    if (show) {
      const k = Math.min(1, (g.phaseT - UPSET_TIME) / 0.5);
      const s = game.slug;
      // Held aloft on the tips of its eye stalks (it faces the camera, at +z), bobbing with pride.
      this.trophy.position.set(s.x, 0.5 + 0.72 * k + Math.sin(time * 5) * 0.05, -s.y + 0.12);
      this.trophy.rotation.set(0, Math.sin(time * 2) * 0.5, Math.sin(time * 4) * 0.08);
      this.trophy.scale.setScalar(0.4 + 0.6 * k);
      if (!this.trophyShown) {
        this.trophyShown = true;
        for (let i = 0; i < 160; i++) this.popConfetti(s.x, -s.y + 0.4);
      }
      if (Math.random() < dt * 14) this.sparkle(this.trophy.position.clone().add(new THREE.Vector3(0, 0.35, 0)), 1);
      if (Math.random() < dt * 25) this.popConfetti(s.x + (Math.random() - 0.5) * 6, -s.y + (Math.random() - 0.5) * 3, true);
    } else this.trophyShown = false;
    for (const c of this.confetti) {
      c.age += dt;
      c.vel.y = Math.max(-1.2, c.vel.y - 6 * dt); // flutters down slowly
      c.vel.x *= 1 - dt * 1.5;
      c.vel.z *= 1 - dt * 1.5;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      if (c.mesh.position.y < 0.05) c.vel.set(0, 0, 0);
    }
    this.confetti = this.confetti.filter((c) => (c.age < 6 ? true : (c.mesh.removeFromParent(), false)));
  }

  private popConfetti(x: number, z: number, fromSky = false): void {
    const colors = [0xff4f6d, 0xffd23f, 0x4fc3ff, 0x6ddf6d, 0xc77dff, 0xff9f43];
    const mesh = new THREE.Mesh(this.confettiGeo, new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)], side: THREE.DoubleSide }));
    mesh.position.set(x, fromSky ? 4 + Math.random() * 2 : 0.8, z);
    this.scene.add(mesh);
    const vel = fromSky ? new THREE.Vector3(0, -0.5, 0)
      : new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
    const spin = new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0);
    this.confetti.push({ mesh, vel, spin, age: 0 });
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
    const denim = std(0x3c5f9c), shirt = std(0xc4473a), skin = this.skinMat, boot = std(0x3a2a1c), straw = std(0xe3c47a, { roughness: 0.9 });
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
    this.hat.add(brim, crown, band);
    g.add(head, beard, nose, this.hat);
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
    // Face: red with rage during the tantrum.
    const rage = gd.state === 'upset' ? Math.min(1, gd.t / 0.8) : 0;
    this.skinMat.color.setHex(0xf0c8a0).lerp(new THREE.Color(0xe0302a), rage * 0.85);
    this.hat.position.set(0, 0, 0);
    this.hat.rotation.set(0, 0, 0);
    this.grawlix.visible = false;
    // Arms: swinging, or holding the snail up, or the big throw.
    if (gd.state === 'upset') {
      // TANTRUM: stomping up and down, shaking his fists, hat flung to the ground.
      const t = gd.t;
      g.position.y = Math.abs(Math.sin(t * 9)) * 0.2;
      this.legs.forEach((l, i) => (l.rotation.x = (i ? 1 : -1) * Math.sin(t * 9) * 0.7));
      this.arms.forEach((a, i) => a.rotation.set(-2.9 + Math.sin(t * 30 + i * 2) * 0.3, 0, (i ? -1 : 1) * 0.25));
      g.rotation.z = Math.sin(t * 9) * 0.06;
      // The hat: flung up off his head, then lands on the ground in front of him.
      const k = Math.min(1, t / 0.7);
      this.hat.position.set(0, 1.0 * Math.sin(k * Math.PI) - 1.6 * k, -0.55 * k);
      this.hat.rotation.set(k * Math.PI * 3, 0, k * 0.4);
      this.grawlix.visible = true;
      this.grawlix.position.set(gd.x + Math.sin(t * 20) * 0.05, 2.9 + Math.abs(Math.sin(t * 6)) * 0.15, -gd.y);
    } else if (gd.state === 'carry') {
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
    this.cone.visible = gd.state !== 'carry' && gd.state !== 'throw' && gd.state !== 'upset';
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

/** A swearing cloud: "#@$%!" in a jagged red burst. */
function grawlixTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, r = i % 2 ? 0.78 : 1;
    ctx.lineTo(128 + Math.cos(a) * 120 * r, 64 + Math.sin(a) * 58 * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e0302a';
  ctx.stroke();
  ctx.fillStyle = '#c4201a';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('#@$%!', 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A golden trophy cup with two handles, on a little plinth. About 0.6 tall. */
export function trophyMesh(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd04a, metalness: 0.5, roughness: 0.25, emissive: 0x9a6a00, emissiveIntensity: 0.5 });
  const profile = [
    [0.0, 0.0], [0.16, 0.0], [0.16, 0.04], [0.06, 0.08], [0.04, 0.18], [0.03, 0.26],
    [0.06, 0.3], [0.17, 0.38], [0.2, 0.5], [0.21, 0.62], [0.19, 0.62], [0.17, 0.5], [0.0, 0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), gold);
  cup.castShadow = true;
  g.add(cup);
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), gold);
    handle.rotation.z = side * -Math.PI / 2;
    handle.position.set(side * 0.2, 0.5, 0);
    g.add(handle);
  }
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 }));
  plinth.position.y = -0.04;
  g.add(plinth);
  // A star on the front.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 0.03 : 0.07;
    if (i === 0) star.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  const badge = new THREE.Mesh(new THREE.ShapeGeometry(star), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
  badge.position.set(0, 0.5, 0.21);
  g.add(badge);
  return g;
}

/** A swirl of hellfire: red, orange and yellow spiral arms around a black heart. */
function hellTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.25, '#3a0500');
  grad.addColorStop(0.6, '#b01a00');
  grad.addColorStop(0.9, '#ff6a00');
  grad.addColorStop(1, '#ffb020');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  for (let arm = 0; arm < 5; arm++) {
    ctx.strokeStyle = arm % 2 ? 'rgba(255,200,60,0.7)' : 'rgba(255,90,0,0.8)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = arm * (Math.PI * 2 / 5) + t * Math.PI * 3, r = t * 120;
      ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
