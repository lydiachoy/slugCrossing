import * as THREE from 'three';
import { BLOCK, CITY_W, City, GRID, PARK, ROAD, SPLAT_LIFE, TROPHY_RIM, type Building, type FoodKind } from './city.ts';
import { trophyMesh } from './garden-view.ts';
import { PigeonModel } from './pigeon-model.ts';

// City (x, y) → world (x, height, -y), as on the road.
const FLOOR_H = 3.5; // storey height
const TILE_W = 3.2; // one window per this much wall
const TROPHY_SCALE = TROPHY_RIM / 0.62; // the trophy model's rim is 0.62 up
const SPLAT_SIZE = 5; // big, satisfying splatters
const CAMERA = new THREE.Vector3(0, 16, 12); // offset from the pigeon: high, behind, looking down

type Activity = 'work' | 'cook' | 'play' | 'argue';
const ACTIVITIES: Activity[] = ['work', 'cook', 'play', 'argue'];

/**
 * The city, top-down: towering buildings with lit windows (and people inside, busy
 * with their lives), streets full of traffic, sidewalks full of people, and one tiny
 * pigeon. Buildings between the camera and the pigeon turn see-through.
 */
export class CityView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private built: City | null = null;
  private buildings: { b: Building; walls: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial; scenes: THREE.Group }[] = [];
  private cars!: { body: THREE.InstancedMesh; cabin: THREE.InstancedMesh; count: number };
  private people!: { body: THREE.InstancedMesh; head: THREE.InstancedMesh };
  /** Window scenes: each activity has two looks, swapped back and forth to animate them. */
  private sceneFrames = new Map<Activity, THREE.Texture[]>();
  private sceneMats = new Map<Activity, THREE.MeshBasicMaterial[]>();
  private holder = new THREE.Group();
  private pigeon = new PigeonModel();
  private halo: THREE.Sprite;
  private shadow: THREE.Mesh;
  private camAt = new THREE.Vector3();
  // Poops in the air, splats where they landed, and "+3" / "−5" floating up.
  private poopGroup = new THREE.Group();
  private poopMeshes = new Map<number, THREE.Mesh>();
  private poopGeo = new THREE.SphereGeometry(0.09, 8, 6);
  private poopMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.4 });
  private splatGroup = new THREE.Group();
  private splatMeshes = new Map<number, THREE.Mesh>();
  private splatGeo = splatGeometry();
  private labelGroup = new THREE.Group();
  private labels: { sprite: THREE.Sprite; age: number }[] = [];
  // The finale.
  private fireworkGroup = new THREE.Group();
  private bursts: { points: THREE.Points; vel: Float32Array; age: number }[] = [];
  private rockets: { mesh: THREE.Mesh; vel: THREE.Vector3; fuse: number; color: number }[] = [];
  private nextRocket = 0;
  private sparkTex = haloTexture(true);
  // Junk food on the sidewalks; feathers flying when a car flattens the pigeon.
  private foodMeshes = new Map<number, THREE.Group>();
  private foodModels = { pizza: pizzaMesh(), hotdog: hotdogMesh(), burger: burgerMesh() };
  private feathers: { mesh: THREE.Mesh; vel: THREE.Vector3; age: number }[] = [];
  private featherGeo = new THREE.PlaneGeometry(0.18, 0.06);
  private featherMat = new THREE.MeshBasicMaterial({ color: 0xc4c8ce, side: THREE.DoubleSide });
  private dummy = new THREE.Object3D();

  constructor() {
    this.scene.background = new THREE.Color(0xbfdcef);
    this.scene.fog = new THREE.Fog(0xbfdcef, 70, 180);
    this.scene.add(new THREE.HemisphereLight(0xf0f6ff, 0x6a6a6a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(-40, 80, 30);
    this.scene.add(sun);
    for (const a of ACTIVITIES) {
      const frames = [windowScene(a, 0), windowScene(a, 1)];
      this.sceneFrames.set(a, frames);
      this.sceneMats.set(a, [new THREE.MeshBasicMaterial({ map: frames[0] }), new THREE.MeshBasicMaterial({ map: frames[1] })]);
    }
    // The pigeon: small next to the people (about knee high), with a faint halo so it can be found.
    this.holder.scale.setScalar(0.85);
    this.holder.add(this.pigeon.root);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, depthTest: false }));
    this.halo.scale.setScalar(1.3);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
    this.scene.add(this.holder, this.halo, this.shadow);
    this.scene.add(this.poopGroup, this.splatGroup, this.labelGroup, this.fireworkGroup);
  }

  private build(c: City): void {
    this.built = c;
    // Asphalt everywhere; sidewalks round every block; dashed lines down the middle of the roads.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W + 200, CITY_W + 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3e4045, roughness: 0.95 }));
    ground.position.set(CITY_W / 2, 0, -CITY_W / 2);
    this.scene.add(ground);
    const pavement = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.9 });
    for (let bx = 0; bx < GRID; bx++) {
      for (let by = 0; by < GRID; by++) {
        const s = BLOCK - ROAD;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(s, 0.18, s), pavement);
        slab.position.set(bx * BLOCK + BLOCK / 2, 0.09, -(by * BLOCK + BLOCK / 2));
        this.scene.add(slab);
        if (bx === PARK.bx && by === PARK.by) this.buildPark(s);
      }
    }
    const dash = new THREE.MeshBasicMaterial({ map: dashTexture() });
    for (let k = 0; k <= GRID; k++) {
      const ns = new THREE.Mesh(new THREE.PlaneGeometry(0.15, CITY_W).rotateX(-Math.PI / 2), dash.clone());
      ns.position.set(k * BLOCK, 0.02, -CITY_W / 2);
      (ns.material as THREE.MeshBasicMaterial).map = dashTexture(CITY_W / 3, true);
      const ew = new THREE.Mesh(new THREE.PlaneGeometry(CITY_W, 0.15).rotateX(-Math.PI / 2), dash.clone());
      ew.position.set(CITY_W / 2, 0.02, -k * BLOCK);
      (ew.material as THREE.MeshBasicMaterial).map = dashTexture(CITY_W / 3, false);
      this.scene.add(ns, ew);
    }
    // Buildings: windows all the way up, people in some of them.
    const facade = facadeTexture();
    for (const b of c.buildings) {
      const w = b.x1 - b.x0, d = b.y1 - b.y0;
      const cols = Math.max(1, Math.round(w / TILE_W)), floors = Math.max(1, Math.round(b.h / FLOOR_H));
      const walls = new THREE.MeshStandardMaterial({ color: b.color, map: facade.clone(), roughness: 0.8, transparent: true });
      walls.map!.repeat.set(cols, floors);
      walls.map!.needsUpdate = true;
      const roof = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color).multiplyScalar(0.7), roughness: 0.9, transparent: true });
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, b.h, d), [walls, walls, roof, roof, walls, walls]);
      box.position.set((b.x0 + b.x1) / 2, b.h / 2, -(b.y0 + b.y1) / 2);
      this.scene.add(box);
      // A rooftop water tank or aerial here and there.
      if ((b.x0 * 7 + b.y0) % 3 < 1) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), roof);
        tank.position.set(b.x0 + w * 0.3, b.h + 0.8, -(b.y0 + d * 0.3));
        this.scene.add(tank);
      }
      // Scenes in the windows facing the camera (the south wall), on the lower floors.
      const scenes = new THREE.Group();
      const tw = w / cols, th = b.h / floors;
      const southZ = -b.y0 + 0.03;
      for (let f = 0; f < Math.min(floors, 8); f++) {
        for (let col = 0; col < cols; col++) {
          const seed = (Math.floor(b.x0 * 13) + f * 7 + col * 31) % 11;
          if (seed > 3) continue; // most windows are just windows
          const act = ACTIVITIES[seed % 4];
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(tw * 0.56, th * 0.56), this.sceneMats.get(act)![(f + col) % 2]);
          pane.position.set(b.x0 + (col + 0.5) * tw, (f + 0.52) * th, southZ);
          scenes.add(pane);
        }
      }
      this.scene.add(scenes);
      this.buildings.push({ b, walls, roof, scenes });
    }
    // Cars (instanced: there are lots).
    const n = c.lanes.reduce((k, l) => k + l.cars.length, 0);
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 1.1, 1.9), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 }), n);
    const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.75, 1.7), new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.15, metalness: 0.4 }), n);
    let i = 0;
    for (const lane of c.lanes) for (const car of lane.cars) body.setColorAt(i++, new THREE.Color(car.color));
    this.cars = { body, cabin, count: n };
    this.scene.add(body, cabin);
    // People (instanced too).
    const pb = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), c.walkers.length);
    const ph = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), c.walkers.length);
    c.walkers.forEach((w, k) => {
      pb.setColorAt(k, new THREE.Color(w.shirt));
      ph.setColorAt(k, new THREE.Color(w.skin));
    });
    this.people = { body: pb, head: ph };
    this.scene.add(pb, ph);
  }

  /** A score floating up from where a poop hit. */
  popLabel(x: number, y: number, points: number): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(points > 0 ? `+${points}` : `−${-points}`, points > 0 ? '#2fa84a' : '#e0302a'), depthTest: false, transparent: true,
    }));
    sprite.scale.set(2, 1, 1);
    sprite.position.set(x, 2.6, -y);
    this.labelGroup.add(sprite);
    this.labels.push({ sprite, age: 0 });
  }

  /** Poops falling; splats on the ground, on car roofs (riding along), and on people's heads. */
  private updatePoops(c: City, dt: number): void {
    const seen = new Set<number>();
    for (const p of c.poops) {
      seen.add(p.id);
      let m = this.poopMeshes.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.poopGeo, this.poopMat);
        m.scale.set(1, 1.4, 1);
        this.poopGroup.add(m);
        this.poopMeshes.set(p.id, m);
      }
      m.position.set(p.x, p.z, -p.y);
    }
    for (const [id, m] of this.poopMeshes) if (!seen.has(id)) (m.removeFromParent(), this.poopMeshes.delete(id));
    const live = new Set<number>();
    for (const s of c.splats) {
      live.add(s.id);
      let m = this.splatMeshes.get(s.id);
      if (!m) {
        m = new THREE.Mesh(this.splatGeo, new THREE.MeshStandardMaterial({ color: 0xf4f2ea, roughness: 0.3, transparent: true }));
        m.rotation.y = s.id;
        m.scale.setScalar(SPLAT_SIZE);
        this.splatGroup.add(m);
        this.splatMeshes.set(s.id, m);
      }
      if (s.on === 'car') {
        // Ride along on the car's roof.
        const lane = c.lanes[s.lane!], car = lane.cars[s.car!];
        if (car) {
          const q = c.carAt(lane, car);
          if (!m.userData.off) m.userData.off = lane.axis === 'x' ? s.x - q.x : s.y - q.y;
          const off = m.userData.off as number;
          m.position.set(lane.axis === 'x' ? q.x + off : q.x, 1.98, -(lane.axis === 'x' ? q.y : q.y + off));
        }
      } else if (s.on === 'person') {
        const w = c.walkers.find((q) => Math.hypot(c.walkerAt(q).x - s.x, c.walkerAt(q).y - s.y) < 0.6);
        const q = w ? c.walkerAt(w) : s;
        m.position.set(q.x, 1.98, -q.y);
        m.scale.setScalar(SPLAT_SIZE * 0.6);
      } else m.position.set(s.x, 0.21 + (s.id % 20) * 0.002, -s.y); // (staggered so overlapping splats don't flicker)
      (m.material as THREE.MeshStandardMaterial).opacity = Math.min(1, (SPLAT_LIFE - s.t) / 1);
    }
    for (const [id, m] of this.splatMeshes) {
      if (live.has(id)) continue;
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
      this.splatMeshes.delete(id);
    }
    for (const l of this.labels) {
      l.age += dt;
      l.sprite.position.y += dt * 1.8;
      (l.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - l.age / 1.2);
    }
    this.labels = this.labels.filter((l) => (l.age < 1.2 ? true : (l.sprite.removeFromParent(), false)));
  }

  /** Fireworks over the park: rockets streaking up, bursting into showers of colour. */
  private updateFireworks(c: City, dt: number): void {
    const tr = City.trophy();
    if (c.phase === 'landed' && (this.nextRocket -= dt) <= 0) {
      this.nextRocket = 0.08 + Math.random() * 0.14;
      const colors = [0xff4f6d, 0xffd23f, 0x4fc3ff, 0x6ddf6d, 0xc77dff, 0xff9f43, 0xffffff];
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color }));
      mesh.position.set(tr.x + (Math.random() - 0.5) * 26, 0.5, -(tr.y + (Math.random() - 0.5) * 18));
      this.fireworkGroup.add(mesh);
      // (Bursting low over the park, where the camera can see them.)
      this.rockets.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 15 + Math.random() * 5, (Math.random() - 0.5) * 3), fuse: 0.5 + Math.random() * 0.35, color });
    }
    for (const r of this.rockets) {
      r.fuse -= dt;
      r.vel.y -= 9 * dt;
      r.mesh.position.addScaledVector(r.vel, dt);
    }
    for (const r of this.rockets.filter((q) => q.fuse <= 0)) {
      // Bang!
      const n = 90, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 4);
        pos.set([r.mesh.position.x, r.mesh.position.y, r.mesh.position.z], i * 3);
        vel.set([v.x, v.y, v.z], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({
        color: r.color, size: 0.7, map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.fireworkGroup.add(points);
      this.bursts.push({ points, vel, age: 0 });
      r.mesh.removeFromParent();
      this.onBang?.();
    }
    this.rockets = this.rockets.filter((q) => q.fuse > 0);
    for (const b of this.bursts) {
      b.age += dt;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        b.vel[i * 3 + 1] -= 4 * dt;
        for (let k = 0; k < 3; k++) b.vel[i * 3 + k] *= 1 - dt * 1.2;
        pos.setXYZ(i, pos.getX(i) + b.vel[i * 3] * dt, pos.getY(i) + b.vel[i * 3 + 1] * dt, pos.getZ(i) + b.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / 1.8);
    }
    this.bursts = this.bursts.filter((b) => (b.age < 1.8 ? true : (b.points.removeFromParent(), b.points.geometry.dispose(), false)));
  }

  /** Junk food lying on the sidewalk, glinting enticingly (when the pigeon is hungry). */
  private updateFood(c: City, time: number): void {
    for (const f of c.food) {
      let g = this.foodMeshes.get(f.id);
      if (!g || g.userData.kind !== f.kind) {
        g?.removeFromParent();
        g = this.foodModels[f.kind].clone();
        g.userData.kind = f.kind;
        g.rotation.y = f.id * 1.3;
        this.scene.add(g);
        this.foodMeshes.set(f.id, g);
      }
      g.visible = f.gone <= 0;
      g.position.set(f.x, 0.2 + (c.grounded ? Math.abs(Math.sin(time * 4 + f.id)) * 0.08 : 0), -f.y);
    }
  }

  private feather(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.featherGeo, this.featherMat);
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.feathers.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4), age: 0 });
  }

  /** Called on each firework bang (for the sound). */
  onBang: (() => void) | null = null;

  /** The park: lawn, paths, trees, flowerbeds, and a giant golden trophy in the middle. */
  private buildPark(size: number): void {
    const tr = City.trophy();
    const at = (x: number, y: number, z: number) => new THREE.Vector3(tr.x + x, y, -(tr.y + z));
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(size - 2.2, 0.06, size - 2.2), new THREE.MeshStandardMaterial({ color: 0x5fae3e, roughness: 1 }));
    lawn.position.copy(at(0, 0.2, 0));
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 1 });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(size - 2.2, 0.07, 1.4), pathMat);
    p1.position.copy(at(0, 0.21, 0));
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.07, size - 2.2), pathMat);
    p2.position.copy(at(0, 0.21, 0));
    this.scene.add(lawn, p1, p2);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x6b4a2e }), leaves = new THREE.MeshStandardMaterial({ color: 0x3f8a2e, roughness: 0.9 });
    for (const [x, z] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2], [-4.5, 0.5], [4.5, -0.5]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.4, 6), trunk);
      t.position.copy(at(x, 1.4, z));
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), leaves);
      crown.position.copy(at(x, 3.4, z));
      this.scene.add(t, crown);
    }
    const flower = [0xff5d8f, 0xffd23f, 0xffffff, 0xb57bff];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshStandardMaterial({ color: flower[i % 4] }));
      f.position.copy(at(Math.cos(a) * 2.8, 0.3, Math.sin(a) * 2.8));
      this.scene.add(f);
    }
    // The giant trophy, on a plinth, gleaming.
    const trophy = trophyMesh();
    trophy.scale.setScalar(TROPHY_SCALE);
    trophy.position.copy(at(0, 0.25, 0));
    this.scene.add(trophy);
  }

  render(renderer: THREE.WebGLRenderer, c: City, dt: number, time: number): void {
    if (this.built !== c) this.build(c);
    // Window scenes: everyone's busy (two looks, swapped to animate).
    const frame = Math.floor(time * 2.5) % 2;
    for (const [a, mats] of this.sceneMats) {
      const frames = this.sceneFrames.get(a)!;
      mats[0].map = frames[frame];
      mats[1].map = frames[1 - frame];
    }
    // Traffic.
    let i = 0;
    for (const lane of c.lanes) {
      for (const car of lane.cars) {
        const p = c.carAt(lane, car);
        this.dummy.position.set(p.x, 0.75, -p.y);
        this.dummy.rotation.set(0, lane.axis === 'x' ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        this.dummy.updateMatrix();
        this.cars.body.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.y = 1.55;
        this.dummy.translateX(-0.3);
        this.dummy.updateMatrix();
        this.cars.cabin.setMatrixAt(i, this.dummy.matrix);
        i++;
      }
    }
    this.cars.body.instanceMatrix.needsUpdate = this.cars.cabin.instanceMatrix.needsUpdate = true;
    // Pedestrians, with a little walking bob.
    c.walkers.forEach((w, k) => {
      const p = c.walkerAt(w);
      // (Running away, panicking, from a pigeon on the ground: a big, fast bounce.)
      const bob = w.fleeing ? Math.abs(Math.sin(time * 18 + k)) * 0.25 : Math.abs(Math.sin(time * 8 + k)) * 0.06;
      this.dummy.rotation.set(0, p.facing, 0);
      this.dummy.position.set(p.x, 0.85 + bob, -p.y);
      this.dummy.updateMatrix();
      this.people.body.setMatrixAt(k, this.dummy.matrix);
      this.dummy.position.y = 1.72 + bob;
      this.dummy.updateMatrix();
      this.people.head.setMatrixAt(k, this.dummy.matrix);
    });
    this.people.body.instanceMatrix.needsUpdate = this.people.head.instanceMatrix.needsUpdate = true;
    // The pigeon, facing the way it's flying (with a goofy wobble).
    const sitting = c.phase === 'landed';
    const onFoot = c.grounded && c.alt < 1;
    const bp = new THREE.Vector3(c.pos.x, c.alt + (sitting ? 0.25 : onFoot ? 0 : Math.sin(time * 3) * 0.15), -c.pos.y);
    this.pigeon.update(time, c.moving, onFoot);
    this.holder.position.copy(bp);
    this.holder.rotation.set(onFoot ? 0 : Math.sin(time * 5) * 0.12, c.heading, 0);
    // Flattened by a car (and seeing stars).
    const squashed = c.squashT > 0;
    this.holder.scale.set(0.85 * (squashed ? 1.5 : 1), 0.85 * (squashed ? 0.2 : 1), 0.85 * (squashed ? 1.5 : 1));
    this.updateFood(c, time);
    if (squashed && Math.random() < dt * 25) this.feather(bp);
    for (const f of this.feathers) {
      f.age += dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(1 - dt * 2);
      f.vel.y -= dt * 1.5;
      f.mesh.rotation.z += dt * 6;
    }
    this.feathers = this.feathers.filter((f) => (f.age < 1.5 ? true : (f.mesh.removeFromParent(), false)));
    this.halo.position.copy(bp);
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.45 + Math.sin(time * 3) * 0.15;
    this.shadow.position.set(bp.x, 0.2, bp.z);
    // Camera: high above and behind, easing after it.
    const canvas = renderer.domElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camAt.lerp(bp, this.camAt.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 4));
    // (Pulling back as it climbs over the city; closing in on it sitting in the trophy.)
    const back = c.phase === 'landed' ? 0.75 : 1 + Math.max(0, c.alt - 4) / 30;
    this.camera.position.copy(this.camAt).addScaledVector(CAMERA, back);
    this.camera.lookAt(this.camAt);
    this.camera.updateProjectionMatrix();
    // Anything standing between the camera and the pigeon turns see-through.
    const from = this.camera.position, to = bp;
    for (const { b, walls, roof, scenes } of this.buildings) {
      let hit = false;
      for (let s = 0.05; s < 1 && !hit; s += 0.05) {
        const x = from.x + (to.x - from.x) * s, y = from.y + (to.y - from.y) * s, z = -(from.z + (to.z - from.z) * s);
        hit = x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.y0 - 0.3 && z < b.y1 + 0.3 && y < b.h;
      }
      const o = THREE.MathUtils.damp(walls.opacity, hit ? 0.18 : 1, 8, dt);
      walls.opacity = roof.opacity = o;
      walls.depthWrite = roof.depthWrite = o > 0.9;
      scenes.visible = o > 0.6;
    }
    this.updatePoops(c, dt);
    this.updateFireworks(c, dt);
    renderer.render(this.scene, this.camera);
  }
}

