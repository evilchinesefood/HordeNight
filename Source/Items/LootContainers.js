// searchable loot containers: crates/lockers at building sites + the
// existing prop barrels. Layout is pure (Node-tested); meshes/search state
// live here. Loot rolls are seeded per container id - deterministic world,
// independent of when you search.
import * as THREE from "three";
import { Mulberry } from "../Core/Rng.js";
import { rollLoot, nearestSearchable } from "./ItemDB.js";

const SEARCH_TIME = 0.8;

export function containerLayout(structures, barrels) {
  const out = [];
  const place = (s, lx, lz, type, bonus) => {
    const cos = Math.cos(s.rot);
    const sin = Math.sin(s.rot);
    out.push({
      x: cos * lx + sin * lz + s.x,
      z: -sin * lx + cos * lz + s.z,
      rot: s.rot,
      type,
      bonus,
    });
  };
  let firstCabin = true;
  for (const s of structures) {
    const p = s.parts;
    if (p.kind === "cabin") {
      // the home cabin's crate guarantees the night-1 pistol
      place(s, p.W / 4, -p.D / 4, "crate", firstCabin ? "pistol" : undefined);
      place(s, -p.W / 2 - 0.55, -p.D / 4, "cabinet");
      firstCabin = false;
    } else if (p.kind === "barn") {
      place(s, -p.W / 4, -p.D / 4, "crate");
      place(s, p.W / 4, p.D / 4 - 1, "crate");
    } else if (p.kind === "shed") place(s, 0, 0, "crate");
    else if (p.kind === "ruin") place(s, 1.2, 0.8, "crate");
    else if (p.kind === "tower") place(s, 0, 0, "cabinet");
  }
  for (const b of barrels) out.push({ x: b.x, z: b.z, rot: 0, type: "barrel" });
  return out;
}

export class LootContainers {
  constructor({ heightAt, structures, barrels, seed }) {
    this.seed = seed;
    this.group = new THREE.Group();
    this.progress = 0;
    this.current = null;

    const plank = new THREE.MeshStandardMaterial({
      color: 0x7a5b38,
      roughness: 0.9,
    });
    const plankDark = new THREE.MeshStandardMaterial({
      color: 0x5d452c,
      roughness: 0.9,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x4a5560,
      roughness: 0.6,
      metalness: 0.35,
    });
    const lidGeo = new THREE.BoxGeometry(0.76, 0.1, 0.76).translate(
      0,
      0.05,
      0.38, // pivot on the back edge so it hinges open
    );
    const doorGeo = new THREE.BoxGeometry(0.56, 1.3, 0.05).translate(
      0.28,
      0,
      0, // pivot on the side edge
    );

    this.items = containerLayout(structures, barrels).map((c, i) => {
      const it = { ...c, id: i, searched: false, y: heightAt(c.x, c.z) };
      if (c.type === "crate") {
        const g = new THREE.Group();
        g.add(
          new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.72), plank),
        ).position.y = 0.25;
        const lid = new THREE.Mesh(lidGeo, plankDark);
        lid.position.set(0, 0.5, -0.38);
        g.add(lid);
        it.opener = lid;
        it.mesh = g;
      } else if (c.type === "cabinet") {
        const g = new THREE.Group();
        g.add(
          new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.5, 0.45), metal),
        ).position.y = 0.75;
        const door = new THREE.Mesh(doorGeo, metal);
        door.position.set(-0.28, 0.78, 0.21);
        g.add(door);
        it.opener = door;
        it.mesh = g;
      } // barrels reuse the existing prop meshes
      if (it.mesh) {
        it.mesh.position.set(it.x, it.y, it.z);
        it.mesh.rotation.y = it.rot;
        it.mesh.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.group.add(it.mesh);
      }
      return it;
    });
  }

  // crates/cabinets block movement (rot-agnostic square approximation)
  boxes() {
    return this.items
      .filter((c) => c.mesh)
      .map((c) => {
        const half = c.type === "crate" ? 0.42 : 0.38;
        const top = c.type === "crate" ? 0.6 : 1.55;
        return {
          minX: c.x - half,
          maxX: c.x + half,
          minZ: c.z - half,
          maxZ: c.z + half,
          minY: c.y - 0.5,
          maxY: c.y + top,
        };
      });
  }

  open(c) {
    c.searched = true;
    if (c.opener) {
      c.opener.matrixAutoUpdate = true; // group may be matrix-frozen
      if (c.type === "crate") c.opener.rotation.x = -1.05;
      else c.opener.rotation.y = -1.3;
    }
    const rng = Mulberry(this.seed * 7919 + c.id * 131 + 17);
    const loot = rollLoot(c.type, rng);
    if (c.bonus) loot.unshift({ id: c.bonus, n: 1 });
    return loot;
  }

  // -> { prompt, progress, loot } ; loot only on the completing frame
  update(dt, { px, pz, dx, dz, eHeld }) {
    const c = nearestSearchable(this.items, px, pz, dx, dz);
    if (c !== this.current) {
      this.current = c;
      this.progress = 0;
    }
    if (!c) return { prompt: null, progress: 0, loot: null };
    if (!eHeld) {
      this.progress = 0;
      return { prompt: "Hold E to search", progress: 0, loot: null };
    }
    this.progress += dt / SEARCH_TIME;
    if (this.progress < 1)
      return { prompt: "Searching…", progress: this.progress, loot: null };
    this.progress = 0;
    this.current = null;
    return { prompt: null, progress: 0, loot: this.open(c) };
  }
}
