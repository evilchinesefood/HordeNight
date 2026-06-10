import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HALF, WATER_Y } from "../Core/Heightfield.js";
import { Mulberry } from "../Core/Rng.js";
import {
  grassBladeTexture,
  barkTexture,
  leafCardTexture,
  pineCardTexture,
} from "../Engine/Textures.js";

const TREE_TRIES = 2600;
const SHRUB_COUNT = 280;
const GRASS_TILE = 64;
const GRASS_COUNT = 16000;

// --- geometry builders ---

function cardGeo(positions) {
  // positions: [{x,y,z, ry, rx, s}] -> merged outward-facing quads
  const quads = [];
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  for (const p of positions) {
    const q = new THREE.PlaneGeometry(p.s, p.s);
    m.makeTranslation(p.x, p.y, p.z);
    r.makeRotationY(p.ry);
    m.multiply(r);
    r.makeRotationX(p.rx);
    m.multiply(r);
    q.applyMatrix4(m);
    quads.push(q);
  }
  return mergeGeometries(quads);
}

// soft "volume" shading: normals point away from the canopy axis
function radializeNormals(geo, centerYBias) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    v.y -= v.y * centerYBias - 0.6;
    v.normalize();
    nor.setXYZ(i, v.x, Math.abs(v.y) * 0.6 + 0.25, v.z);
  }
  nor.needsUpdate = true;
  return geo;
}

function pineCoreGeo() {
  return mergeGeometries([
    new THREE.ConeGeometry(1.2, 2.6, 7).translate(0, 2.7, 0),
    new THREE.ConeGeometry(0.8, 2, 7).translate(0, 4.1, 0),
  ]);
}

function pineCardsGeo(rng) {
  const cards = [];
  const tiers = [
    [2.5, 1.15, 5, 2.1],
    [3.6, 0.9, 4, 1.8],
    [4.7, 0.55, 3, 1.4],
  ];
  for (const [y, rad, n, size] of tiers) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng();
      cards.push({
        x: Math.cos(a) * rad * 0.55,
        y,
        z: Math.sin(a) * rad * 0.55,
        ry: -a + Math.PI / 2,
        rx: -0.85 - rng() * 0.25,
        s: size,
      });
    }
  }
  return radializeNormals(cardGeo(cards), 0.8);
}

function oakCoreGeo() {
  return mergeGeometries([
    new THREE.IcosahedronGeometry(1.35, 1)
      .scale(1, 0.8, 1)
      .translate(0, 3.6, 0),
    new THREE.IcosahedronGeometry(0.85, 1).translate(1, 3, 0.3),
  ]);
}

function oakCardsGeo(rng) {
  const cards = [];
  const c = new THREE.Vector3(0, 3.55, 0);
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const elev = (rng() - 0.35) * 1.4;
    const dir = new THREE.Vector3(
      Math.cos(a) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(a) * Math.cos(elev),
    );
    const p = dir
      .clone()
      .multiplyScalar(1.35 + rng() * 0.5)
      .add(c);
    cards.push({
      x: p.x,
      y: p.y,
      z: p.z,
      ry: -a + Math.PI / 2,
      rx: -elev + (rng() - 0.5) * 0.6,
      s: 1.9 + rng() * 0.7,
    });
  }
  const geo = cardGeo(cards);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z).normalize();
    nor.setXYZ(i, v.x, v.y * 0.7 + 0.3, v.z);
  }
  return geo;
}