/** A blobby white splat, lying flat. */
function splatGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2, r = 0.22 * (i % 2 ? 0.65 : 1) * (1 + Math.sin(i * 2.3) * 0.15);
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/** A floating "+3" or "−5". */
function labelTexture(text: string, color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, 64, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One storey-and-window tile of wall: plain wall round a glazed window (the colour comes from the material). */
function facadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 70;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 64, 70);
  const g = ctx.createLinearGradient(14, 16, 50, 54);
  g.addColorStop(0, '#9fc4e0');
  g.addColorStop(0.5, '#4a6a8a');
  g.addColorStop(1, '#2a3a50');
  ctx.fillStyle = g;
  ctx.fillRect(14, 15, 36, 39);
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 15, 36, 39);
  ctx.beginPath();
  ctx.moveTo(32, 15);
  ctx.lineTo(32, 54);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 64, 64, 6); // the floor line
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A lit room with someone in it: working, cooking, playing, or two people arguing. Two frames of each. */
function windowScene(a: Activity, frame: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = { work: '#f6e7b8', cook: '#f4d8a8', play: '#d8ecf8', argue: '#f2c8b0' }[a];
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 48, 64, 16); // floor
  const person = (x: number, y: number, shirt: string, armUp: number, face = '#f0c8a0') => {
    ctx.fillStyle = shirt;
    ctx.fillRect(x - 6, y, 12, 18); // body
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y - 5, 5.5, 0, Math.PI * 2);
    ctx.fill(); // head
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 3);
    ctx.lineTo(x + 12, y + 3 - armUp); // arm
    ctx.stroke();
  };
  if (a === 'work') {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(28, 38, 30, 4); // desk
    ctx.fillStyle = '#222';
    ctx.fillRect(38, 22, 16, 14); // monitor
    ctx.fillStyle = frame ? '#7fd0ff' : '#5fb0ff';
    ctx.fillRect(40, 24, 12, 10); // glowing screen
    person(22, 26, '#3f6fb5', frame ? 6 : 2);
  } else if (a === 'cook') {
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(34, 34, 26, 14); // stove
    ctx.fillStyle = '#333';
    ctx.fillRect(38, 30, 14, 4); // pan
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(40 + i * 5, 28);
      ctx.quadraticCurveTo(43 + i * 5 + (frame ? 3 : -3), 22, 40 + i * 5, 16); // steam
      ctx.stroke();
    }
    person(22, 26, '#ffffff', frame ? 10 : 4); // a chef in white
  } else if (a === 'play') {
    person(16, 30, '#e05a5a', frame ? 14 : 4);
    person(48, 30, '#5ab05a', frame ? 4 : 14);
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.arc(frame ? 38 : 26, frame ? 14 : 20, 4, 0, Math.PI * 2);
    ctx.fill(); // the ball
  } else {
    person(18, 26, '#8a4fc0', frame ? 16 : 6, '#e88a7a');
    person(46, 26, '#c0804f', frame ? 6 : 16, '#e88a7a');
    ctx.fillStyle = '#c4201a';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(frame ? '#@!' : '!!', frame ? 6 : 38, 12); // heated words
  }
  // Window frame.
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** White dashes, for the middle of the road. */
function dashTexture(repeat = 1, vertical = false): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = vertical ? 4 : 64;
  c.height = vertical ? 64 : 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3e4045';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f2e6a0';
  if (vertical) ctx.fillRect(0, 0, 4, 34);
  else ctx.fillRect(0, 0, 34, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(vertical ? 1 : repeat, vertical ? repeat : 1);
  return t;
}

