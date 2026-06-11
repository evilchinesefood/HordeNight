// pure uniform-cell spatial hash over XZ; items insert with an optional
// extent so AABBs land in every cell they touch. Node-testable.
export function makeGrid(cell) {
  const cells = new Map();
  const idx = (v) => Math.floor(v / cell);
  return {
    insert(item, x0, z0, x1 = x0, z1 = z0) {
      for (let cx = idx(x0); cx <= idx(x1); cx++) {
        for (let cz = idx(z0); cz <= idx(z1); cz++) {
          const k = cx + "," + cz;
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(item);
        }
      }
    },
    queryRadius(x, z, r) {
      const out = [];
      const seen = new Set();
      for (let cx = idx(x - r); cx <= idx(x + r); cx++) {
        for (let cz = idx(z - r); cz <= idx(z + r); cz++) {
          const list = cells.get(cx + "," + cz);
          if (!list) continue;
          for (const item of list) {
            if (seen.has(item)) continue;
            seen.add(item);
            out.push(item);
          }
        }
      }
      return out;
    },
  };
}