export function createVegetation(hf, heightTex) {
  const rng = Mulberry(hf.seed + 31);
  const group = new THREE.Group();
  const trunkColliders = [];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const uTime = { value: 0 };
  const uCamPos = { value: new THREE.Vector3() };

  const clearOfSites = (x, z, pad) =>
    hf.sites.every((s) => (s.x - x) ** 2 + (s.z - z) ** 2 > pad * pad);

  // --- tree placement (unchanged rules -> same colliders) ---
  const pines = [];
  const oaks = [];
  const cells = new Set();
  for (let i = 0; i < TREE_TRIES; i++) {
    const x = (rng() * 2 - 1) * (HALF - 12);
    const z = (rng() * 2 - 1) * (HALF - 12);
    const key = `${(x / 5) | 0},${(z / 5) | 0}`;
    if (cells.has(key)) continue;
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.8) continue;
    const slope = Math.abs(hf.heightAt(x + 2, z) - hf.heightAt(x - 2, z));
    if (slope > 1.7) continue;
    if (!clearOfSites(x, z, 13)) continue;
    cells.add(key);
    (rng() < 0.55 ? pines : oaks).push({ x, y, z, s: 0.75 + rng() * 0.75 });
  }

  const windSway = (mat, amp) => {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = uTime;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float wPh = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.27;
          float wAt = smoothstep( 1.6, 4.5, transformed.y );
          transformed.x += sin( uTime * 0.7 + wPh ) * wAt * ${amp};
          transformed.z += cos( uTime * 0.53 + wPh * 1.3 ) * wAt * ${amp} * 0.7;`,
        );
    };
  };

  const trunkMat = new THREE.MeshStandardMaterial({
    map: barkTexture(hf.seed),
    roughness: 1,
  });
  const coreMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const pineCardMat = new THREE.MeshStandardMaterial({
    map: pineCardTexture(hf.seed),
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const oakCardMat = new THREE.MeshStandardMaterial({
    map: leafCardTexture(hf.seed),
    alphaTest: 0.38,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  windSway(pineCardMat, 0.07);
  windSway(oakCardMat, 0.09);

  const cardDepth = (map) =>
    new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: 0.38,
    });

  const addInstanced = (geo, mat, items, tint, depthMap) => {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const v = new THREE.Vector3();
    items.forEach((t, i) => {
      const r = Mulberry(i * 7 + hf.seed);
      m.makeRotationY(r() * Math.PI * 2);
      m.scale(v.set(t.s, t.s * (0.9 + r() * 0.25), t.s));
      m.setPosition(t.x, t.y - 0.15, t.z);
      mesh.setMatrixAt(i, m);
      if (tint) mesh.setColorAt(i, tint(Mulberry(i * 13 + hf.seed + 5), col));
    });
    if (depthMap) mesh.customDepthMaterial = cardDepth(depthMap);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const barkTint = (r, c) =>
    c.setHSL(0.07 + r() * 0.03, 0.25 + r() * 0.1, 0.34 + r() * 0.14);
  const pineCoreTint = (r, c) =>
    c.setHSL(0.31 + r() * 0.04, 0.32, 0.21 + r() * 0.06);
  const pineCardTint = (r, c) =>
    c.setHSL(0.3 + r() * 0.05, 0.45, 0.5 + r() * 0.2);
  const oakCoreTint = (r, c) =>
    c.setHSL(0.25 + r() * 0.04, 0.35, 0.24 + r() * 0.06);
  const oakCardTint = (r, c) =>
    c.setHSL(0.22 + r() * 0.07, 0.48, 0.52 + r() * 0.2);

  const geoRng = Mulberry(hf.seed + 77);
  addInstanced(
    new THREE.CylinderGeometry(0.14, 0.3, 2.7, 7).translate(0, 1.35, 0),
    trunkMat,
    pines,
    barkTint,
  );
  addInstanced(pineCoreGeo(), coreMat, pines, pineCoreTint);
  addInstanced(
    pineCardsGeo(geoRng),
    pineCardMat,
    pines,
    pineCardTint,
    pineCardMat.map,
  );
  addInstanced(
    new THREE.CylinderGeometry(0.2, 0.36, 3, 7).translate(0, 1.5, 0),
    trunkMat,
    oaks,
    barkTint,
  );
  addInstanced(oakCoreGeo(), coreMat, oaks, oakCoreTint);
  addInstanced(
    oakCardsGeo(geoRng),
    oakCardMat,
    oaks,
    oakCardTint,
    oakCardMat.map,
  );

  for (const t of [...pines, ...oaks]) {
    trunkColliders.push({
      x: t.x,
      z: t.z,
      r: 0.4 * t.s + 0.1,
      topY: t.y + 3 * t.s,
    });
  }

  // --- near-field grass: instances wrap toroidally around the camera ---
  const quad = new THREE.PlaneGeometry(1, 0.75).translate(0, 0.34, 0);
  const grassGeo = mergeGeometries([quad, quad.clone().rotateY(Math.PI / 2)]);
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassBladeTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  grassMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = uTime;
    s.uniforms.uCamPos = uCamPos;
    s.uniforms.uHeightTex = { value: heightTex };
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uCamPos;
        uniform sampler2D uHeightTex;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
        mat3 gRs = mat3( instanceMatrix );
        vec2 gTuft = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
        vec2 gWp = gTuft + floor( ( uCamPos.xz - gTuft ) / ${GRASS_TILE}.0 + 0.5 ) * ${GRASS_TILE}.0;
        vec2 gUv = ( ( gWp + ${HALF}.0 ) / ${HALF * 2}.0 * 384.0 + 0.5 ) / 385.0;
        vec4 gHs = texture2D( uHeightTex, gUv );
        float gDist = distance( gWp, uCamPos.xz );
        float gFade = ( 1.0 - smoothstep( 16.0, 28.0, gDist ) ) * smoothstep( 0.3, 0.55, gHs.g );
        gFade *= 1.0 - step( 198.0, max( abs( gWp.x ), abs( gWp.y ) ) );
        transformed = gRs * transformed * gFade;
        float gBend = uv.y * uv.y * gFade;
        transformed.x += sin( uTime * 1.7 + gWp.x * 0.9 + gWp.y * 0.8 ) * gBend * 0.12;
        transformed.z += cos( uTime * 1.25 + gWp.x * 0.7 ) * gBend * 0.09;
        transformed += vec3( gWp.x, gHs.r, gWp.y );`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
        #endif`,
      );
  };

  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  const v = new THREE.Vector3();
  for (let i = 0; i < GRASS_COUNT; i++) {
    const s = 0.55 + rng() * 0.75;
    m.makeRotationY(rng() * Math.PI * 2);
    m.scale(v.set(s, s * (0.8 + rng() * 0.5), s));
    m.setPosition((rng() - 0.5) * GRASS_TILE, 0, (rng() - 0.5) * GRASS_TILE);
    grass.setMatrixAt(i, m);
    grass.setColorAt(
      i,
      col.setHSL(0.22 + rng() * 0.07, 0.5, 0.48 + rng() * 0.24),
    );
  }
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  group.add(grass);

  // --- shrubs ---
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 1)
    .scale(1.2, 0.75, 1.2)
    .translate(0, 0.32, 0);
  const shrubMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_COUNT);
  let sp = 0;
  for (let i = 0; i < SHRUB_COUNT * 5 && sp < SHRUB_COUNT; i++) {
    const x = (rng() * 2 - 1) * (HALF - 10);
    const z = (rng() * 2 - 1) * (HALF - 10);
    const y = hf.heightAt(x, z);
    if (y < WATER_Y + 0.4) continue;
    if (!clearOfSites(x, z, 9)) continue;
    const s = 0.6 + rng() * 1.1;
    m.makeRotationY(rng() * Math.PI * 2);
    m.scale(v.set(s, s * (0.9 + rng() * 0.25), s));
    m.setPosition(x, y, z);
    shrubs.setMatrixAt(sp, m);
    shrubs.setColorAt(
      sp,
      col.setHSL(0.25 + rng() * 0.04, 0.42, 0.3 + rng() * 0.12),
    );
    sp++;
  }
  shrubs.count = sp;
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  group.add(shrubs);

  const update = (t, camPos) => {
    uTime.value = t;
    if (camPos) uCamPos.value.copy(camPos);
  };
  return { group, trunkColliders, update };
}