/** A soft glow, so the little pigeon can be spotted (or, bright, a firework spark). */
function haloTexture(bright = false): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, bright ? 'rgba(255,255,255,1)' : 'rgba(255,240,180,0.5)');
  g.addColorStop(bright ? 0.35 : 0.6, bright ? 'rgba(255,255,255,0.6)' : 'rgba(255,220,120,0.25)');
  g.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const foodStd = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

/** A slice of pizza: crust, cheese and pepperoni. About 0.7 long. */
function pizzaMesh(): THREE.Group {
  const g = new THREE.Group();
  const tri = new THREE.Shape();
  tri.moveTo(0, 0.35);
  tri.lineTo(-0.3, -0.35);
  tri.lineTo(0.3, -0.35);
  tri.closePath();
  const cheese = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false }).rotateX(-Math.PI / 2), foodStd(0xf2c84a));
  const crust = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.55, 4, 8).rotateZ(Math.PI / 2), foodStd(0xc8853a));
  crust.position.set(0, 0.03, 0.35);
  g.add(cheese, crust);
  for (const [x, z] of [[0, -0.1], [-0.1, 0.15], [0.1, 0.18]]) {
    const pep = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 10), foodStd(0xb8302a));
    pep.position.set(x, 0.05, z);
    g.add(pep);
  }
  return g;
}

