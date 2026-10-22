// Open-frame 3D printer for a workspace desk, with a finished part on the bed and a camera on an arm
// above it. Local frame: front faces +z, origin on the desk top under the printer.
import * as T from 'three';

const M = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: .55, metalness: .2, ...o });
function part(parent, w, h, d, x, y, z, mat) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

function gear() {
  const s = new T.Shape(), teeth = 10, ro = .032, ri = .025;
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = i / (teeth * 2) * Math.PI * 2, a1 = (i + 1) / (teeth * 2) * Math.PI * 2, r = i % 2 ? ri : ro;
    if (i === 0) s.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    s.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); s.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
  }
  const hole = new T.Path(); hole.absarc(0, 0, .009, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new T.ExtrudeGeometry(s, { depth: .016, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -.008, 0);
  const mesh = new T.Mesh(g, M(0x5fb3d6, { roughness: .45, metalness: 0 })); mesh.castShadow = true; mesh.name = 'printed_part';
  return mesh;
}

function screen() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#0d1b22'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#96cde8'; g.font = '600 34px monospace';
  g.fillText('DONE', 18, 52); g.font = '24px monospace'; g.fillText('100%  2h14m', 18, 96);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return new T.MeshBasicMaterial({ map: t });
}

export function buildPrinter(parent, { x, y, z, rotY = 0 }) {
  const group = new T.Group(); group.name = '3d-printer'; group.position.set(x, y, z); group.rotation.y = rotY; parent.add(group);
  const frame = M(0x2b3133), accent = M(0x96cde8, { roughness: .4 }), steel = M(0xa4acac, { metalness: .7, roughness: .3 });
  part(group, .40, .06, .44, 0, .03, 0, frame);
  part(group, .27, .012, .27, 0, .066, .03, M(0x1d1f20));
  part(group, .26, .004, .26, 0, .074, .03, M(0xb8a46a, { metalness: .5, roughness: .35 }));
  for (const s of [-1, 1]) part(group, .035, .52, .06, s * .19, .32, -.13, frame);
  part(group, .42, .035, .06, 0, .58, -.13, frame);
  for (const yy of [.43, .47]) { const rod = new T.Mesh(new T.CylinderGeometry(.005, .005, .38, 8), steel); rod.rotation.z = Math.PI / 2; rod.position.set(0, yy, -.07); group.add(rod); }
  part(group, .075, .085, .065, .09, .45, -.05, accent);
  part(group, .012, .03, .012, .09, .395, -.03, steel);
  const spool = new T.Mesh(new T.CylinderGeometry(.1, .1, .065, 28), M(0x5fb3d6, { roughness: .6, metalness: 0 }));
  spool.rotation.z = Math.PI / 2; spool.position.set(0, .7, -.13); spool.castShadow = true; group.add(spool);
  part(group, .13, .065, .02, .11, .035, .225, frame).material = screen();
  part(group, .02, .02, .24, 0, .585, -.01, frame);
  part(group, .035, .025, .03, 0, .565, .11, M(0x101415));
  const piece = gear(); piece.position.set(0, .084, .06); group.add(piece);

  const api = {
    group, part: piece, hitMeshes: [],
    local(lx, ly, lz) { group.updateWorldMatrix(true, false); return group.localToWorld(new T.Vector3(lx, ly, lz)); },
    camera() { return { pos: api.local(0, .55, .11), target: api.local(0, .07, .03), fov: 46 }; },
  };
  group.traverse(o => { if (o.isMesh) { api.hitMeshes.push(o); o.userData.interactive = 'printer'; } });
  return api;
}
