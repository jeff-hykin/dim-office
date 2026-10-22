// Interactive fridge for the glass kitchen: hinged door, lit interior, a Coca-Cola can and a banana.
// Local frame: the door faces +z, width runs along x, the hinge sits on the +x edge.
import * as T from 'three';

const shell = new T.MeshStandardMaterial({ color: 0xe9ebe7, roughness: .38, metalness: .28 });
const liner = new T.MeshStandardMaterial({ color: 0xc9d1d0, roughness: .7, emissive: 0xfff6e6, emissiveIntensity: .04 });
const glassShelf = new T.MeshStandardMaterial({ color: 0xd8eceb, roughness: .1, transparent: true, opacity: .45 });
const steel = new T.MeshStandardMaterial({ color: 0xa4acac, metalness: .7, roughness: .35 });

function part(parent, w, h, d, x, y, z, mat) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

function cokeCan() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#d6111e'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 96); g.bezierCurveTo(70, 70, 150, 120, 256, 84); g.stroke();
  g.fillStyle = '#fff'; g.font = 'italic 700 34px Georgia, serif'; g.textAlign = 'center'; g.fillText('Coca-Cola', 128, 62);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
  const top = new T.MeshStandardMaterial({ color: 0xc9cdd0, metalness: .8, roughness: .3 });
  const can = new T.Mesh(new T.CylinderGeometry(.033, .033, .122, 28), [new T.MeshStandardMaterial({ map: tex, roughness: .35, metalness: .3 }), top, top]);
  can.castShadow = true; can.name = 'coca_cola'; return can;
}

function banana() {
  const g = new T.Group(); g.name = 'banana';
  const curve = new T.CatmullRomCurve3([[-.095, .01, .02], [-.04, 0, -.012], [.03, 0, -.016], [.095, .012, .012]].map(p => new T.Vector3(...p)));
  const body = new T.Mesh(new T.TubeGeometry(curve, 20, .019, 8), new T.MeshStandardMaterial({ color: 0xf1cf3a, roughness: .55 }));
  body.castShadow = true; g.add(body);
  for (const [t, r] of [[0, .009], [1, .011]]) {
    const tip = new T.Mesh(new T.SphereGeometry(r, 8, 6), new T.MeshStandardMaterial({ color: 0x5b4422, roughness: .8 }));
    tip.position.copy(curve.getPoint(t)); g.add(tip);
  }
  return g;
}

export function buildFridge(parent, { x, z, rotY }) {
  const group = new T.Group(); group.name = 'fridge'; group.position.set(x, 0, z); group.rotation.y = rotY; parent.add(group);
  const W = .7, H = 1.78, D = .72, t = .035;
  // Hollow carcass so the interior is visible when the door opens.
  part(group, W, H, t, 0, H / 2, -D / 2 + t / 2, shell);
  for (const s of [-1, 1]) part(group, t, H, D, s * (W / 2 - t / 2), H / 2, 0, shell);
  part(group, W, t, D, 0, H - t / 2, 0, shell); part(group, W, .08, D, 0, .04, 0, shell);
  part(group, W - 2 * t, H - .12, .01, 0, H / 2, -D / 2 + t + .005, liner);
  for (const s of [-1, 1]) part(group, .01, H - .12, D - t, s * (W / 2 - t - .005), H / 2, .0, liner);
  for (const y of [.52, .98, 1.36]) part(group, W - 2 * t - .01, .012, D - .1, 0, y, -.02, glassShelf);
  part(group, W - 2 * t - .02, .2, D - .12, 0, .2, -.02, new T.MeshStandardMaterial({ color: 0xdfe9e8, roughness: .2, transparent: true, opacity: .55 }));
  const light = new T.PointLight(0xfff1dc, .6, 1.3, 2); light.position.set(0, 1.55, .05); group.add(light);

  // Door pivots on the hinge edge; opening swings the free edge out along +z.
  const hinge = new T.Group(); hinge.position.set(W / 2, 0, D / 2); group.add(hinge);
  const door = new T.Group(); hinge.add(door);
  part(door, W, H - .02, .05, -W / 2, H / 2, .025, shell);
  part(door, W - .08, H - .2, .012, -W / 2, H / 2, -.006, liner);
  for (const y of [.55, 1.0, 1.4]) part(door, W - .14, .1, .07, -W / 2, y, -.05, glassShelf);
  const handle = part(door, .025, .42, .03, -W + .06, 1.12, .07, steel);
  for (const y of [.93, 1.31]) part(door, .025, .02, .04, -W + .06, y, .05, steel);
  part(door, .14, .05, .006, -W / 2, 1.62, .052, new T.MeshStandardMaterial({ color: 0x3a4447, roughness: .5 }));

  const coke = cokeCan(); coke.position.set(.12, .98 + .061 + .006, -.02); group.add(coke);
  const ban = banana(); ban.position.set(-.12, .98 + .026, -.03); ban.rotation.y = .35; group.add(ban);
  const milk = part(group, .075, .2, .075, -.17, 1.36 + .106, -.12, new T.MeshStandardMaterial({ color: 0xf4f1e8, roughness: .7 }));
  part(group, .076, .05, .076, -.17, 1.36 + .17, -.12, new T.MeshStandardMaterial({ color: 0x3f7fb8, roughness: .6 }));
  const jar = new T.Mesh(new T.CylinderGeometry(.045, .045, .11, 16), new T.MeshStandardMaterial({ color: 0xa6402e, roughness: .4 })); jar.position.set(.1, .52 + .061, -.1); group.add(jar);
  milk.name = 'milk';

  let angle = 0;
  const api = {
    group, hinge, coke, banana: ban, light,
    hitMeshes: [],
    get doorAngle() { return angle; },
    setDoor(a) { angle = a; hinge.rotation.y = a; },
    // Interior camera on the inside of the door, looking back at the middle shelf.
    camera() { return { pos: api.local(0, 1.3, .31), target: api.local(0, 1.02, -.06), fov: 68 }; },
    // Points in world space used by the robot behaviours.
    local(x, y, z) { group.updateWorldMatrix(true, false); return group.localToWorld(new T.Vector3(x, y, z)); },
    handleWorld() { handle.updateWorldMatrix(true, false); return handle.getWorldPosition(new T.Vector3()); },
  };
  group.traverse(o => { if (o.isMesh) { api.hitMeshes.push(o); o.userData.interactive = 'fridge'; } });
  return api;
}
