// off-main-thread terrain attribute fill: pure math, transferable results
import { fillTerrain } from "./TerrainFill.js";

self.onmessage = (e) => {
  const { seed, xs, zs, index } = e.data;
  const r = fillTerrain(seed, xs, zs, index);
  self.postMessage(r, [
    r.heights.buffer,
    r.normals.buffer,
    r.colors.buffer,
    r.splat.buffer,
  ]);
};
