// Office spatial study (office-spatial-map.vercel.app, v0.5), re-authored as a readable module.
// Same footprint, rooms, furniture positions and materials as the study. Changes for the desktop
// concept: the placeholder fridge box is gone (fridge.js adds an interactive one), the kitchen's
// last glass panel slides open as a door, and the dimension annotations are left out.
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DIM = { width: 14.2, length: 36.6, ceiling: 3.15, columnDiameter: .78 };
const L = { columnX: -5.5, windowX: -5.2, innerX: -1.25, tableLength: 6.25, chairsPerSide: 6, sectionZ: [3.65, -4.05, -11.75], dividerZ: 8.15 };
const storageZ = L.sectionZ.map((z, i, a) => i < a.length - 1 ? (z + a[i + 1]) / 2 : z - (a[i - 1] - z) / 2);

export const ZONES = {
  lounge: { title: 'Window lounge', center: [-2.5, 15.75] },
  cafe: { title: 'Café', center: [-2, 10.65] },
  kitchen: { title: 'Glass kitchen', center: [5.1, 10.7] },
  booths: { title: 'Timber booths', center: [4.8, 4.7] },
  phone: { title: 'Phone rooms', center: [5.1, -.875] },
  meeting: { title: 'The Club', center: [5.1, -8.8] },
  work: { title: 'Open workspace', center: [-3.2, -4.4] },
};

