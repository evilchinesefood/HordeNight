const clamp01 = (t) => Math.max(0, Math.min(1, t));

// worn paths: each site connects to its nearest neighbor unless the segment
// would cross the stream; pairs are deduped
export function buildSitePaths(sites, streamDist) {
  const paths = [];
  const seen = new Set();
  for (let i = 0; i < sites.length; i++) {
    let bj = -1;
    let bd = 1e9;
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue;
      const d = Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    if (bj < 0 || bd > 110) continue;
    const key = Math.min(i, bj) + ":" + Math.max(i, bj);
    if (seen.has(key)) continue;
    seen.add(key);
    const a = sites[i];
    const b = sites[bj];
    let crosses = false;
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      if (streamDist(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < 12)
        crosses = true;
    }
    if (!crosses) paths.push([a.x, a.z, b.x, b.z]);
  }
  return paths;
}

export function pathDistance(paths, x, z) {
  let best2 = 1e18;
  for (const [ax, az, bx, bz] of paths) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    const ex = x - (ax + dx * t);
    const ez = z - (az + dz * t);
    const d2 = ex * ex + ez * ez;
    if (d2 < best2) best2 = d2;
  }
  return Math.sqrt(best2);
}
