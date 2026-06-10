// pure XZ collision resolution: player circle vs world AABBs + tree-trunk circles

export function resolveCircleAabb(px, pz, r, box) {
  const cx = Math.max(box.minX, Math.min(px, box.maxX));
  const cz = Math.max(box.minZ, Math.min(pz, box.maxZ));
  let dx = px - cx;
  let dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return { x: (dx / d) * push, z: (dz / d) * push };
  }
  // center inside the box: push out the nearest face
  const left = px - box.minX;
  const right = box.maxX - px;
  const near = pz - box.minZ;
  const far = box.maxZ - pz;
  const m = Math.min(left, right, near, far);
  if (m === left) return { x: -(left + r), z: 0 };
  if (m === right) return { x: right + r, z: 0 };
  if (m === near) return { x: 0, z: -(near + r) };
  return { x: 0, z: far + r };
}

export function resolveCircleCircle(px, pz, r, c) {
  const dx = px - c.x;
  const dz = pz - c.z;
  const rr = r + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2) || 1e-6;
  const push = rr - d;
  return { x: (dx / d) * push, z: (dz / d) * push };
}

export function resolvePlayer(px, pz, r, feetY, headY, boxes, circles) {
  let x = px;
  let z = pz;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      if (feetY > b.maxY - 0.05 || headY < b.minY) continue;
      const p = resolveCircleAabb(x, z, r, b);
      if (p) {
        x += p.x;
        z += p.z;
      }
    }
    for (const c of circles) {
      if (feetY > c.topY) continue;
      const p = resolveCircleCircle(x, z, r, c);
      if (p) {
        x += p.x;
        z += p.z;
      }
    }
  }
  return { x, z };
}