export function buildOffice() {
  const layers = Object.fromEntries(['architecture', 'furniture', 'lights', 'services', 'ceiling', 'cutaway', 'blinds'].map(k => [k, new T.Group()]));
  for (const [k, g] of Object.entries(layers)) g.name = k;
  const byName = {};
  let seed = 1948;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0, seed / 4294967296);

  function canvasTexture(size, draw, repeat = [1, 1], srgb = true) {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(...repeat);
    if (srgb) t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  const concreteTex = canvasTexture(256, (g, w) => { g.fillStyle = '#aaa79f'; g.fillRect(0, 0, w, w); for (let i = 0; i < 8500; i++) { const v = Math.floor(100 + rand() * 90); g.fillStyle = `rgba(${v},${v},${v},.2)`; g.fillRect(rand() * w, rand() * w, 1 + rand() * 3, 1 + rand() * 3); } }, [1, 2]);
  const woodTex = canvasTexture(512, (g, w) => { g.fillStyle = '#c6a16f'; g.fillRect(0, 0, w, w); for (let i = 0; i < 320; i++) { g.strokeStyle = `rgba(102,69,34,${.025 + rand() * .055})`; const x = rand() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 12, 180, x - 10, 300, x + 7, w); g.stroke(); } });
  const oakTex = canvasTexture(1024, (g, w) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(33, ${29 + rand() * 8}%, ${58 + rand() * 8}%)`; g.fillRect(i * 128, 0, 128, w);
      g.strokeStyle = 'rgba(73,46,27,.33)'; g.lineWidth = 1.4; g.strokeRect(i * 128 + .7, 0, 126.6, w);
      const joint = i % 3 * 280 + 170; g.beginPath(); g.moveTo(i * 128, joint); g.lineTo(i * 128 + 128, joint); g.stroke();
      for (let j = 0; j < 55; j++) { const x = i * 128 + rand() * 126; g.strokeStyle = 'rgba(96,64,33,.07)'; g.lineWidth = .5 + rand(); g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 3, 300, x - 3, 800, x + 1, w); g.stroke(); }
    }
  }, [DIM.width / 1.6, DIM.length / 2.4]);
  const tileTex = canvasTexture(256, (g, w) => { g.fillStyle = '#514d43'; g.fillRect(0, 0, w, w); for (let x = 0; x < w; x += 32) for (let y = 0; y < w; y += 32) { g.fillStyle = `hsl(36,12%,${55 + rand() * 12}%)`; g.fillRect(x + 2, y + 2, 27, 27); } }, [8, 10]);
  const meshTex = canvasTexture(64, (g, w) => { g.fillStyle = '#444'; g.fillRect(0, 0, w, w); g.fillStyle = 'white'; for (let i = 0; i < w; i += 4) { g.fillRect(i, 0, 1.5, w); g.fillRect(0, i, w, 1.5); } }, [2, 3], false);

  const S = (o) => new T.MeshStandardMaterial(o);
  const m = {
    white: S({ color: 0xeeeae1, roughness: .68 }), wall: S({ color: 0xedeee7, roughness: .91 }), black: S({ color: 0x222727, roughness: .64 }),
    timber: S({ map: woodTex, roughness: .67 }), darkWood: S({ map: woodTex, color: 0x966448, roughness: .65 }),
    concrete: S({ map: concreteTex, bumpMap: concreteTex, bumpScale: .012, roughness: .95 }),
    fabric: S({ color: 0x948b86, roughness: 1 }), clay: S({ color: 0x854f4b, roughness: 1 }), greyPad: S({ color: 0x645f5c, roughness: 1 }),
    mesh: S({ color: 0xa1a39f, alphaMap: meshTex, alphaTest: .4, side: T.DoubleSide, roughness: .9 }),
    glass: S({ color: 0xb7d1d1, transparent: true, opacity: .13, roughness: .15, depthWrite: false, side: T.DoubleSide }),
    steel: S({ color: 0xa4acac, metalness: .65, roughness: .48 }), red: S({ color: 0xad3524, roughness: .56, metalness: .25 }),
    green: S({ color: 0x335537, roughness: .83, side: T.DoubleSide }), lightGreen: S({ color: 0x678147, roughness: .9, side: T.DoubleSide }),
    soil: S({ color: 0x3d3326, roughness: 1 }), rug: S({ color: 0x696861, roughness: 1 }), greyDoor: S({ color: 0x737e83, roughness: .7 }),
    screen: S({ color: 0x0c1016, roughness: .22 }), glow: new T.MeshBasicMaterial({ color: 0xffde9e }),
    water: S({ color: 0xabc3c8, transparent: true, opacity: .62, roughness: .2 }),
  };
  const arch = layers.architecture, furn = layers.furniture;

  function add(name, geo, pos, mat, parent) {
    const mesh = new T.Mesh(geo, mat); mesh.name = name; mesh.position.set(...pos);
    mesh.castShadow = !mat.transparent; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const box = (name, w, h, d, x, y, z, mat = m.white, parent = furn, radius = 0) =>
    add(name, radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new T.BoxGeometry(w, h, d), [x, y, z], mat, parent);
  const cyl = (name, r, h, x, y, z, mat = m.white, parent = furn, rTop = r, seg = 20) =>
    add(name, new T.CylinderGeometry(rTop, r, h, seg), [x, y, z], mat, parent);
  function rod(name, a, b, r, mat, parent = furn) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b);
    const c = cyl(name, r, va.distanceTo(vb), 0, 0, 0, mat, parent, r, 8);
    c.position.copy(va).add(vb).multiplyScalar(.5); c.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.sub(va).normalize()); return c;
  }
  function entity(name, parent, pos = [0, 0, 0], rotY = 0) {
    const g = new T.Group(); g.name = name; g.position.set(...pos); g.rotation.y = rotY; parent.add(g); byName[name] = g; return g;
  }
  const wall = (x, z, w, d, h = DIM.ceiling, mat = m.wall) => box('wall', w, h, d, x, h / 2, z, mat, arch);
  function glazing(name, x, z, length, alongZ = true, blinds = false, openPanel = -1) {
    const g = entity(name, arch, [x, 0, z], alongZ ? 0 : Math.PI / 2);
    const h = blinds ? 3.04 : 2.72, n = Math.ceil(length / (blinds ? 1.52 : 1.05)), pw = length / n;
    for (let i = 0; i < n; i++) {
      const c = -length / 2 + pw * (i + .5);
      // An open sliding door parks its leaf just inside the neighbouring fixed panel.
      if (i === openPanel) box('sliding-door', .025, h, pw - .045, .06, h / 2 + .035, c - pw * .95, m.glass, g);
      else box('glass-panel', .025, h, pw - .045, 0, h / 2 + .035, c, m.glass, g);
      if (blinds) {
        const b = new T.Group(); b.position.copy(g.position); b.rotation.copy(g.rotation); layers.blinds.add(b);
        box('roller-blind', .012, 1.72, pw - .055, .06, 2.18, c, S({ color: 0xe4e6de, transparent: true, opacity: .45, roughness: 1, depthWrite: false, side: T.DoubleSide }), b);
      }
    }
    for (let i = 0; i <= n; i++) box('mullion', .065, h + .08, .043, 0, h / 2 + .04, -length / 2 + pw * i, blinds ? m.white : m.black, g);
    for (const y of [.035, h + .05]) box('glazing-rail', .067, .06, length, 0, y, 0, blinds ? m.white : m.black, g);
    return g;
  }
  function sign(text, w, h, color, bg = null) {
    const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w);
    const g = c.getContext('2d'); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
    g.fillStyle = color; g.font = `${Math.floor(c.height * .65)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: t, transparent: true, side: T.DoubleSide, depthWrite: false }));
  }
  function door(name, x, z, text) {
    const g = entity(name, arch);
    box('door-leaf', .055, 2.12, .82, x, 1.06, z, m.greyDoor, g);
    for (const o of [-.44, .44]) box('door-frame', .075, 2.18, .045, x - .025, 1.09, z + o, m.steel, g);
    box('door-frame', .075, .045, .92, x - .025, 2.18, z, m.steel, g);
    box('door-handle', .12, .026, .12, x - .12, 1, z - .29, m.steel, g);
    const s = sign(text, .32, .23, '#eeeeee'); s.rotation.y = -Math.PI / 2; s.position.set(x - .041, 1.65, z); g.add(s);
  }
  function sideTable(x, z, low = false) {
    const h = low ? .42 : .61;
    cyl('side-table-base', .265, .02, x, .025, z); cyl('offset-stem', .025, h - .025, x + .13, h / 2, z);
    cyl('side-table-top', .28, .024, x, h, z).scale.x = 1.2;
  }
  // Chairs a robot can pick up stay separate objects (merged per chair) instead of joining the static batches.
  const chairs = [];
  function movable(g, kind, x, z, rot) { g.userData.chair = true; chairs.push({ group: g, kind, home: { x, z, rot } }); }
  function cafeChair(x, z, rot = 0, arms = false, parent = furn, pick = false) {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = rot; parent.add(g); if (pick) movable(g, 'cafe', x, z, rot);
    box('cafe-seat', .48, .065, .45, 0, .46, 0, m.fabric, g, .055);
    box('cafe-back', .46, .36, .068, 0, .7, .215, m.fabric, g, .065).rotation.x = -.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod('cafe-leg', [sx * .21, .44, sz * .18], [sx * .265, .03, sz * .27], .014, m.black, g);
    if (arms) for (const sx of [-1, 1]) { rod('arm-front', [sx * .29, .44, -.2], [sx * .29, .65, -.2], .012, m.black, g); rod('arm-rail', [sx * .29, .65, -.2], [sx * .29, .65, .24], .012, m.black, g); }
  }
  function plant(x, z, scale = 1, kind = 'broad') {
    const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale); furn.add(g);
    cyl('white-planter', .22, .54, 0, .27, 0, m.white, g, .28, 24); cyl('soil', .25, .018, 0, .535, 0, m.soil, g);
    const leaf = new T.SphereGeometry(1, 8, 6), tall = kind === 'tall';
    for (let i = 0; i < (tall ? 7 : 14); i++) {
      const a = i * 2.4, r = .25 + rand() * .28, y = tall ? 1.15 + rand() * .85 : .68 + rand() * .55, end = [Math.sin(a) * r, y, Math.cos(a) * r];
      rod('plant-stem', [0, .5, 0], end, .009, m.green, g);
      const l = add('plant-leaf', leaf, end, i % 4 ? m.green : m.lightGreen, g);
      l.scale.set(tall ? .14 : .17, tall ? .37 : .27, .025); l.rotation.set(.5 + rand(), a, .3);
    }
  }
  function taskChair(x, z, rot, parent, pick = false) {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = rot; parent.add(g); if (pick) movable(g, 'task', x, z, rot);
    cyl('chair-gas-lift', .025, .32, 0, .24, 0, m.steel, g);
    box('chair-seat', .47, .075, .45, 0, .455, 0, m.fabric, g, .035);
    box('mesh-back', .39, .54, .018, 0, .77, .235, m.mesh, g, .07);
    for (const s of [-1, 1]) {
      rod('back-frame', [s * .23, .5, .2], [s * .25, 1.06, .29], .022, m.black, g);
      box('armrest', .065, .028, .29, s * .285, .65, -.015, m.black, g, .01);
      rod('armrest-support', [s * .23, .45, .02], [s * .285, .65, .02], .017, m.black, g);
    }
    rod('back-top', [-.25, 1.06, .29], [.25, 1.06, .29], .021, m.black, g);
    for (const s of [-1, 1]) rod('back-brace', [0, .42, .22], [s * .2, .99, .29], .017, m.black, g);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * .4, x2 = Math.sin(a) * .28, z2 = Math.cos(a) * .28;
      rod('star-base', [0, .17, 0], [x2, .08, z2], .022, m.black, g);
      cyl('castor', .034, .04, x2, .04, z2, m.black, g, .034, 10).rotation.z = Math.PI / 2;
    }
  }

  // Shell: slab, oak floor, window facade, cut-down outer walls, entry.
  box('slab', 14.45, .22, 36.85, 0, -.13, 0, m.concrete, arch);
  const floor = add('oak-floor', new T.PlaneGeometry(14.2, 36.6), [0, -.009, 0], S({ map: oakTex, roughness: .68 }), arch);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  glazing('long-window-facade', -7.09, 0, 36.6, true, true);
  box('end-wall', 14.2, DIM.ceiling, .14, 0, DIM.ceiling / 2, 18.25, m.wall, layers.cutaway);
  wall(0, 18.25, 14.2, .14, .15); wall(7.08, -2.05, .14, 32.5, 1.05); wall(7.08, 17.33, .14, 1.9, 1.05); wall(0, -18.25, 14.2, .14, 1.05);
  glazing('entry', 7.08, 15.32, 1.95, true);
  box('entry-threshold', .45, .015, 1.95, 7.1, .012, 15.32, m.steel, arch);
  for (const z of [15.15, 15.5]) rod('entry-pull', [7.01, .8, z], [7.01, 1.65, z], .014, m.black, arch);
  [17, L.dividerZ, ...storageZ].forEach((z, i) => {
    const name = i === 0 ? 'column-lounge' : i === 1 ? 'column-divider' : `facade-column-${i}`;
    const g = entity(name, arch, [L.columnX, 0, z]), r = DIM.columnDiameter / 2;
    cyl('round-concrete-column', r, 2.75, 0, 1.375, 0, m.concrete, g, r, 32);
    cyl('column-base-band', r + .007, .065, 0, .0325, 0, m.steel, g);
    box('drop-capital', 2.5, .4, 1.85, 0, 2.95, 0, m.concrete, entity(`${name}-capital`, layers.services, [L.columnX, 0, z]));
  });

  // Window lounge: tiered bench, acoustic wall, rug, poufs, coffee point.
  const benchX = L.columnX + 2.81, bench = entity('tiered-bench', furn, [benchX, 0, 17.22]);
  box('lower-white-tier', 4.75, .42, 1.55, 0, .21, 0, m.white, bench); box('upper-white-tier', 4.75, .36, .76, 0, .6, .395, m.white, bench);
  for (let i = 0; i < 5; i++) box('upper-cushion', .62, .1, .45, -1.8 + i * .88, .83, .4, i % 2 ? m.clay : m.greyPad, bench, .07);
  for (let i = 0; i < 3; i++) box('lower-cushion', .62, .1, .45, -.95 + i * .92, .47, -.42, i % 2 ? m.greyPad : m.clay, bench, .07);
  const acoustic = entity('acoustic-wall', layers.cutaway);
  box('acoustic-backing', 7.85, 2.72, .06, -2.225, 1.36, 18.11, m.black, acoustic);
  for (let i = 0; i < 169; i++) box('vertical-rib', .025, 2.72, .035, -6.1 + i * .046, 1.36, 18.06, m.black, acoustic);
  box('lounge-rug', 4.75, .018, 3.15, benchX, .011, 14.75, m.rug, entity('lounge-rug', furn));
  [[-4.05, 15.05], [-2.35, 14.1], [-.85, 15.15]].forEach(([x, z], i) => {
    x += benchX + 2.5;
    add('rounded-pouf', new T.SphereGeometry(1, 24, 16), [0, .23, 0], m.clay, entity(`pouf-${i + 1}`, furn, [x, 0, z])).scale.set(.37, .25, .34);
    sideTable(x + .48, z - .35);
  });
  const coffee = entity('coffee-point', furn, [L.columnX, 0, 15.98]);
  box('coffee-plinth', .56, .87, .57, 0, .435, 0, m.black, coffee); box('coffee-machine', .5, .59, .49, 0, 1.185, 0, m.steel, coffee, .016);
  box('coffee-panel', .43, .5, .02, 0, 1.19, -.255, m.black, coffee);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box('coffee-button', .035, .045, .008, -.09 + c * .08, 1.29 + r * .062, -.27, m.white, coffee);
  box('coffee-spout', .025, .07, .08, 0, 1, -.28, m.steel, coffee);
  box('charge-pedestal', .35, 1.1, .3, L.columnX, .55, 17.85, m.white, entity('charge-pedestal', furn));

  // Café: window armchairs, three round tables, planted window edge.
  [[-5.82, 14.9], [-5.85, 12.75]].forEach(([x, z]) => { cafeChair(x, z, -Math.PI / 2, true); sideTable(x + .55, z - .55, true); });
  [[-2.15, 11.25], [.1, 10.65], [-2.5, 8.95]].forEach(([x, z], i) => {
    const t = entity(`cafe-table-${i + 1}`, furn);
    cyl('tapered-table-pedestal', .27, .71, x, .355, z, m.white, t, .14, 32); cyl('round-tabletop', .59, .033, x, .74, z, m.white, t, .59, 48);
    for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2; cafeChair(x + Math.sin(a) * .86, z + Math.cos(a) * .86, a, false, furn, true); }
  });
  [[-5.55, 12.9, 1.15, 'tall'], [-5.8, 11.9, .95], [-5, 12.3, .85], [-6.5, 10, .8, 'tall'], [-6.6, 9, .9, 'tall'], [.82, 8.55, 1, 'tall'], [.35, 9.1, .65], [-6.3, 17.7, .65]].forEach(p => plant(...p));

  // Glass kitchen. The last panel of the café-side glazing is the sliding door.
  wall(7, 10.68, .14, 5.2); wall(5.05, 13.27, 4, .14);
  glazing('kitchen', 3.1, 10.69, 5.16, true, false, 4);
  glazing('kitchen-glazed-return', 5.02, 8.11, 3.88, false);
  box('kitchen-floor', 3.82, .012, 5.03, 5.05, .006, 10.69, S({ map: tileTex, roughness: .93 }));
  box('service-cabinets', .64, .87, 3.6, 6.56, .435, 10.5, m.timber); box('service-countertop', .69, .03, 3.64, 6.54, .885, 10.5, m.white);
  for (let z = 8.95; z < 12.25; z += .6) { box('cabinet-gap', .006, .78, .012, 6.228, .43, z, m.darkWood); rod('cabinet-handle', [6.18, .75, z + .15], [6.18, .75, z + .3], .009, m.steel); }
  box('sink-basin', .4, .015, .53, 6.51, .905, 10.45, m.steel);
  rod('tap-stem', [6.7, .92, 10.6], [6.7, 1.2, 10.6], .012, m.steel); rod('tap-neck', [6.7, 1.2, 10.6], [6.42, 1.2, 10.6], .012, m.steel);
  box('kitchen-island', 1.1, .87, 1.8, 4.65, .435, 10.65, m.timber, entity('kitchen-island', furn)); box('island-top', 1.16, .03, 1.86, 4.65, .885, 10.65, m.timber);
  const storage = entity('kitchen-storage', furn);
  for (const x of [5.02, 5.65]) {
    for (const o of [-.29, .29]) box('cubby-upright', .028, 2.4, .58, x + o, 1.2, 8.53, m.timber, storage);
    for (const y of [.03, .55, 1, 1.45, 1.92, 2.4]) box('cubby-shelf', .6, .026, .58, x, y, 8.53, m.timber, storage);
  }
  for (const y of [.74, 1.2]) { box('microwave', .48, .3, .4, 5.62, y, 8.53, m.white, storage); box('microwave-window', .38, .22, .012, 5.62, y, 8.31, m.screen, storage); }
  for (let i = 0; i < 4; i++) { const x = 3.5 + i * .35; cyl('water-jug', .135, .4, x, .24, 8.4, m.water, storage, .11); cyl('jug-cap', .035, .045, x, .48, 8.4, m.lightGreen, storage); }
  for (const z of [9.3, 9.93]) { box('water-dispenser', .36, 1, .34, 6.08, .5, z, m.white, storage, .04); box('dispenser-tap', .17, .1, .04, 5.88, .68, z, m.greyDoor, storage); }

  // Timber booths, service core wall, WC and exit doors.
  box('booth-and-recess-floor', 3.87, .013, 6.42, 5.03, .01, 4.87, m.darkWood);
  wall(5.38, 5.09, .12, 6.42);
  [5.9, 3.5].forEach((z, i) => {
    const b = entity(`booth-${i + 1}`, furn);
    for (const s of [-1, 1]) {
      box('bench-plinth', 1.87, .35, .51, 4.14, .185, z + s * .75, m.timber, b);
      box('bench-cushion', 1.88, .105, .55, 4.14, .4075, z + s * .75, m.fabric, b, .025);
      box('bench-back', 1.86, .47, .105, 4.14, .64, z + s, m.fabric, b, .024);
    }
    box('booth-table', 1.62, .04, .73, 4.12, .73, z, m.timber, b, .05);
    for (const x of [3.54, 4.7]) cyl('white-table-leg', .029, .7, x, .35, z, m.white, b);
    box('tv-backplate', .08, .54, .93, 5.28, 1.49, z, m.black, b); box('tv-screen', .013, .5, .88, 5.23, 1.49, z, m.screen, b);
  });
  [2.3, 4.7, 7.1].forEach((z, i) => {
    const d = entity(`booth-divider-${i}`, furn);
    box('planter-divider', 2.12, .91, .27, 4.14, .455, z, m.timber, d); box('planter-soil', 1.94, .02, .18, 4.14, .915, z, m.soil, d);
    for (let j = 0; j < 13; j++) { const h = .48 + rand() * .45; box('snake-leaf', .057, h, .012, 3.3 + j * .14, .91 + h / 2, z + (j % 2 ? .05 : -.05), j % 3 ? m.green : m.lightGreen, d, .005).rotation.z = (rand() - .5) * .23; }
    for (const x of [3.11, 5.18]) box('timber-upright', .08, 2.48, .08, x, 1.24, z, m.timber, arch);
    box('cross-beam', 2.15, .09, .09, 4.14, 2.49, z, m.timber, arch);
  });
  for (const x of [3.11, 5.18]) box('longitudinal-beam', .08, .09, 4.88, x, 2.49, 4.7, m.timber, arch);
  door('wc-door', 5.28, 7.7, 'WC'); door('exit-door', 5.28, 1.72, 'EXIT');

  // Phone rooms 1-3 with coloured numbered glass doors.
  [{ n: 3, z: .575, color: '#cc4234' }, { n: 2, z: -.875, color: '#20a9b0' }, { n: 1, z: -2.325, color: '#df932b' }].forEach(({ n, z, color }) => {
    const r = entity(`phone-${n}`, arch);
    box('phone-floor', 2.08, .018, 1.38, 4.2, .01, z, m.darkWood, r); box('phone-back', .11, 2.73, 1.45, 5.26, 1.365, z, m.wall, r);
    for (const s of [-1, 1]) box('phone-side', 2.16, 2.73, .085, 4.18, 1.365, z + s * .725, m.wall, r);
    box('door-header', .08, .075, 1.42, 3.1, 2.71, z, m.black, r);
    for (const s of [-.69, .69]) box('door-jamb', .08, 2.71, .06, 3.1, 1.355, z + s, m.black, r);
    const leaf = new T.Group(); leaf.position.set(3.1, 0, z + .65); leaf.rotation.y = -.48; r.add(leaf);
    box('numbered-glass-door', .03, 2.58, 1.23, 0, 1.31, -.615, m.glass, leaf);
    const num = sign(String(n), 1.08, 2.4, '#ffffffb8', color); num.rotation.y = -Math.PI / 2; num.position.set(-.018, 1.34, -.615); leaf.add(num);
    for (const e of [0, -1.23]) box('door-edge', .06, 2.62, .04, 0, 1.33, e, m.black, leaf);
    box('phone-shelf', .46, .035, .86, 4.84, .76, z, m.timber); cafeChair(4.3, z, -Math.PI / 2);
  });
  [-3.09, -8.7, -14.9].forEach(z => wall(5.05, z, 3.9, .1, 2.73));
  [{ id: 'meeting-club', z: -5.88, length: 5.53 }, { id: 'meeting-far', z: -11.8, length: 6.1 }].forEach(({ id, z, length }) => {
    glazing(id, 3.1, z, length);
    const t = entity(`${id}-table`, furn);
    box('meeting-table', 1.15, .05, 2.7, 5, .725, z, m.white, t, .08);
    for (const o of [-.9, .9]) box('table-leg', .08, .7, .72, 5, .35, z + o, m.white, t);
    for (const s of [-1, 1]) for (const o of [-.82, .82]) cafeChair(5 + s * .9, z + o, s > 0 ? Math.PI / 2 : -Math.PI / 2);
  });
  box('club-sign-panel', .04, 2.65, .63, 3.06, 1.325, -5.75, m.greyDoor, arch);
  const club = sign('THE CLUB', 1.7, .31, '#dddddd'); club.rotation.set(0, -Math.PI / 2, Math.PI / 2); club.position.set(3.028, 1.4, -5.75); arch.add(club);

  // Red divider shelving between café and workspace.
  const dividerStart = L.columnX + DIM.columnDiameter / 2 + .067, dividerEnd = .05;
  const divider = entity('red-divider', furn, [(dividerStart + dividerEnd) / 2, 0, L.dividerZ]);
  divider.scale.x = (dividerEnd - dividerStart) / 5.99;
  const perf = canvasTexture(64, (g, w) => { g.fillStyle = 'white'; g.fillRect(0, 0, w, w); g.fillStyle = 'black'; for (const [x, y] of [[16, 16], [48, 48]]) { g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); } }, [80, 18], false);
  add('perforated-steel', new T.PlaneGeometry(5.95, 1.21), [0, 1.91, -.29], S({ color: 0xb43525, alphaMap: perf, alphaTest: .5, side: T.DoubleSide, roughness: .58 }), divider);
  for (let i = 0; i < 6; i++) box('white-cabinet-door', .97, .94, .55, -2.47 + i * .99, .81, 0, m.white, divider);
  for (const y of [1.31, 1.91, 2.53]) box('red-open-shelf', 5.99, .025, .62, 0, y, 0, m.red, divider);
  for (let i = 0; i <= 6; i++) for (const o of [-.31, .31]) { cyl('red-pole', .017, DIM.ceiling, -2.99 + i * .996, DIM.ceiling / 2, o, m.red, divider, .017, 8); cyl('pole-footplate', .042, .009, -2.99 + i * .996, .005, o, m.red, divider); }
  for (let i = 0; i < 15; i++) box('book', .035, .28 + i % 3 * .015, .18, -2.7 + i * .045, 1.47, .03, i % 4 ? m.white : m.greyDoor, divider);
  const coat = entity('coat-tree', furn, [.45, 0, 8.6]);
  cyl('coat-stem', .022, 1.64, 0, .82, 0, m.black, coat);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, tip = [.28 * Math.cos(a), 1.8, .28 * Math.sin(a)];
    rod('coat-branch', [0, 1.23, 0], tip, .017, m.black, coat); add('coat-knob', new T.SphereGeometry(.048, 10, 8), tip, m.darkWood, coat);
    rod('coat-foot', [0, .2, 0], [.28 * Math.cos(a), .01, .28 * Math.sin(a)], .017, m.black, coat);
  }

  // Open workspace: two bench rows, three sections, six chairs per side.
  const pitch = L.tableLength / L.chairsPerSide;
  for (const [name, x] of [['window-benches', L.windowX], ['inner-benches', L.innerX]]) {
    const row = entity(name, furn);
    L.sectionZ.forEach((zc, j) => {
      const desks = entity(`${name}-table-${j + 1}`, row), seats = entity(`${name}-seats-${j + 1}`, row);
      for (let k = 0; k < L.chairsPerSide; k++) {
        const z = zc - L.tableLength / 2 + (k + .5) * pitch;
        box('desk-module', 1.45, .035, pitch - .004, x, .7325, z, m.white, desks);
        box('cable-lid', .14, .008, .22, x, .754, z, m.steel, desks);
        for (const s of [-1, 1]) {
          taskChair(x + s * 1.04, z, s * Math.PI / 2, seats, name === 'inner-benches' && s === 1);
          if ((k + j * 3 + (name === 'window-benches' ? 2 : 0)) % 5 === 0) {
            const lap = new T.Group(); lap.position.set(x + s * .38, .751, z); lap.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2; desks.add(lap);
            box('laptop-keyboard', .3, .013, .2, 0, .0065, 0, m.greyDoor, lap);
            box('laptop-screen', .3, .19, .012, 0, .103, .08, m.screen, lap).rotation.x = -.15;
          }
        }
      }
      for (const o of [-3, 0, 3]) for (const s of [-1, 1]) box('square-desk-leg', .045, .715, .045, x + s * .62, .3575, zc + o, m.white, desks);
      const sx = name === 'window-benches' ? L.columnX + DIM.columnDiameter / 2 + .402 : x;
      box('low-storage', .63, .61, .43, sx, .305, storageZ[j], m.white, entity(`${name}-storage-${j + 1}`, row));
    });
  }

  // Pendants and ceiling services (hidden in the desktop's cutaway view by default).
  const profile = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; profile.push(new T.Vector2(.025 + .29 * Math.sin(a), .255 * Math.cos(a))); }
  const shade = new T.LatheGeometry(profile, 28), shadeMat = S({ color: 0x898e80, roughness: .72, side: T.DoubleSide });
  const innerZ = [16, 12.1, 8.7, 5.2, 1.7, -1.8, -5.3, -8.8, -12.3, -15.8];
  const windowZ = [16, 12.1, L.dividerZ + 1.3, 5.2, 1.7, -1.8, -5.3, storageZ[1] - 1.3, -12.3, storageZ[2] + 1.3];
  for (const [name, x, zs] of [['window', L.windowX, windowZ], ['inner', L.innerX, innerZ]]) zs.forEach((z, i) => {
    const g = entity(`${name}-pendant-${i + 1}`, layers.lights);
    rod('pendant-cable', [x, 2.66, z], [x, 3.14, z], .007, m.black, g); cyl('socket', .042, .09, x, 2.685, z, m.white, g);
    add('dome-shade', shade, [x, 2.38, z], shadeMat, g);
    add('warm-shade-interior', new T.CircleGeometry(.297, 24), [x, 2.385, z], m.glow, g).rotation.x = Math.PI / 2;
  });
  const svc = layers.services;
  box('galvanized-main-duct', .72, .38, 30, 2.32, 2.82, -.8, m.steel, svc); box('white-cable-tray', .38, .07, 32, 2.83, 2.5, 0, m.white, svc);
  for (let z = -15; z < 15; z += 1.4) { box('duct-band', .75, .405, .025, 2.32, 2.82, z, m.steel, svc); box('vent-face', .025, .25, .43, 1.942, 2.83, z + .4, m.white, svc); }
  for (const x of [L.windowX + 1.35, -.65]) {
    rod('red-sprinkler-main', [x, 3.03, -17], [x, 3.03, 17], .028, m.red, svc);
    for (const z of [-14, -8, -2, 4, 10, 16]) { rod('sprinkler-branch', [x, 3.03, z], [x + 1.1, 3.03, z], .018, m.red, svc); rod('sprinkler-drop', [x + 1.1, 3.03, z], [x + 1.1, 2.88, z], .018, m.red, svc); }
  }
  add('exposed-concrete-slab', new T.PlaneGeometry(14.2, 36.6), [0, 3.15, 0], m.concrete, layers.ceiling).rotation.x = Math.PI / 2;

  const inChair = o => { for (let p = o.parent; p; p = p.parent) if (p.userData.chair) return true; return false; };
  // Merge opaque static meshes per material: thousands of parts become a few draw calls.
  for (const layer of [arch, furn, layers.lights, svc]) {
    layer.updateMatrixWorld(true);
    const groups = new Map(), merged = [];
    layer.traverse(o => {
      if (!o.isMesh || o.material.transparent || o.material.side === T.DoubleSide || inChair(o)) return;
      if (!groups.has(o.material)) groups.set(o.material, []);
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      groups.get(o.material).push(g.index ? g.toNonIndexed() : g); merged.push(o);
    });
    for (const o of merged) o.removeFromParent();
    for (const [mat, geos] of groups) {
      const mesh = add('static-batch', mergeGeometries(geos, false), [0, 0, 0], mat, layer); mesh.castShadow = true;
      for (const g of geos) g.dispose();
    }
  }
  layers.ceiling.visible = layers.cutaway.visible = layers.blinds.visible = false;
  layers.lights.visible = layers.services.visible = false;
  for (const c of chairs) {
    const g = c.group, inv = g.matrixWorld.clone().invert(), byMat = new Map(), parts = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(geo.index ? geo.toNonIndexed() : geo); parts.push(o);
    });
    for (const o of parts) o.removeFromParent();
    for (const [mat, geos] of byMat) add('chair-part', mergeGeometries(geos, false), [0, 0, 0], mat, g);
  }
  return { layers, byName, materials: m, chairs };
}
