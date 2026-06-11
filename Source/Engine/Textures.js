import * as THREE from "three";
import { Mulberry } from "../Core/Rng.js";

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable - cannot generate textures");
  return [c, ctx];
}

// renderer capability, set once from Main before texture sets are built
let ANISO = 1;
export function setTextureAnisotropy(n) {
  ANISO = n;
}

// FluffyGrass-style tuft: fat tapered blades, grayscale shading in rgb,
// color comes from the base->tip ramp in the grass shader
export function fluffyTuftTexture() {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const rng = Mulberry(42);
  for (let i = 0; i < 9; i++) {
    const bx = S * (0.18 + (i / 8) * 0.64) + (rng() - 0.5) * 14;
    const w = 11 + rng() * 9;
    const h = S * (0.55 + rng() * 0.42);
    const lean = (bx - S / 2) * (0.5 + rng() * 0.5) + (rng() - 0.5) * 30;
    const g = 200 + rng() * 55;
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.moveTo(bx - w / 2, S);
    ctx.quadraticCurveTo(
      bx - w * 0.25 + lean * 0.4,
      S - h * 0.55,
      bx + lean,
      S - h,
    );
    ctx.quadraticCurveTo(
      bx + w * 0.25 + lean * 0.4,
      S - h * 0.55,
      bx + w / 2,
      S,
    );
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// leaf cluster card for tree canopies (mips off upstream: alpha-test foliage
// washes out when mipped)
export function leafClusterTexture(seed = 11, pine = false) {
  const S = 256;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const C = S / 2;
  if (pine) {
    ctx.lineCap = "round";
    for (let i = 0; i < 240; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * S * 0.44;
      const x = C + Math.cos(a) * d;
      const y = C + Math.sin(a) * d;
      const len = 9 + rng() * 16;
      const dir = a + (rng() - 0.5) * 1.2;
      const g = 95 + rng() * 65;
      ctx.strokeStyle = `rgb(${g * 0.45},${g},${g * 0.5})`;
      ctx.lineWidth = 2 + rng() * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2;
      const d =
        Math.sqrt(rng()) * S * 0.45 * (0.78 + 0.22 * Math.sin(a * 3 + seed));
      const x = C + Math.cos(a) * d;
      const y = C + Math.sin(a) * d * 0.94;
      const r = 5 + rng() * 9;
      const g = 100 + rng() * 80;
      ctx.fillStyle = `rgb(${g * 0.55},${g},${g * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        r,
        r * (0.55 + rng() * 0.4),
        rng() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  // transparent texels are black -> linear filtering bleeds dark halos at
  // alpha-tested edges; backfill rgb with a foliage tone (alpha stays 0)
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const f = pine ? [46, 86, 50] : [60, 102, 44];
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3] < 16) {
      d[i] = f[0];
      d[i + 1] = f[1];
      d[i + 2] = f[2];
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// painted far-tree impostor card (drawn for >90m + fog, style-matched)
export function impostorCardTexture(seed = 3, pine = false) {
  const W = 128;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const rng = Mulberry(seed);
  ctx.clearRect(0, 0, W, H);
  // trunk
  ctx.fillStyle = "#4c3a28";
  ctx.fillRect(W / 2 - 3, H * 0.55, 6, H * 0.45);
  if (pine) {
    for (let t = 0; t < 6; t++) {
      const y = H * (0.08 + t * 0.13);
      const w = W * (0.16 + t * 0.115);
      const g = 70 + rng() * 30 + t * 4;
      ctx.fillStyle = `rgb(${g * 0.5},${g},${g * 0.55})`;
      ctx.beginPath();
      ctx.moveTo(W / 2, y - H * 0.1);
      ctx.lineTo(W / 2 - w, y + H * 0.09);
      ctx.lineTo(W / 2 + w, y + H * 0.09);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const x = W / 2 + (rng() - 0.5) * W * 0.55;
      const y = H * 0.32 + (rng() - 0.5) * H * 0.34;
      const r = W * (0.16 + rng() * 0.14);
      const g = 85 + rng() * 50;
      ctx.fillStyle = `rgb(${g * 0.58},${g},${g * 0.42})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.85, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// deterministic value-noise FBM for cloud alpha erosion
function fbm2(seed) {
  const h = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 13.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const vn = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy);
    const b = h(ix + 1, iy);
    const c = h(ix, iy + 1);
    const d = h(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  return (x, y, oct = 4) => {
    let sum = 0;
    let amp = 1;
    let max = 0;
    for (let i = 0; i < oct; i++) {
      sum += vn(x, y) * amp;
      max += amp;
      amp *= 0.5;
      x *= 2;
      y *= 2;
    }
    return sum / max;
  };
}

const smooth01 = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// cumulus puff: domed blob stack, FBM-eroded cauliflower edges, flat
// shaded base (clouds-skill billboard recipe)
export function cloudTexture(seed = 8) {
  const S = 256;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(252,250,246,${a * 0.55})`);
    g.addColorStop(1, "rgba(250,248,244,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // dome: big lobes ride higher in the middle, base row sits near y 0.6
  for (let i = 0; i < 9; i++) {
    const u = 0.18 + rng() * 0.64;
    const lift = Math.sin(u * Math.PI) * 0.2;
    blob(
      S * u,
      S * (0.58 - lift * (0.5 + rng() * 0.5)),
      S * (0.1 + rng() * 0.12),
      0.55 + rng() * 0.3,
    );
  }
  for (let i = 0; i < 16; i++) {
    blob(
      S * (0.14 + rng() * 0.72),
      S * (0.3 + rng() * 0.32),
      S * (0.04 + rng() * 0.07),
      0.35,
    );
  }
  const fbm = fbm2(seed);
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const baseCut = 1 - smooth01(0.62, 0.74, t); // flat cumulus base
    const shade = 1 - 0.3 * smooth01(0.34, 0.7, t); // self-shadowed underside
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const a = d[i + 3] / 255;
      if (!a) continue;
      const n = fbm(x / 42, y / 42);
      // erosion strongest at thin edges -> cauliflower silhouette
      const edge = smooth01(0.06, 0.55, a);
      const carved =
        a * (edge + (1 - edge) * smooth01(0.42, 0.62, n)) * baseCut;
      d[i + 3] = Math.min(255, carved * 268);
      d[i] *= shade * 0.96;
      d[i + 1] *= shade * 0.97;
      d[i + 2] *= shade; // base drifts cool blue-gray
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// high-altitude cirrus: long combed streaks, anisotropic FBM erosion
export function cirrusTexture(seed = 12) {
  const S = 256;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const y = S * (0.2 + rng() * 0.6);
    const x0 = S * rng() * 0.4;
    const len = S * (0.4 + rng() * 0.55);
    const g = ctx.createLinearGradient(x0, y, x0 + len, y);
    const a = 0.16 + rng() * 0.2;
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.3, `rgba(255,255,255,${a})`);
    g.addColorStop(0.75, `rgba(252,252,255,${a * 0.7})`);
    g.addColorStop(1, "rgba(250,250,255,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5 + rng() * 5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(
      x0 + len * 0.5,
      y - S * (rng() * 0.06),
      x0 + len,
      y + S * (rng() * 0.05),
    );
    ctx.stroke();
  }
  const fbm = fbm2(seed + 5);
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!d[i + 3]) continue;
      const n = fbm(x / 90, y / 14); // stretched along the streaks
      d[i + 3] *= 0.35 + n * 0.85;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// wobbly bright cells on black; two scrolling reads min()ed = caustics
export function causticTexture(seed = 17) {
  const S = 256;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = "round";
  for (let i = 0; i < 110; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 7 + rng() * 22;
    const b = 120 + rng() * 135;
    ctx.strokeStyle = `rgba(${b},${b},${b},${0.3 + rng() * 0.35})`;
    ctx.lineWidth = 1.5 + rng() * 2.5;
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        ctx.beginPath();
        const segs = 8;
        for (let sgm = 0; sgm <= segs; sgm++) {
          const a = (sgm / segs) * Math.PI * 2;
          const rr = r * (0.8 + 0.3 * Math.sin(a * 3 + i));
          const px = x + dx + Math.cos(a) * rr;
          const py = y + dy + Math.sin(a) * rr;
          sgm === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// --- tileable ground PBR set (albedo + height->normal) ---

const TAU = Math.PI * 2;

// draws wrapped at 3x3 offsets so the texture tiles seamlessly
function wrapDot(ctx, S, x, y, r, style, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, TAU);
      ctx.fill();
    }
}

function wrapStroke(ctx, S, pts, style, alpha, width) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let i = 1; i < pts.length; i++)
        ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy);
      ctx.stroke();
    }
}

function heightToNormalCanvas(hctx, S, strength) {
  const hd = hctx.getImageData(0, 0, S, S).data;
  const at = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * S + x) * 4;
      // flipY upload: v runs opposite canvas y -> red = 128 - dx, green = 128 + dy
      img.data[i] = 128 - dx * inv * 127;
      img.data[i + 1] = 128 + dy * inv * 127;
      img.data[i + 2] = inv * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO; // walls/roofs/props are mostly seen at grazing angles
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLayer(seed, S, base, build, normalStrength) {
  const rng = Mulberry(seed);
  const [ac, actx] = canvas(S);
  const [, hctx] = canvas(S);
  actx.fillStyle = base;
  actx.fillRect(0, 0, S, S);
  hctx.fillStyle = "rgb(128,128,128)";
  hctx.fillRect(0, 0, S, S);
  build(actx, hctx, rng, S);
  actx.globalAlpha = hctx.globalAlpha = 1;
  return {
    map: tex(ac, true),
    nor: tex(heightToNormalCanvas(hctx, S, normalStrength), false),
  };
}

export function groundTextureSet(seed = 7) {
  const S = 256;
  const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

  const grass = makeLayer(
    seed + 1,
    S,
    "#5a7030",
    (a, h, rng) => {
      for (let i = 0; i < 700; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 1.5 + rng() * 2.5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#46591f", "#3e5526", "#52682c"]),
          0.5,
        );
        wrapDot(h, S, x, y, r, "rgb(110,110,110)", 0.4);
      }
      for (let i = 0; i < 300; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 1 + rng() * 1.5;
        wrapDot(a, S, x, y, r, pick(rng, ["#79903c", "#88994a"]), 0.55);
        wrapDot(h, S, x, y, r, "rgb(150,150,150)", 0.4);
      }
    },
    1.4,
  );

  const dirt = makeLayer(
    seed + 2,
    S,
    "#765e42",
    (a, h, rng) => {
      for (let i = 0; i < 320; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 3 + rng() * 5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#5e4a32", "#654f36", "#52402c"]),
          0.4,
        );
        wrapDot(h, S, x, y, r, "rgb(112,112,112)", 0.35);
      }
      for (let i = 0; i < 240; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 0.8 + rng() * 1.5;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#8a755a", "#97825f", "#6b573d"]),
          0.85,
        );
        wrapDot(h, S, x, y, r, "rgb(178,178,178)", 0.85);
      }
    },
    2.6,
  );

  const rock = makeLayer(
    seed + 3,
    S,
    "#7f7d78",
    (a, h, rng) => {
      for (let i = 0; i < 90; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 8 + rng() * 14;
        wrapDot(
          a,
          S,
          x,
          y,
          r,
          pick(rng, ["#6b6a66", "#8f8d88", "#76746f"]),
          0.25,
        );
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(116,116,116)" : "rgb(142,142,142)",
          0.3,
        );
      }
      for (let i = 0; i < 26; i++) {
        const pts = [[rng() * S, rng() * S]];
        for (let sgm = 0; sgm < 3 + rng() * 3; sgm++) {
          const [px, py] = pts[pts.length - 1];
          const ang = rng() * TAU;
          const len = 10 + rng() * 22;
          pts.push([px + Math.cos(ang) * len, py + Math.sin(ang) * len]);
        }
        wrapStroke(a, S, pts, "#56544f", 0.55, 1 + rng() * 1.2);
        wrapStroke(h, S, pts, "rgb(95,95,95)", 0.7, 1.5 + rng() * 1.5);
      }
      for (let i = 0; i < 250; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 0.6 + rng();
        wrapDot(a, S, x, y, r, rng() < 0.5 ? "#93918c" : "#67655f", 0.6);
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(160,160,160)" : "rgb(104,104,104)",
          0.6,
        );
      }
    },
    3.2,
  );

  // smooth mid-gray noise used to jitter splat boundaries per-pixel
  const rng = Mulberry(seed + 4);
  const [bc, bctx] = canvas(128);
  bctx.fillStyle = "rgb(128,128,128)";
  bctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 70 + rng() * 116;
    wrapDot(
      bctx,
      128,
      rng() * 128,
      rng() * 128,
      2 + rng() * 7,
      `rgb(${v},${v},${v})`,
      0.3,
    );
  }
  return { grass, dirt, rock, breakup: tex(bc, false) };
}

// --- weathered building surfaces (albedo + normal via makeLayer) ---

export function plankTextureSet(seed = 31, base = "#8a6f4d", worn = null) {
  return makeLayer(
    seed,
    256,
    base,
    (a, h, rng, S) => {
      const rows = 7;
      const rh = S / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        a.globalAlpha = 0.1 + rng() * 0.14;
        a.fillStyle = rng() < 0.5 ? "#3a2c1c" : "#c8a878";
        a.fillRect(0, y, S, rh);
        if (worn) {
          for (let w = 0; w < 3; w++) {
            a.globalAlpha = 0.12 + rng() * 0.18;
            a.fillStyle = worn;
            a.fillRect(rng() * S, y, 8 + rng() * 26, rh);
          }
        }
        for (let g = 0; g < 9; g++) {
          a.globalAlpha = 0.1 + rng() * 0.12;
          a.strokeStyle = "#4a3826";
          a.lineWidth = 1 + rng();
          const gy = y + 2 + rng() * (rh - 5);
          a.beginPath();
          a.moveTo(0, gy);
          a.bezierCurveTo(
            S * 0.3,
            gy + (rng() - 0.5) * 4,
            S * 0.7,
            gy + (rng() - 0.5) * 4,
            S,
            gy,
          );
          a.stroke();
        }
        a.globalAlpha = 0.55;
        a.fillStyle = "#241a10";
        a.fillRect(0, y + rh - 2, S, 2);
        h.globalAlpha = 0.85;
        h.fillStyle = "rgb(78,78,78)";
        h.fillRect(0, y + rh - 2, S, 2);
        h.globalAlpha = 0.25;
        h.fillStyle = rng() < 0.5 ? "rgb(112,112,112)" : "rgb(146,146,146)";
        h.fillRect(0, y, S, rh - 2);
      }
      for (let k = 0; k < 6; k++) {
        const x = rng() * S,
          y = rng() * S,
          r = 2 + rng() * 3;
        a.globalAlpha = 0.5;
        a.fillStyle = "#33261a";
        a.beginPath();
        a.arc(x, y, r, 0, Math.PI * 2);
        a.fill();
        h.globalAlpha = 0.5;
        h.fillStyle = "rgb(100,100,100)";
        h.beginPath();
        h.arc(x, y, r, 0, Math.PI * 2);
        h.fill();
      }
      for (let w = 0; w < 7; w++) {
        a.globalAlpha = 0.05 + rng() * 0.08;
        a.fillStyle = "#9aa0a4";
        a.fillRect(rng() * S, 0, 4 + rng() * 12, S);
      }
    },
    2.4,
  );
}

export function shingleTextureSet(seed = 33) {
  return makeLayer(
    seed,
    256,
    "#4e4036",
    (a, h, rng, S) => {
      const rows = 7;
      const rh = S / rows;
      const sw = 34;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const off = (r % 2) * (sw / 2);
        for (let x = -1; x < S / sw + 1; x++) {
          const sx = x * sw + off;
          a.globalAlpha = 0.12 + rng() * 0.16;
          a.fillStyle = rng() < 0.5 ? "#2c241d" : "#6b5a4a";
          a.fillRect(sx + 1, y, sw - 2, rh - 2);
          a.globalAlpha = 0.5;
          a.fillStyle = "#1d1712";
          a.fillRect(sx, y, 2, rh);
          h.globalAlpha = 0.3;
          h.fillStyle = rng() < 0.5 ? "rgb(112,112,112)" : "rgb(150,150,150)";
          h.fillRect(sx + 1, y, sw - 2, rh - 2);
        }
        a.globalAlpha = 0.6;
        a.fillStyle = "#171310";
        a.fillRect(0, y + rh - 3, S, 3);
        h.globalAlpha = 0.9;
        h.fillStyle = "rgb(70,70,70)";
        h.fillRect(0, y + rh - 3, S, 3);
      }
    },
    2.6,
  );
}

export function stoneTextureSet(seed = 35) {
  return makeLayer(
    seed,
    256,
    "#7d7a72",
    (a, h, rng, S) => {
      const rows = 6;
      const rh = S / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        let x = -((r % 2) * 20) - rng() * 10;
        while (x < S) {
          const w = 36 + rng() * 34;
          a.globalAlpha = 0.1 + rng() * 0.16;
          a.fillStyle = rng() < 0.5 ? "#5d5a52" : "#94908a";
          a.fillRect(x + 2, y + 2, w - 4, rh - 4);
          h.globalAlpha = 0.3;
          h.fillStyle = rng() < 0.5 ? "rgb(118,118,118)" : "rgb(150,150,150)";
          h.fillRect(x + 2, y + 2, w - 4, rh - 4);
          a.globalAlpha = 0.55;
          a.fillStyle = "#3f3b35";
          a.fillRect(x, y, 3, rh);
          h.globalAlpha = 0.9;
          h.fillStyle = "rgb(72,72,72)";
          h.fillRect(x, y, 3, rh);
          x += w;
        }
        a.globalAlpha = 0.55;
        a.fillStyle = "#3f3b35";
        a.fillRect(0, y, S, 3);
        h.globalAlpha = 0.9;
        h.fillStyle = "rgb(72,72,72)";
        h.fillRect(0, y, S, 3);
      }
    },
    2.8,
  );
}

export function barrelTextureSet(seed = 37) {
  return makeLayer(
    seed,
    256,
    "#7a5c3c",
    (a, h, rng, S) => {
      const staves = 9;
      const sw = S / staves;
      for (let c = 0; c < staves; c++) {
        const x = c * sw;
        a.globalAlpha = 0.12 + rng() * 0.14;
        a.fillStyle = rng() < 0.5 ? "#4a3522" : "#9c7c52";
        a.fillRect(x, 0, sw - 2, S);
        a.globalAlpha = 0.5;
        a.fillStyle = "#2c1f12";
        a.fillRect(x + sw - 2, 0, 2, S);
        h.globalAlpha = 0.85;
        h.fillStyle = "rgb(82,82,82)";
        h.fillRect(x + sw - 2, 0, 2, S);
      }
      for (const by of [0.16, 0.8]) {
        a.globalAlpha = 0.92;
        a.fillStyle = "#26241f";
        a.fillRect(0, S * by, S, S * 0.07);
        h.globalAlpha = 0.9;
        h.fillStyle = "rgb(185,185,185)";
        h.fillRect(0, S * by, S, S * 0.07);
      }
    },
    2.2,
  );
}

// natural rock surface for boulders (patches + cracks + speckles)
export function rockSurfaceSet(seed = 61) {
  return makeLayer(
    seed,
    256,
    "#7f7d78",
    (a, h, rng, S) => {
      for (let i = 0; i < 70; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 10 + rng() * 20;
        wrapDot(a, S, x, y, r, rng() < 0.5 ? "#6b6a66" : "#8f8d88", 0.25);
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(114,114,114)" : "rgb(142,142,142)",
          0.3,
        );
      }
      for (let i = 0; i < 20; i++) {
        const pts = [[rng() * S, rng() * S]];
        for (let k = 0; k < 3 + rng() * 3; k++) {
          const [px, py] = pts[pts.length - 1];
          const ang = rng() * Math.PI * 2;
          pts.push([
            px + Math.cos(ang) * (12 + rng() * 20),
            py + Math.sin(ang) * (12 + rng() * 20),
          ]);
        }
        wrapStroke(a, S, pts, "#55534f", 0.5, 1 + rng() * 1.5);
        wrapStroke(h, S, pts, "rgb(88,88,88)", 0.7, 1.5 + rng() * 1.5);
      }
      for (let i = 0; i < 240; i++) {
        const x = rng() * S,
          y = rng() * S,
          r = 0.6 + rng();
        wrapDot(a, S, x, y, r, rng() < 0.5 ? "#93918c" : "#67655f", 0.55);
        wrapDot(
          h,
          S,
          x,
          y,
          r,
          rng() < 0.5 ? "rgb(158,158,158)" : "rgb(104,104,104)",
          0.55,
        );
      }
    },
    3.0,
  );
}

// blobby tileable gray noise (foam masks etc)
export function softNoiseTexture(seed = 21) {
  const S = 128;
  const rng = Mulberry(seed);
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 800; i++) {
    const v = 60 + rng() * 136;
    wrapDot(
      ctx,
      S,
      rng() * S,
      rng() * S,
      2 + rng() * 8,
      `rgb(${v},${v},${v})`,
      0.3,
    );
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// normal map from noise heights for the water surface
export function waterNormalTexture(seed = 5) {
  const rng = Mulberry(seed);
  const S = 128;
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = rng();
  // blur for smooth ripples
  const blur = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          sum += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
      blur[y * S + x] = sum / 25;
    }
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = blur[y * S + ((x + 1) % S)] - blur[y * S + ((x - 1 + S) % S)];
      const dy = blur[((y + 1) % S) * S + x] - blur[((y - 1 + S) % S) * S + x];
      const i = (y * S + x) * 4;
      // same convention as heightToNormalCanvas: red = -dx, green = +dy
      img.data[i] = 128 - dx * 600;
      img.data[i + 1] = 128 + dy * 600;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
