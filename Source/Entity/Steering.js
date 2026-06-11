// pure steering math for zombies: seek + whisker obstacle avoidance +
// neighbor separation. Obstacles are world AABBs ({minX..maxZ}) or circles
// ({x,z,r}); height gating happens before they reach here.

const WHISK_ANGLE = 0.6;
const WHISK_LEN = 2.4;

export function seek(zx, zz, px, pz, speed = 1) {
  const dx = px - zx;
  const dz = pz - zz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: 0, z: 0 };
  return { x: (dx / d) * speed, z: (dz / d) * speed };
}

const hits = (x, z, pad, obstacles) => {
  for (const o of obstacles) {
    if (o.minX !== undefined) {
      if (
        x > o.minX - pad &&
        x < o.maxX + pad &&
        z > o.minZ - pad &&
        z < o.maxZ + pad
      )
        return true;
    } else {
      const dx = x - o.x;
      const dz = z - o.z;
      const r = o.r + pad;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
};

// look-ahead feelers: center + two angled whiskers, sampled at half and full
// length; returns a sideways deflection to blend into the desired velocity
export function whiskerAvoid(x, z, dirx, dirz, obstacles, pad = 0.45) {
  const feel = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const fx = c * dirx - s * dirz;
    const fz = s * dirx + c * dirz;
    return (
      hits(
        x + fx * WHISK_LEN * 0.5,
        z + fz * WHISK_LEN * 0.5,
        pad,
        obstacles,
      ) || hits(x + fx * WHISK_LEN, z + fz * WHISK_LEN, pad, obstacles)
    );
  };
  const mid = feel(0);
  const left = feel(WHISK_ANGLE);
  const right = feel(-WHISK_ANGLE);
  if (!mid && !left && !right) return { x: 0, z: 0 };
  // "left" perpendicular of dir in XZ
  const lx = -dirz;
  const lz = dirx;
  let side = 0;
  let w = 0;
  if (mid) {
    w = 1.4;
    side = left && !right ? -1 : 1; // deterministic left when both blocked
  } else {
    w = 0.7;
    side = left ? -1 : 1;
  }
  return { x: lx * side * w, z: lz * side * w };
}

export function separation(x, z, neighbors, r) {
  let ox = 0;
  let oz = 0;
  for (const n of neighbors) {
    const dx = x - n.x;
    const dz = z - n.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-9 || d2 > r * r) continue;
    const d = Math.sqrt(d2);
    const w = (r - d) / (r * d);
    ox += dx * w;
    oz += dz * w;
  }
  return { x: ox, z: oz };
}