/** A hotdog: bun, sausage and a squiggle of mustard. */
function hotdogMesh(): THREE.Group {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.45, 4, 8).rotateZ(Math.PI / 2), foodStd(0xe0a85a));
    bun.position.set(0, 0.07, side * 0.08);
    g.add(bun);
  }
  const sausage = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.6, 4, 8).rotateZ(Math.PI / 2), foodStd(0xa8402a));
  sausage.position.y = 0.11;
  const mustard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 4, 10, Math.PI * 5), foodStd(0xf2d020));
  mustard.rotation.x = Math.PI / 2;
  mustard.scale.set(4, 1, 1);
  mustard.position.y = 0.17;
  g.add(sausage, mustard);
  return g;
}

/** A burger: bun, patty, cheese, lettuce, sesame seeds. */
function burgerMesh(): THREE.Group {
  const g = new THREE.Group();
  const layer = (r: number, h: number, y: number, color: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), foodStd(color));
    m.position.y = y;
    g.add(m);
  };
  layer(0.26, 0.07, 0.04, 0xd89a4a); // bottom bun
  layer(0.28, 0.07, 0.11, 0x6a3a1e); // patty
  layer(0.29, 0.02, 0.155, 0xf2c030); // cheese
  layer(0.3, 0.02, 0.175, 0x5fb03a); // lettuce
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), foodStd(0xd89a4a));
  top.position.y = 0.185;
  top.scale.y = 0.6;
  g.add(top);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, r = 0.08 + (i % 3) * 0.05;
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3), foodStd(0xfff4d0));
    seed.position.set(Math.cos(a) * r, 0.33 - r * 0.25, Math.sin(a) * r);
    g.add(seed);
  }
  return g;
}

export type { FoodKind };
