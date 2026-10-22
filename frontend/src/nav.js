// Costmap + A*: rasterize every static triangle between the floor and robot height into a 2D grid,
// inflate by the robot radius, then plan 8-connected paths and shortcut them by line of sight.
import * as T from 'three';

export function buildCostmap(roots, { minX, maxX, minZ, maxZ, cell = .1, inflate = .34, band = [.07, 1.7], skip = () => false }) {
  const W = Math.ceil((maxX - minX) / cell), H = Math.ceil((maxZ - minZ) / cell);
  const occ = new Uint8Array(W * H);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh || !visible(o) || skip(o)) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        if (Math.max(a.y, b.y, c.y) < band[0] || Math.min(a.y, b.y, c.y) > band[1]) continue;
        const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / cell)), x1 = Math.min(W - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / cell));
        const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - minZ) / cell)), z1 = Math.min(H - 1, Math.floor((Math.max(a.z, b.z, c.z) - minZ) / cell));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) occ[z * W + x] = 1;
      }
    });
  }
  // Cost 0-100 like DimOS's CostMapper: 100 lethal, a decaying band around obstacles.
  const base = occ.slice(), cost = new Uint8Array(W * H), r = Math.ceil((inflate + .45) / cell), lethal = inflate / cell;
  function inflateAll() {
    cost.fill(0);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!occ[z * W + x]) continue;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
        const d = Math.hypot(dx, dz), v = d <= lethal ? 100 : Math.max(0, Math.round(90 * (1 - (d - lethal) / (r - lethal))));
        if (v > cost[zz * W + xx]) cost[zz * W + xx] = v;
      }
    }
  }
  inflateAll();
  const map = { W, H, cell, minX, minZ, occ, cost };
  // Movable obstacles (chairs) as circles on top of the static map; called whenever one moves.
  map.setObstacles = circles => {
    occ.set(base);
    for (const c of circles) {
      const [cx, cz] = map.toCell(c.x, c.z), rr = Math.ceil(c.r / cell);
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && z >= 0 && x < W && z < H && Math.hypot(dx, dz) * cell <= c.r) occ[z * W + x] = 1;
      }
    }
    inflateAll();
  };
  map.toCell = (x, z) => [Math.floor((x - minX) / cell), Math.floor((z - minZ) / cell)];
  map.toWorld = (cx, cz) => [minX + (cx + .5) * cell, minZ + (cz + .5) * cell];
  map.free = (cx, cz) => cx >= 0 && cz >= 0 && cx < W && cz < H && cost[cz * W + cx] < 100;
  return map;
}

function nearestFree(map, cx, cz) {
  if (map.free(cx, cz)) return [cx, cz];
  for (let r = 1; r < 30; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++)
    if (Math.max(Math.abs(dx), Math.abs(dz)) === r && map.free(cx + dx, cz + dz)) return [cx + dx, cz + dz];
  return null;
}

// Nearest reachable point to (x, z): itself when free, else the closest free cell centre.
export function snapToFree(map, x, z) {
  const c = map.toCell(x, z), f = nearestFree(map, ...c);
  if (!f) return null;
  if (f[0] === c[0] && f[1] === c[1]) return { x, z };
  const [wx, wz] = map.toWorld(...f); return { x: wx, z: wz };
}

function lineFree(map, [ax, az], [bx, bz]) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
    if (!map.free(x, z) || map.cost[z * map.W + x] > 60) return false;
  }
  return true;
}

export function planPath(map, from, to) {
  const s = nearestFree(map, ...map.toCell(from.x, from.z)), g = nearestFree(map, ...map.toCell(to.x, to.z));
  if (!s || !g) return null;
  const { W, H, cost } = map, N = W * H, gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const start = s[1] * W + s[0], goal = g[1] * W + g[0];
  const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  const h = k => Math.hypot(k % W - g[0], ((k / W) | 0) - g[1]);
  gScore[start] = 0; push(start, h(start));
  while (heap.length) {
    const k = pop(); if (k === goal) break; if (closed[k]) continue; closed[k] = 1;
    const x = k % W, z = (k / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue; const nx = x + dx, nz = z + dz; if (!map.free(nx, nz)) continue;
      const nk = nz * W + nx, step = (dx && dz ? Math.SQRT2 : 1) * (1 + cost[nk] / 40);
      if (gScore[k] + step < gScore[nk]) { gScore[nk] = gScore[k] + step; came[nk] = k; push(nk, gScore[nk] + h(nk)); }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const cells = []; for (let k = goal; k >= 0; k = came[k]) { cells.push([k % W, (k / W) | 0]); if (k === start) break; }
  cells.reverse();
  const out = [cells[0]];
  for (let i = 1; i < cells.length; i++) if (!lineFree(map, out[out.length - 1], cells[i])) out.push(cells[i - 1]);
  out.push(cells[cells.length - 1]);
  const pts = out.map(([cx, cz]) => { const [x, z] = map.toWorld(cx, cz); return new T.Vector3(x, 0, z); });
  // Keep the exact goal when it is reachable (or the caller insists); otherwise stop at the nearest free cell.
  if (to.exact || map.free(...map.toCell(to.x, to.z))) pts[pts.length - 1].set(to.x, 0, to.z);
  return { points: pts, length: pts.reduce((sum, p, i) => i ? sum + p.distanceTo(pts[i - 1]) : 0, 0), expanded: closed.reduce((n, v) => n + v, 0) };
}

export function costmapTexture(map) {
  const data = new Uint8Array(map.W * map.H * 4);
  for (let i = 0; i < map.W * map.H; i++) {
    const v = map.cost[i];
    if (map.occ[i]) data.set([24, 32, 36, 170], i * 4);
    else if (v >= 100) data.set([150, 205, 232, 120], i * 4);
    else if (v > 0) data.set([150, 205, 232, Math.round(v * .9)], i * 4);
  }
  const tex = new T.DataTexture(data, map.W, map.H); tex.needsUpdate = true; tex.magFilter = T.NearestFilter; return tex;
}
