// Dimensional Desktop concept: an isometric office where robots are selected like Sims and tasked
// through chained pie menus, a Sims-style action queue and a command line backed by Claude.
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildOffice, ZONES } from './office.js';
import { buildFridge } from './fridge.js';
import { buildPrinter } from './printer.js';
import { buildCostmap, planPath, snapToFree, costmapTexture } from './nav.js';
import { loadTemplate, Robot } from './robots.js';
import { findRun, kindOf, Live } from './live.js';

const $ = s => document.querySelector(s);
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const UI = 1; // layer for overlays the robots' cameras must not see
const view = $('#view'), overlays = $('#overlays');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const store = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ } };

// Apps and plugins. Manipulation runs on a model app chosen per task; patrols come from Dimensional Security.
// Third-party names are concept placeholders drawn as plain monograms, not their logos.
const MARKS = {
  gi: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#121516"/><text x="12" y="15.4" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" font-weight="600" fill="#f2f4f3">GI</text></svg>',
  pi: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#f2efe8" stroke="#121516" stroke-width="1.2"/><text x="12" y="15.4" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="9" font-weight="600" fill="#121516">PI</text></svg>',
  classic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="3" fill="#0d1010" stroke="#96cde8" stroke-width="1.2"/><text x="12" y="17" text-anchor="middle" font-family="EB Garamond, Georgia, serif" font-size="14" font-weight="600" fill="#96cde8">D</text></svg>',
  security: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 21 5v6.5c0 5.3-3.8 9.4-9 11-5.2-1.6-9-5.7-9-11V5z" fill="#0d1010" stroke="#86d2a4" stroke-width="1.4"/><path d="m8 12 3 3 5-6" fill="none" stroke="#86d2a4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const MANIP_TOOLS = [
  { sig: 'open(target)', desc: 'Open hinged doors and lids', where: 'Fridge · Open the door' },
  { sig: 'grasp(object)', desc: 'Pick an item from a shelf or a print bed', where: 'Fridge · Grab, 3D printer · Extract' },
  { sig: 'close(target)', desc: 'Close what was opened', where: 'Fridge · Close the door' },
  { sig: 'hand_over(object)', desc: 'Hold the carried item out to a person', where: 'Command line · "bring it to me"' },
];
const APPS = {
  gi: { id: 'gi', name: 'General Intuition', kind: 'Manipulation model', publisher: 'General Intuition', model: true, speed: 1, policy: 'general_intuition',
    blurb: 'Default policy for doors and grasps. Every manipulation option shows its mark; hover the mark to switch models for that task.',
    tools: MANIP_TOOLS, extras: [{ key: 'pour', sig: 'pour(container)', desc: 'Pour from a can or bottle into a cup', price: '$19/mo' }, { key: 'wipe', sig: 'wipe(surface)', desc: 'Wipe a table or counter clean', price: '$19/mo' }] },
  pi: { id: 'pi', name: 'Physical Intelligence', kind: 'Manipulation model', publisher: 'Physical Intelligence', model: true, speed: .85, policy: 'physical_intelligence',
    blurb: 'Alternative manipulation policy. Pick it for any open, grasp or close from the model badge.',
    tools: MANIP_TOOLS, extras: [{ key: 'fold', sig: 'fold(cloth)', desc: 'Fold towels and shirts on a table', price: '$19/mo' }, { key: 'bimanual', sig: 'bimanual_handoff()', desc: 'Pass an item between both arms', price: '$29/mo' }] },
  classic: { id: 'classic', name: 'Dimensional Classic', kind: 'Built in', publisher: 'Dimensional', model: true, builtin: true, speed: 1.3, policy: 'dimensional_classic',
    blurb: 'Inverse kinematics and scripted grasps that ship with DimOS. Slower, fully predictable, no model calls.',
    tools: MANIP_TOOLS, extras: [] },
  security: { id: 'security', name: 'Dimensional Security', kind: 'App', publisher: 'Dimensional', policy: 'security',
    blurb: 'Patrol routes for any robot that can move. Ask the command line for a new patrol route, draw the flags, and it runs in the background.',
    tools: [
      { sig: 'draw_patrol_route()', desc: 'Drop numbered flags on the map', where: 'Command line · "create a patrol route"' },
      { sig: 'start_patrol(route)', desc: 'Loop the route until you stop it', where: 'Draw bar · Start patrol' },
      { sig: 'stop_patrol()', desc: 'End the patrol and clear the flags', where: 'Queue ×, Stop, "stop patrolling"' },
      { sig: 'patrol_status()', desc: 'Lap and next flag', where: 'Queue · background task' },
    ],
    extras: [{ key: 'checkpoint', sig: 'checkpoint_report()', desc: 'Camera check and an "all clear" at every flag', price: '$9/mo' }, { key: 'night', sig: 'night_schedule(start, end)', desc: 'Run patrols only outside office hours', price: '$9/mo' }] },
};
const owned = store('dimdesk.apps', { gi: true, pi: true, security: true, extras: [] });
const prefs = store('dimdesk.models', { open: 'gi', grasp: 'gi', close: 'gi' });
const TASKS = { open: 'Opening', grasp: 'Grasping', close: 'Closing' };
const usable = id => APPS[id]?.model && (APPS[id].builtin || owned[id]);
const modelFor = task => usable(prefs[task]) ? APPS[prefs[task]] : usable('gi') ? APPS.gi : usable('pi') ? APPS.pi : APPS.classic;
const modelChoices = () => ['gi', 'pi', 'classic'].filter(usable).map(id => APPS[id]);
const hasExtra = key => owned.extras.includes(key);

// Scene, lit like the office study.
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
view.prepend(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color(0xdeddd5);
const envFor = r => { const p = new T.PMREMGenerator(r); const t = p.fromScene(new RoomEnvironment(), .04).texture; p.dispose(); return t; };
const mainEnv = envFor(renderer); scene.environment = mainEnv; scene.environmentIntensity = .65;
scene.add(new T.HemisphereLight(0xfffdef, 0x7b8078, 1.8));
const sun = new T.DirectionalLight(0xffeedb, 2); sun.position.set(-17, 26, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 28, bottom: -28, far: 80 }); sun.shadow.normalBias = .025; sun.shadow.bias = -1.5e-4; scene.add(sun);
const fill = new T.DirectionalLight(0xe9f3fa, .8); fill.position.set(8, 10, -12); scene.add(fill);
const ground = new T.Mesh(new T.PlaneGeometry(160, 160), new T.MeshStandardMaterial({ color: 0xdeddd5, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -.245; ground.receiveShadow = true; scene.add(ground);

const office = buildOffice(); Object.values(office.layers).forEach(l => scene.add(l));
const fridge = buildFridge(scene, { x: 6.48, z: 12.85, rotY: -Math.PI / 2 });
// The printer sits on the north end of the inner desk row, facing the aisle by the red divider.
const printer = buildPrinter(scene, { x: -1.25, y: .75, z: 6.47 });

// Isometric camera: orthographic, fixed elevation, limited swing so the cut-down walls never block.
const VIEW_H = 15, ELEV = T.MathUtils.degToRad(38), AZ0 = T.MathUtils.degToRad(-135);
const camera = new T.OrthographicCamera(-1, 1, 1, -1, -100, 200); camera.layers.enable(UI);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: .12, screenSpacePanning: false, zoomToCursor: true, minZoom: .45, maxZoom: 4.5,
  minPolarAngle: Math.PI / 2 - ELEV, maxPolarAngle: Math.PI / 2 - ELEV, minAzimuthAngle: AZ0 - .95, maxAzimuthAngle: AZ0 + .95 });
controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
function aim(target, az = AZ0) {
  controls.target.copy(target);
  camera.position.copy(target).add(V(Math.sin(az) * Math.cos(ELEV), Math.sin(ELEV), Math.cos(az) * Math.cos(ELEV)).multiplyScalar(40));
  controls.update();
}
function resize() {
  const w = view.clientWidth, h = view.clientHeight, a = w / h;
  Object.assign(camera, { left: -VIEW_H * a / 2, right: VIEW_H * a / 2, top: VIEW_H / 2, bottom: -VIEW_H / 2 });
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
}
new ResizeObserver(resize).observe(view); resize();
aim(V(2.6, 0, 9.2)); camera.zoom = 1.15; camera.updateProjectionMatrix();

// Camera feeds: one small offscreen renderer draws two views per frame side by side, the selected
// robot's head camera (copied to the panel) and the camera of the active pie (copied into the pie).
const feed = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
feed.setPixelRatio(Math.min(devicePixelRatio, 2)); feed.outputColorSpace = T.SRGBColorSpace;
feed.toneMapping = T.ACESFilmicToneMapping; feed.toneMappingExposure = 1.2;
const FEED = { w: 520, h: 200, pie: 200 };
feed.setSize(FEED.w, FEED.h, false); feed.setScissorTest(true);
const feedEnv = envFor(feed);
const feedCam = new T.PerspectiveCamera(66, 1, .03, 60);
const panelCtx = $('#panel-cam').getContext('2d');
function renderView(x, w, h) {
  feedCam.aspect = w / h; feedCam.updateProjectionMatrix();
  feed.setViewport(x, 0, w, h); feed.setScissor(x, 0, w, h);
  scene.environment = feedEnv; feed.render(scene, feedCam); scene.environment = mainEnv;
}
function copyView(ctx, x, w, h) { const pr = feed.getPixelRatio(); ctx.drawImage(feed.domElement, x * pr, 0, w * pr, h * pr, 0, 0, ctx.canvas.width, ctx.canvas.height); }
function aimHead(robot, dt = 0) {
  robot.model.updateMatrixWorld(true);
  const head = robot.headWorld(), f = robot.forward();
  const want = robot.gaze ? robot.gaze.clone() : head.clone().addScaledVector(f, 3).add(V(0, -head.y * .55, 0));
  if (!robot.gazeNow || !dt) robot.gazeNow = want; else robot.gazeNow.lerp(want, Math.min(1, dt * 5));
  feedCam.fov = 66; feedCam.position.copy(head).addScaledVector(f, .03); feedCam.lookAt(robot.gazeNow);
}
function aimSource(src, dt) {
  if (src.kind === 'fixed') { const c = src.cam(); feedCam.fov = c.fov ?? 66; feedCam.position.copy(c.pos); feedCam.lookAt(c.target); return; }
  if (src.kind === 'wrist' && src.robot.tool) {
    src.robot.model.updateMatrixWorld(true);
    const cam = src.robot.model.links.right_realsense_link.getWorldPosition(V()), tool = src.robot.toolWorld('right');
    feedCam.fov = 66; feedCam.position.copy(cam).add(V(0, .03, 0)); feedCam.lookAt(tool.addScaledVector(src.robot.forward(), .05)); return;
  }
  aimHead(src.robot, dt);
}
function renderStill(w, h, aimFn) {
  feed.setSize(w, h, false); feed.setViewport(0, 0, w, h); feed.setScissor(0, 0, w, h);
  aimFn(); feedCam.aspect = w / h; feedCam.updateProjectionMatrix();
  scene.environment = feedEnv; feed.render(scene, feedCam); scene.environment = mainEnv;
  const url = feed.domElement.toDataURL('image/jpeg', .85);
  feed.setSize(FEED.w, FEED.h, false); feedCam.fov = 66;
  return url;
}
function captureFrame(robot) {
  const bin = atob(renderStill(640, 400, () => aimHead(robot)).split(',')[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

// Costmap from the static office geometry, as the planner sees it.
const isChair = o => { for (let p = o; p; p = p.parent) if (p.userData.chair) return true; return false; };
const costmap = buildCostmap([office.layers.architecture, office.layers.furniture, fridge.group, printer.group], { minX: -7.2, maxX: 7.2, minZ: -18.4, maxZ: 18.4, skip: isChair });
const cmPlane = new T.Mesh(new T.PlaneGeometry(costmap.W * costmap.cell, costmap.H * costmap.cell), new T.MeshBasicMaterial({ map: costmapTexture(costmap), transparent: true, depthWrite: false, side: T.DoubleSide }));
cmPlane.rotation.x = -Math.PI / 2; cmPlane.scale.y = -1; cmPlane.position.set(-7.2 + costmap.W * costmap.cell / 2, .03, -18.4 + costmap.H * costmap.cell / 2);
cmPlane.layers.set(UI); cmPlane.visible = false; scene.add(cmPlane);

// Movable chairs: café chairs and the aisle-side office chairs. On the floor they are costmap obstacles.
const chairs = office.chairs.map((c, i) => ({ ...c, id: i, carriedBy: null }));
const chairMeshes = [];
for (const c of chairs) c.group.traverse(o => { if (o.isMesh) { o.userData.chairRef = c; chairMeshes.push(o); } });
function updateChairObstacles() {
  costmap.setObstacles(chairs.filter(c => !c.carriedBy).map(c => { const p = c.group.getWorldPosition(V()); return { x: p.x, z: p.z, r: .33 }; }));
  cmPlane.material.map?.dispose(); cmPlane.material.map = costmapTexture(costmap); cmPlane.material.needsUpdate = true;
}
updateChairObstacles();

// Fleet.
const FLEET = [
  { id: 'R1-01', kind: 'r1', x: 2.2, z: 6.2, yaw: -Math.PI / 2 },
  { id: 'G1-01', kind: 'g1', x: .75, z: 14.3, yaw: Math.PI },
  { id: 'X2-01', kind: 'x2', x: -3.2, z: -.2, yaw: -Math.PI / 2 },
  { id: 'GO2-01', kind: 'go2', x: 2.0, z: 3.0, yaw: -Math.PI / 2 },
  { id: 'GO2-02', kind: 'go2', x: 1.9, z: -7.5, yaw: Math.PI / 2 },
];
const robots = [];
let selected = null, follow = false;
const layersOn = { paths: true };
const onUI = o => o.traverse(c => c.layers.set(UI));

// Selection marker: a floating diamond and a floor ring, on the overlay layer.
const plumb = new T.Mesh(new T.OctahedronGeometry(.11, 0), new T.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x3aa6d8, emissiveIntensity: .9, roughness: .3, metalness: .1 }));
plumb.scale.y = 1.7; plumb.layers.set(UI); scene.add(plumb);
const ring = new T.Mesh(new T.RingGeometry(.44, .5, 48), new T.MeshBasicMaterial({ color: 0x96cde8, transparent: true, opacity: .9, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.layers.set(UI); scene.add(ring);

// Agent log.
const t0 = performance.now();
function log(robot, text, kind = '') {
  const s = (performance.now() - t0) / 1000, stamp = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ul = $('#log'), li = document.createElement('li'), time = document.createElement('span'), body = document.createElement('span'), who = document.createElement('b'), msg = document.createElement('span');
  li.className = kind; time.textContent = stamp; who.textContent = robot ? robot.id : 'fleet'; msg.textContent = ` ${text}`;
  body.append(who, msg); li.append(time, body);
  ul.append(li); while (ul.children.length > 120) ul.firstChild.remove(); ul.scrollTop = ul.scrollHeight;
  return { set(t) { msg.textContent = ` ${t}`; ul.scrollTop = ul.scrollHeight; } };
}

// Speech bubbles above robots.
const bubbles = [];
const holdFor = t => 2600 + t.length * 45;
const short = t => t.length > 240 ? `${t.slice(0, 237)}…` : t;
function bubble(robot, text, ms = holdFor(text)) {
  bubbles.filter(b => b.robot === robot).forEach(b => { b.el.remove(); b.until = 0; });
  const el = document.createElement('div'); el.className = 'bubble'; el.textContent = short(text); overlays.append(el);
  const b = { robot, el, until: performance.now() + ms };
  b.set = (t, hold = holdFor(t)) => { el.textContent = short(t); b.until = performance.now() + hold; };
  bubbles.push(b); return b;
}

// Command line transcript: every question, the robot's answer as it streams, and any action buttons.
const cliFeed = $('#cli-feed');
function cliEntry(robot, question) {
  const el = document.createElement('div'); el.className = 'ce';
  if (question) { const q = document.createElement('p'); q.className = 'ce-q'; q.textContent = `› ${question}`; el.append(q); }
  const a = document.createElement('p'), who = document.createElement('b'), txt = document.createElement('span'), acts = document.createElement('div');
  a.className = 'ce-a'; who.textContent = robot ? robot.id : 'fleet'; txt.textContent = ' …'; acts.className = 'ce-act';
  a.append(who, txt); el.append(a, acts); cliFeed.append(el);
  while (cliFeed.children.length > 10) cliFeed.firstChild.remove();
  cliFeed.hidden = false; $('#cli-clear').hidden = false; cliFeed.scrollTop = cliFeed.scrollHeight;
  return {
    set(t) { txt.textContent = ` ${t}`; cliFeed.scrollTop = cliFeed.scrollHeight; },
    app(id, tool) { const c = document.createElement('p'); c.className = 'ce-app'; c.innerHTML = `${MARKS[id]}<span>${esc(APPS[id].name)}<small>${esc(tool)}</small></span>`; a.before(c); },
    act(buttons) {
      for (const b of buttons) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = b.label; if (b.primary) btn.className = 'primary';
        btn.addEventListener('click', () => { if (b.once !== false) acts.querySelectorAll('button').forEach(x => { x.disabled = true; }); b.onClick(); });
        acts.append(btn);
      }
      cliFeed.scrollTop = cliFeed.scrollHeight;
    },
  };
}
function say(robot, text, kind = 'agent') { const e = cliEntry(robot, null); e.set(text); bubble(robot, text); log(robot, text, kind); return e; }

// Action queue, Sims style: background task, the Claude call in flight, the current step, then what is queued.
const ICONS = {
  nav: 'M5 19 12 4l7 15-7-4z', door: 'M7 3h10v18H7zM14 12h1', eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  grab: 'M8 3v7M16 3v7M8 10c0 6 8 6 8 0M12 15v6', home: 'M3 11l9-8 9 8M6 9.5V20h12V9.5', hold: 'M9 5v14M15 5v14', talk: 'M4 5h16v11H10l-6 4z',
  give: 'M3 15h6l4 3h7M8 11l4-4 4 2', loop: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4', flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  think: 'M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3zM9 22h6', chair: 'M8 3h8v9H8zM6 12h12M7 12v9M17 12v9', skill: 'M3 12h4l2-6 4 12 2-6h6', print: 'M5 20h14M7 20V9h10v11M9 9V5h6v4M10 14h4',
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k] || ICONS.nav}"/></svg>`;
const STATUS = { nav: 'Navigating', home: 'Navigating', eye: 'Perceiving', talk: 'Speaking', hold: 'Holding', think: 'Thinking', flag: 'Patrolling' };
let stepSeq = 0;
function enqueue(robot, steps, replace = false) {
  if (replace) cancel(robot);
  for (const s of steps) s.id ??= ++stepSeq;
  robot.queue.push(...steps); renderQueue();
  if (!robot.running) runQueue(robot);
}
function cancelCurrent(robot) {
  const s = robot.current; if (!s) return;
  s.cancelled = true; robot.stepCtl?.abort();
  if (robot.path) { const done = robot.path.resolve; robot.path = null; done(); }
  hidePath(robot);
}
function cancel(robot) {
  for (const s of robot.queue) s.onCancel?.();
  robot.queue.length = 0; cancelCurrent(robot); renderQueue();
}
function removeStep(robot, id) {
  const i = robot.queue.findIndex(s => s.id === id);
  if (i >= 0) { const [s] = robot.queue.splice(i, 1); s.onCancel?.(); log(robot, `removed "${s.label}" from the queue`, 'err'); }
  else if (robot.current?.id === id) { log(robot, `stopped "${robot.current.label}"`, 'err'); cancelCurrent(robot); }
  renderQueue();
}
async function runQueue(robot) {
  robot.running = true;
  while (robot.queue.length) {
    const step = robot.queue.shift(); robot.current = step; robot.stepCtl = new AbortController(); renderQueue();
    robot.status = step.patrol ? 'Patrolling' : STATUS[step.icon] ?? 'Manipulating';
    log(robot, step.skill, 'call');
    const start = performance.now();
    try { await step.run(robot.stepCtl.signal); if (!step.cancelled) log(robot, `${step.label} done · ${((performance.now() - start) / 1000).toFixed(1)} s`, 'ok'); }
    catch (err) {
      if (!step.cancelled) {
        log(robot, `${step.label} failed: ${err.message}`, 'err'); say(robot, `I couldn't finish "${step.label}": ${err.message}.`, 'err');
        for (const s of robot.queue) s.onCancel?.(); robot.queue.length = 0;
      }
    }
    robot.current = null; robot.stepCtl = null; renderQueue();
  }
  robot.running = false; robot.status = robot.carrying ? 'Carrying' : robot.holding ? 'Holding' : 'Idle'; renderQueue();
}
function renderQueue() {
  const q = $('#queue'), r = selected;
  $('#cli-stop').hidden = !r || !(r.asking || r.current || r.queue?.length || r.bg);
  if (!r) { q.replaceChildren(); return; }
  const items = [];
  const ico = s => `<span class="q-ico">${icon(s.icon)}${s.app ? `<i title="via ${esc(APPS[s.app].name)}">${MARKS[s.app]}</i>` : ''}</span>`;
  if (r.bg) items.push(`<div class="q-bg glass" title="Dimensional Security · runs in the background until you stop it"><span class="q-ico">${MARKS.security}</span><span>${esc(r.bg.label)}<small id="q-bg-sub">${esc(r.bg.sub())}</small></span><button data-x="bg" aria-label="Stop the patrol">×</button></div>`);
  if (r.asking) items.push(`<div class="q-now glass ask">${icon('think')}<span>Asking Claude<small>${esc(r.asking.text)}</small></span><button data-x="ask" aria-label="Stop asking Claude">×</button></div>`);
  if (r.current) {
    const navLike = r.current.icon === 'nav' || r.current.icon === 'home' || r.current.icon === 'flag';
    items.push(`<div class="q-now glass">${ico(r.current)}<span>${esc(r.current.label)}<small>${esc(r.current.skill)}</small><i class="prog"><b id="q-prog" class="${navLike ? '' : 'indet'}"></b></i></span><button data-x="${r.current.id}" aria-label="Stop ${esc(r.current.label)}">×</button></div>`);
  }
  for (const s of r.queue) items.push(`<button class="q-next glass" data-x="${s.id}" title="${esc(s.label)} · ${esc(s.skill)}${s.app ? ` · via ${esc(APPS[s.app].name)}` : ''} (click to remove)">${ico(s)}<span>${esc(s.label)}</span><em aria-hidden="true">×</em></button>`);
  if (!items.length) { q.replaceChildren(); return; }
  q.innerHTML = `<div class="q-who glass"><span class="label">Queue</span><strong>${esc(r.id)}</strong></div>${items.join('')}${r.queue.length > 1 ? '<button class="q-clear glass" data-x="all">Clear</button>' : ''}`;
}
$('#queue').addEventListener('click', e => {
  const b = e.target.closest('[data-x]'); if (!b || !selected) return;
  const x = b.dataset.x;
  if (x === 'bg') stopPatrol(selected);
  else if (x === 'ask') selected.asking?.ctl.abort();
  else if (x === 'all') { log(selected, 'queue cleared by operator', 'err'); cancel(selected); }
  else removeStep(selected, Number(x));
});
function updateQueueProgress() {
  const r = selected, b = document.getElementById('q-prog');
  if (b && r?.navLeft && r.path && r.navTotal) {
    const left = r.navLeft.slice(r.path.i).reduce((s, p, i, a) => s + (i ? p.distanceTo(a[i - 1]) : p.distanceTo(r.pos)), 0);
    b.style.width = `${Math.round(100 * (1 - left / r.navTotal))}%`;
  }
  const sub = document.getElementById('q-bg-sub'); if (sub && r?.bg) sub.textContent = r.bg.sub();
}
// Resolves when the steps finish or are cancelled, so tools and loops can wait on the robot.
function runSteps(robot, steps, replace = true) {
  return new Promise(resolve => {
    const last = steps.at(-1), run = last.run;
    last.run = async signal => { try { await run(signal); resolve(last.cancelled ? 'cancelled' : 'done'); } catch (e) { resolve(`failed: ${e.message}`); throw e; } };
    for (const st of steps) st.onCancel = () => resolve('cancelled');
    enqueue(robot, steps, replace);
  });
}

// Paths on the floor.
function showPath(robot, points) {
  hidePath(robot);
  const g = new T.Group();
  const line = new T.Line(new T.BufferGeometry().setFromPoints([robot.pos.clone(), ...points].map(p => V(p.x, .05, p.z))), new T.LineDashedMaterial({ color: 0x1f6f97, dashSize: .2, gapSize: .12 }));
  line.computeLineDistances(); g.add(line);
  const goal = new T.Mesh(new T.RingGeometry(.16, .22, 32), new T.MeshBasicMaterial({ color: 0x1f6f97, transparent: true, opacity: .85, depthWrite: false }));
  goal.rotation.x = -Math.PI / 2; goal.position.set(points.at(-1).x, .05, points.at(-1).z); g.add(goal);
  onUI(g); g.visible = layersOn.paths; scene.add(g); robot.pathViz = g;
}
function hidePath(robot) { robot.pathViz?.removeFromParent(); robot.pathViz = null; }

// Places, items and where the R1 stands to work the fridge and the printer.
const PLACES = [
  { re: /fridge|heladera|nevera/, name: 'Fridge', x: 5.15, z: 12.36, look: [6.48, 12.85], exact: true },
  { re: /printer|impresora|3d/, name: '3D printer', x: -1.25, z: 7.27, look: [-1.25, 6.47], exact: true },
  { re: /lounge|sof|bench|banco|living|ventana|window/, name: 'Window lounge', x: -.9, z: 13.9, look: [-3, 16.5] },
  { re: /caf[eé]|round table|mesa redonda/, name: 'Café', x: -1.0, z: 12.4, look: [-2.3, 10.2] },
  { re: /kitchen|cocina/, name: 'Glass kitchen', x: 4.3, z: 12.6, look: [6.3, 11.2] },
  { re: /booth|cabina/, name: 'Timber booths', x: 2.3, z: 4.7, look: [4.14, 4.7] },
  { re: /phone|tel[eé]fono/, name: 'Phone rooms', x: 2.3, z: -.9, look: [4.5, -.875] },
  { re: /club|meeting|reuni[oó]n|sala/, name: 'The Club', x: 2.3, z: -5.9, look: [5, -5.88] },
  { re: /desk|workspace|escritorio|puesto|work|oficina/, name: 'Open workspace', x: .8, z: -4.0, look: [-5, -4] },
  { re: /entr|door|puerta|exit|salida/, name: 'Entrance', x: 6.25, z: 15.3, look: [7.08, 15.32] },
];
const TOUR = ['Café', 'Window lounge', 'Glass kitchen', 'Timber booths', 'Phone rooms', 'The Club', 'Open workspace'];
const PLACE_NAMES = [...PLACES.map(p => p.name), 'Start position'];
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const place = name => PLACES.find(p => norm(p.name) === norm(name)) ?? PLACES.find(p => p.re.test(norm(name)));
const lookYaw = p => Math.atan2(-(p.look[1] - p.z), p.look[0] - p.x);
const ITEMS = {
  coca_cola: { id: 'coca_cola', name: 'Coca-Cola', obj: fridge.coke, grip: .019, conf: .97, kg: .37, in: 'fridge' },
  banana: { id: 'banana', name: 'banana', obj: fridge.banana, grip: .006, conf: .94, kg: .12, in: 'fridge' },
  printed_part: { id: 'printed_part', name: '3D printed part', obj: printer.part, grip: .015, conf: .96, kg: .04, in: 'printer' },
};
const inContainer = it => it.obj.parent === (it.in === 'fridge' ? fridge.group : printer.group);
const fridgeItems = () => [ITEMS.coca_cola, ITEMS.banana].filter(inContainer);
const FRIDGE_REACH = { x: 5.6, z: 12.82 };

// Skills. Each step is what the agent would call; the log shows the call and its result.
const sleep = (robot, s) => robot.tween(s, () => {});
function drive(robot, x, z, reverse = false) { const p = robot.follow([V(x, 0, z)]); robot.path.reverse = reverse; return p; }
function turnTo(robot, yaw) { const y0 = robot.yaw, d = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0)); return robot.tween(Math.max(.25, Math.abs(d) / 2.4), t => { robot.yaw = y0 + d * t; }); }
const carryPoint = robot => robot.pos.clone().addScaledVector(robot.forward(), .4).addScaledVector(robot.right(), .14).setY(1.0);
const near = (robot, p, r = .3) => Math.hypot(robot.pos.x - p.x, robot.pos.z - p.z) < r;
function requireArms(robot) { if (!robot.cfg.manip) throw new Error(robot.cfg.why); if (robot.carrying) throw new Error('both arms are carrying a chair, put it down first'); }
function step(label, skill, iconKey, run) { const s = { label, skill, icon: iconKey }; s.run = signal => run(s, signal); return s; }

function navStep(robot, target, name, iconKey = 'nav') {
  return step(`Go to ${name}`, `navigate_to("${name}")`, iconKey, async s => {
    const plan = planPath(costmap, robot.pos, target);
    if (!plan) throw new Error('no free path in the costmap');
    log(robot, `planner: A* expanded ${plan.expanded} cells, ${plan.points.length} waypoints, ${plan.length.toFixed(1)} m`);
    showPath(robot, plan.points); robot.navLeft = plan.points; robot.navTotal = Math.max(.01, plan.length);
    await robot.follow(plan.points);
    hidePath(robot); robot.navLeft = null;
    if (!s.cancelled && target.yaw !== undefined) await turnTo(robot, target.yaw);
  });
}
const navTo = (robot, p) => navStep(robot, { x: p.x, z: p.z, yaw: lookYaw(p), exact: p.exact }, p.name);
const goTo = (robot, name) => navTo(robot, place(name)).run();
function openFridgeStep(robot, m = modelFor('open')) {
  const k = m.speed;
  return Object.assign(step('Open the fridge', `open("fridge.door", policy="${m.policy}")`, 'door', async s => {
    requireArms(robot);
    if (fridge.doorAngle < 1) {
      if (!near(robot, place('Fridge'))) await goTo(robot, 'Fridge');
      if (s.cancelled) return;
      robot.gaze = fridge.handleWorld(); robot.setGripper('right', .05);
      await robot.armTo('right', fridge.handleWorld(), robot.forward(), 1.1 * k);
      await robot.tween(.3 * k, t => robot.setGripper('right', .05 - .04 * t));
      await robot.tween(.9 * k, t => { fridge.setDoor(.5 * t); robot.solveArm('right', fridge.handleWorld(), null, 1); });
      robot.setGripper('right', .05); robot.gaze = fridge.local(0, 1.05, 0);
      await Promise.all([robot.armRest('right', .8 * k), robot.tween(1.1 * k, t => fridge.setDoor(.5 + 1.02 * t))]);
    } else if (!near(robot, FRIDGE_REACH) && !near(robot, place('Fridge'))) await goTo(robot, 'Fridge');
    if (s.cancelled) return;
    if (!near(robot, FRIDGE_REACH, .1)) { await drive(robot, FRIDGE_REACH.x, FRIDGE_REACH.z); await turnTo(robot, 0); }
    robot.gaze = fridge.local(0, 1.02, .05);
  }), { app: m.id });
}
function closeFridgeStep(robot, m = modelFor('close')) {
  const k = m.speed;
  return Object.assign(step('Close the fridge', `close("fridge.door", policy="${m.policy}")`, 'door', async s => {
    if (fridge.doorAngle < .05) return;
    requireArms(robot);
    if (!near(robot, FRIDGE_REACH, 1.2)) await goTo(robot, 'Fridge');
    if (s.cancelled) return;
    await drive(robot, place('Fridge').x, place('Fridge').z, true);
    robot.gaze = fridge.local(0, 1.1, .6);
    const start = fridge.doorAngle;
    await robot.armTo('right', fridge.handleWorld(), null, .8 * k);
    await robot.tween(1.1 * k, t => { fridge.setDoor(start * (1 - t)); if (t < .6) robot.solveArm('right', fridge.handleWorld(), null, 1); });
    await robot.armTo('right', carryPoint(robot), null, .8 * k);
    robot.gaze = null;
  }), { app: m.id });
}
function graspStep(robot, item, m = modelFor('grasp')) {
  const k = m.speed;
  return Object.assign(step(item.in === 'printer' ? 'Extract the printed part' : `Grab ${item.name}`, `grasp("${item.id}", arm="right", policy="${m.policy}")`, 'grab', async s => {
    requireArms(robot);
    if (robot.holding) throw new Error(`the right gripper already holds ${robot.holding.id}`);
    if (!inContainer(item)) throw new Error(`${item.id} is not there any more`);
    if (item.in === 'fridge') await openFridgeStep(robot).run();
    else if (!near(robot, place('3D printer'))) await goTo(robot, '3D printer');
    if (s.cancelled) return;
    const p = item.obj.getWorldPosition(V()), low = p.y < .95 || Math.hypot(p.x - robot.pos.x, p.z - robot.pos.z) > .78; robot.gaze = p.clone();
    robot.setGripper('right', .05);
    await robot.armTo('right', p, robot.forward(), 1.3 * k, low);
    await robot.tween(.35 * k, t => robot.setGripper('right', .05 - (.05 - item.grip) * t));
    robot.tool.right.attach(item.obj); robot.holding = item;
    await robot.armTo('right', p.clone().add(V(0, .08, 0)).addScaledVector(robot.forward(), -.05), null, .45 * k, low);
    if (low) await robot.torsoRest(.7 * k);
    await robot.armTo('right', carryPoint(robot), null, 1.1 * k);
    robot.gaze = null;
    log(robot, `gripper: holding ${item.id}, ${item.kg.toFixed(2)} kg est. · grasp by ${m.name}`);
  }), { app: m.id });
}
function fetchStep(robot, item, m = null) {
  return Object.assign(step(`Fetch ${item.name}`, `fetch("${item.id}")`, 'grab', async s => {
    await graspStep(robot, item, m ?? modelFor('grasp')).run();
    if (!s.cancelled && item.in === 'fridge') await closeFridgeStep(robot, m ?? modelFor('close')).run();
  }), { app: (m ?? modelFor('grasp')).id });
}
function homeStep(robot) {
  const back = robot.returnPose ?? robot.home;
  const st = navStep(robot, { x: back.x, z: back.z, yaw: back.yaw }, 'where you were', 'home');
  st.label = 'Go back'; st.skill = 'navigate_to(saved_pose)'; return st;
}
const holdStep = (robot, sec = .3) => step(sec > .5 ? `Wait ${sec} s` : 'Hold position', sec > .5 ? `wait(${sec})` : 'hold_position()', 'hold', () => sleep(robot, sec));
const speakStep = (robot, text) => step('Speak', `speak("${text.length > 34 ? `${text.slice(0, 33)}…` : text}")`, 'talk', async () => { say(robot, text); await sleep(robot, 1.8); });
function handoverStep(robot, m = modelFor('grasp')) {
  return Object.assign(step('Hand over', `hand_over(policy="${m.policy}")`, 'give', async () => {
    requireArms(robot);
    if (!robot.holding) throw new Error('there is nothing in the gripper to hand over');
    await robot.armTo('right', robot.pos.clone().addScaledVector(robot.forward(), .55).setY(1.05), null, 1 * m.speed);
    say(robot, `Here is your ${robot.holding.name}.`);
    await sleep(robot, 2.4);
    await robot.armTo('right', carryPoint(robot), null, .9 * m.speed);
  }), { app: m.id });
}
// Chairs: grip both sides of the seat, flip it upside down over the head, carry it, put it down.
const CHAIR = { cafe: { half: .24, h: .45, top: .49, name: 'chair' }, task: { half: .235, h: .44, top: .49, name: 'office chair' } };
const poseOf = c => { const p = c.group.getWorldPosition(V()), q = c.group.getWorldQuaternion(new T.Quaternion()); return { x: p.x, z: p.z, rot: new T.Euler().setFromQuaternion(q, 'YXZ').y }; };
function chairApproach(pose) {
  const back = V(Math.sin(pose.rot), 0, Math.cos(pose.rot)), p = V(pose.x, 0, pose.z).addScaledVector(back, .66);
  return { x: p.x, z: p.z, yaw: Math.atan2(back.z, -back.x) };
}
const nearestChair = robot => chairs.filter(c => !c.carriedBy).sort((a, b) => a.group.getWorldPosition(V()).distanceTo(robot.pos) - b.group.getWorldPosition(V()).distanceTo(robot.pos))[0];
function chairGrips(robot, chair) {
  chair.group.updateWorldMatrix(true, false);
  const g = CHAIR[chair.kind], a = chair.group.localToWorld(V(-g.half, g.h, 0)), b = chair.group.localToWorld(V(g.half, g.h, 0)), r = robot.right();
  return a.clone().sub(robot.pos).dot(r) > b.clone().sub(robot.pos).dot(r) ? { right: a, left: b } : { right: b, left: a };
}
function followChair(robot, chair, torso) { const g = chairGrips(robot, chair); robot.solveArm('right', g.right, null, 1, torso); robot.solveArm('left', g.left, null, 1, false); }
function overheadPose(robot, chair) {
  // Upside down over the head, seat resting just above it, backrest hanging behind.
  const r = robot.right(), f = robot.forward(), q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(r.clone().negate(), V(0, -1, 0), f.clone().negate()));
  return { p: robot.pos.clone().addScaledVector(f, .02).setY(robot.height + .03 + CHAIR[chair.kind].top), q };
}
async function moveChair(robot, chair, to, seconds, torso, torsoTo) {
  const from = { p: chair.group.position.clone(), q: chair.group.quaternion.clone() }, tj = robot.torsoJoints(), t0 = tj.map(j => j.jointValue[0]);
  await robot.tween(seconds, t => {
    chair.group.position.lerpVectors(from.p, to.p, t); chair.group.quaternion.slerpQuaternions(from.q, to.q, t);
    if (torsoTo) tj.forEach((j, i) => j.setJointValue(t0[i] + ((robot.restPose[j.name] ?? 0) - t0[i]) * t));
    robot.model.updateMatrixWorld(true); followChair(robot, chair, torso);
  });
}
function pickUpChairStep(robot, chair, m = modelFor('grasp')) {
  const k = m.speed;
  return Object.assign(step(`Pick up the ${CHAIR[chair.kind].name}`, `pick_up("${CHAIR[chair.kind].name.replace(' ', '_')}", hold="overhead", policy="${m.policy}")`, 'chair', async s => {
    requireArms(robot);
    if (robot.holding) throw new Error(`the right gripper already holds ${robot.holding.id}`);
    if (chair.carriedBy) throw new Error(`${chair.carriedBy.id} is already carrying that chair`);
    const ap = chairApproach(poseOf(chair));
    if (!near(robot, ap, .15)) { await navStep(robot, { x: ap.x, z: ap.z }, `the ${CHAIR[chair.kind].name}`).run(); if (s.cancelled) return; await drive(robot, ap.x, ap.z); }
    await turnTo(robot, ap.yaw); if (s.cancelled) return;
    chair.carriedBy = robot; updateChairObstacles();
    robot.gaze = chair.group.getWorldPosition(V()).setY(.5);
    robot.setGripper('right', .05); robot.setGripper('left', .05);
    // Reach both seat edges; the right arm may lean the torso, the left arm works with that lean.
    const joints = [...robot.torsoJoints(), ...robot.armJoints('right'), ...robot.armJoints('left')], before = joints.map(j => j.jointValue[0]), g = chairGrips(robot, chair);
    robot.solveArm('right', g.right, null, 4, true); robot.solveArm('left', g.left, null, 4, false); robot.solveArm('right', g.right, null, 2, false);
    const goal = joints.map(j => j.jointValue[0]); joints.forEach((j, i) => j.setJointValue(before[i])); robot.model.updateMatrixWorld(true);
    await robot.tweenJoints(joints, goal, 1.3 * k);
    await robot.tween(.35 * k, t => { robot.setGripper('right', .05 - .03 * t); robot.setGripper('left', .05 - .03 * t); });
    scene.attach(chair.group);
    await moveChair(robot, chair, { p: chair.group.position.clone().add(V(0, .35, 0)), q: chair.group.quaternion.clone() }, .6 * k, false, true);
    await moveChair(robot, chair, overheadPose(robot, chair), 1.5 * k, false, false);
    robot.model.links.torso_link4.attach(chair.group);
    robot.carrying = chair; robot.gaze = null;
    log(robot, `carrying the ${CHAIR[chair.kind].name} overhead · lifted by ${m.name}`);
  }), { app: m.id });
}
function putDownChairStep(robot, where = 'here', m = modelFor('grasp')) {
  const k = m.speed;
  return Object.assign(step(where === 'home' ? 'Put the chair back' : 'Put the chair down', `place("chair", at="${where === 'home' ? 'original_spot' : 'here'}", policy="${m.policy}")`, 'chair', async s => {
    const chair = robot.carrying; if (!chair) throw new Error('not carrying a chair');
    let pose;
    if (where === 'home') {
      pose = chair.home; const ap = chairApproach(pose);
      if (!near(robot, ap, .15)) { await navStep(robot, { x: ap.x, z: ap.z }, 'its spot').run(); if (s.cancelled) return; await drive(robot, ap.x, ap.z); }
      await turnTo(robot, ap.yaw); if (s.cancelled) return;
    } else {
      const f = robot.forward(), p = robot.pos.clone().addScaledVector(f, .66); pose = { x: p.x, z: p.z, rot: Math.atan2(-f.x, -f.z) };
    }
    scene.attach(chair.group);
    const down = { p: V(pose.x, 0, pose.z), q: new T.Quaternion().setFromAxisAngle(V(0, 1, 0), pose.rot) };
    await moveChair(robot, chair, { p: down.p.clone().add(V(0, .35, 0)), q: down.q }, 1.5 * k, false, false);
    await moveChair(robot, chair, down, .6 * k, true, false);
    await robot.tween(.3 * k, t => { robot.setGripper('right', .02 + .03 * t); robot.setGripper('left', .02 + .03 * t); });
    chair.carriedBy = null; robot.carrying = null; updateChairObstacles();
    await Promise.all([robot.armRest('right', .9 * k), robot.armRest('left', .9 * k)]);
    log(robot, `placed the ${CHAIR[chair.kind].name} ${where === 'home' ? 'back in its spot' : 'down'}`);
  }), { app: m.id });
}
function recordReturn(robot) { if (!robot.running || robot.current?.patrol) robot.returnPose = { x: robot.pos.x, z: robot.pos.z, yaw: robot.yaw }; }

// What the robot "perceives": room, plus landmarks and robots inside its camera's horizontal view.
const LANDMARKS = [
  ['round café table', -2.15, 11.25], ['round café table', .1, 10.65], ['round café table', -2.5, 8.95],
  ['kitchen island', 4.65, 10.65], ['kitchen shelving with two microwaves', 5.3, 8.53], ['water dispensers', 6.08, 9.6], ['sink and counter', 6.51, 10.45],
  ['timber booth with benches and a wall TV', 4.14, 5.9], ['timber booth with benches and a wall TV', 4.14, 3.5],
  ['phone room 3, red door', 4.2, .575], ['phone room 2, turquoise door', 4.2, -.875], ['phone room 1, orange door', 4.2, -2.325],
  ['The Club meeting table', 5, -5.88], ['meeting table, far room', 5, -11.8], ['red shelving divider with books', -2.5, 8.15], ['coat stand', .45, 8.6],
  ['tiered lounge bench with cushions', -2.69, 17.22], ['poufs and side tables', -2.6, 14.6], ['coffee machine', -5.5, 15.98], ['charging pedestal', -5.5, 17.85],
  ['entrance door', 7.08, 15.32], ['WC door', 5.28, 7.7], ['exit door', 5.28, 1.72], ['tall plant', -5.55, 12.9], ['tall plant', .82, 8.55],
  ...[-5.2, -1.25].flatMap(x => [3.65, -4.05, -11.75].map(z => ['row of desks with task chairs', x, z])),
];
function zoneOf(p) {
  let best = 'office', d = Infinity;
  for (const z of Object.values(ZONES)) { const dd = Math.hypot(p.x - z.center[0], p.z - z.center[1]); if (dd < d) { d = dd; best = z.title; } }
  return best;
}
function lookReadout(robot) {
  const f = robot.forward(), r = robot.right(), seen = [];
  const consider = (label, x, z) => {
    const dx = x - robot.pos.x, dz = z - robot.pos.z, d = Math.hypot(dx, dz);
    if (d < .25 || d > 8) return;
    const b = T.MathUtils.radToDeg(Math.atan2(dx * r.x + dz * r.z, dx * f.x + dz * f.z));
    if (Math.abs(b) > 50) return;
    seen.push([d, `${label}, ${d.toFixed(1)} m ${Math.abs(b) < 12 ? 'ahead' : b > 0 ? 'ahead right' : 'ahead left'}`]);
  };
  for (const [label, x, z] of LANDMARKS) consider(label, x, z);
  const inside = fridgeItems().map(it => it.id);
  consider(fridge.doorAngle > .3 ? `fridge, open, holding ${inside.join(' and ') || 'nothing'}` : 'fridge, closed', fridge.group.position.x, fridge.group.position.z);
  consider(inContainer(ITEMS.printed_part) ? '3D printer on a desk, print finished, part on the bed' : '3D printer on a desk, bed empty', printer.group.position.x, printer.group.position.z);
  for (const o of robots) if (o !== robot) consider(`${o.id} (${o.cfg.model})`, o.pos.x, o.pos.z);
  return { room: zoneOf(robot.pos), visible: seen.sort((a, b) => a[0] - b[0]).slice(0, 10).map(s => s[1]) };
}

// Claude, through the artifact's sample capability (the viewer's own account). Absent: keyword mode.
let ai = null, aiCaps = null;
const AI_GONE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
function setMode(on) {
  const m = $('#cli-mode'); m.textContent = on ? 'Claude' : 'keyword mode'; m.dataset.on = on ? '1' : '';
  m.title = on ? 'Commands go to Claude on your own account, with the robot camera frame' : 'Claude is not available in this view: a keyword parser answers';
}
const aiReady = (async () => {
  try { const s = await window.claude?.use?.('sample'); if (s) { aiCaps = await s.limits().catch(() => null); ai = s; } } catch { ai = null; }
  setMode(!!ai);
})();
function aiError(robot, e, entry) {
  const say2 = t => { entry?.set(t); log(robot, t, 'err'); };
  if (e?.code === 'cancelled') return say2('Stopped.');
  if (AI_GONE.includes(e?.code)) { ai = null; setMode(false); return say2('Claude is not allowed in this view, so I switched to keyword mode.'); }
  if (e?.code === 'rate_limited') return say2('Claude is rate limited for your account right now. Try again in a bit.');
  if (e?.code === 'refused') return say2('Claude declined that request.');
  say2(`Claude error (${e?.code ?? 'unknown'}). Try again.`);
}
async function describeView(robot, where, signal, entry) {
  await aiReady;
  if (!ai || !aiCaps?.images) {
    const r = lookReadout(robot), t = r.visible.length ? `In the ${r.room} I see ${r.visible.slice(0, 4).join('; ')}.` : `Nothing close in view in the ${r.room}.`;
    (entry ?? cliEntry(robot, null)).set(t); bubble(robot, t); log(robot, `look: ${t}`, 'agent'); return t;
  }
  const e = entry ?? cliEntry(robot, null), b = bubble(robot, '…', 60000), live = log(robot, '…', 'agent');
  try {
    const { text } = await ai(`You are ${robot.id}, a ${robot.cfg.model} robot in a simulated office (a 3D concept model, not a real building)${where ? `, now at ${where}` : ''}. The image is your head camera right now. In one or two short first-person sentences, say what you see: furniture, robots, anything notable. Mention only what is in the image. Plain text, no markdown.`,
      { modelTier: 'quick', images: [captureFrame(robot)], cache: false, signal, onText: ({ text: t }) => { e.set(t); b.set(t, 60000); live.set(t); } });
    e.set(text); b.set(text); live.set(text); return text;
  } catch (err) { b.set('…', 0); aiError(robot, err, e); return null; }
}
function describeStep(robot, where, notes) {
  return step(where ? `Describe ${where.name}` : 'Describe the view', 'describe_view()', 'eye', async (s, signal) => {
    if (where) { robot.gaze = V(where.look[0], .85, where.look[1]); await sleep(robot, .4); }
    const t = await describeView(robot, where?.name, signal);
    robot.gaze = null; if (t && notes) notes.push(`${where.name}: ${t}`);
  });
}
function summarizeStep(robot, notes) {
  return step('Summarize the tour', 'summarize(tour)', 'think', async (s, signal) => {
    await aiReady;
    if (!ai || !notes.length) { say(robot, `Tour done: I visited ${notes.length} areas.`); return; }
    const e = cliEntry(robot, null), live = log(robot, 'summarizing the tour…', 'agent');
    try {
      const { text } = await ai(`You are ${robot.id}, a robot that just toured a simulated office. Your notes from each stop:\n${notes.join('\n')}\nWrite a three-sentence summary of the office for the operator: what areas it has and what is in them. First person, plain text, no markdown.`,
        { modelTier: 'quick', cache: false, signal, onText: ({ text: t }) => { e.set(t); live.set(t); } });
      e.set(text); live.set(text); bubble(robot, text);
    } catch (err) { aiError(robot, err, e); }
  });
}
function startTour(robot) {
  const notes = [], left = TOUR.map(place), route = [];
  let at = robot.pos.clone();
  while (left.length) { left.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z)); const n = left.shift(); route.push(n); at = V(n.x, 0, n.z); }
  enqueue(robot, [...route.flatMap(p => [navTo(robot, p), describeStep(robot, p, notes)]), summarizeStep(robot, notes)], true);
  log(robot, `explore: ${route.map(p => p.name).join(' → ')}`, 'agent');
  return { route: route.map(p => p.name), note: 'Tour queued. The robot describes each stop and summarizes at the end.' };
}

// Patrol routes: draw flags on the floor, then the robot loops through them in the background.
let draw = null;
const flagMat = new T.MeshStandardMaterial({ color: 0x2f8fc1, emissive: 0x2f8fc1, emissiveIntensity: .25, side: T.DoubleSide, roughness: .5 });
const poleMat = new T.MeshStandardMaterial({ color: 0x22292b, roughness: .5 });
function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#0d1010'; g.beginPath(); g.roundRect(4, 8, 120, 48, 14); g.fill();
  g.fillStyle = '#96cde8'; g.font = '600 30px IBM Plex Mono, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 33);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  const sp = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(.5, .25, 1); sp.renderOrder = 5; return sp;
}
function flagMesh(p, i) {
  const g = new T.Group(); g.position.set(p.x, 0, p.z);
  const pole = new T.Mesh(new T.CylinderGeometry(.014, .014, .95, 8), poleMat); pole.position.y = .475; g.add(pole);
  const s = new T.Shape(); s.moveTo(0, 0); s.lineTo(.3, -.09); s.lineTo(0, -.18);
  const pennant = new T.Mesh(new T.ShapeGeometry(s), flagMat); pennant.position.set(.012, .93, 0); g.add(pennant);
  const base = new T.Mesh(new T.RingGeometry(.1, .14, 24), new T.MeshBasicMaterial({ color: 0x2f8fc1, transparent: true, opacity: .8, depthWrite: false }));
  base.rotation.x = -Math.PI / 2; base.position.y = .06; g.add(base);
  const lab = labelSprite(ordinal(i + 1)); lab.position.y = 1.18; g.add(lab);
  return g;
}
function drawRoute(group, flags, closed) {
  group.clear();
  flags.forEach((f, i) => group.add(flagMesh(f, i)));
  if (flags.length > 1) {
    const pts = [...flags, ...(closed && flags.length > 2 ? [flags[0]] : [])].map(f => V(f.x, .07, f.z));
    const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineDashedMaterial({ color: 0x1f6f97, dashSize: .16, gapSize: .12 }));
    line.computeLineDistances(); group.add(line);
  }
  onUI(group);
}
function offerPatrol(robot, entry) {
  if (!owned.security) {
    entry.act([{ label: 'Open Apps', primary: true, onClick: () => openApps('security') }]);
    return 'Patrol routes come from the Dimensional Security app, which is not installed. Install it from Apps and ask again.';
  }
  entry.app('security', 'draw_patrol_route()');
  entry.act([{ label: 'Draw patrol route', primary: true, onClick: () => startDrawing(robot) }]);
  log(robot, 'security.draw_patrol_route() offered', 'call');
  return 'Sure. Press Draw patrol route, click the floor to drop flags in the order I should visit them, then press Start patrol.';
}
function startDrawing(robot) {
  stopDrawing(); closePies(); if (selected !== robot) select(robot);
  draw = { robot, flags: [], viz: new T.Group() }; scene.add(draw.viz);
  $('#draw-app').innerHTML = `${MARKS.security}<span>Dimensional Security</span>`;
  $('#draw').hidden = false; view.classList.add('drawing'); updateDrawBar();
  log(robot, 'patrol: drawing a new route', 'agent');
}
function updateDrawBar() {
  if (!draw) return; const n = draw.flags.length;
  $('#draw-text').textContent = `Patrol route for ${draw.robot.id} · ${n ? `${n} flag${n > 1 ? 's' : ''}, keep clicking or start` : 'click the floor to drop the 1st flag'}`;
  $('#draw-go').disabled = n < 2; $('#draw-undo').disabled = !n;
}
function addFlag(p) {
  const c = snapToFree(costmap, p.x, p.z); if (!c || !draw) return;
  draw.flags.push(c); drawRoute(draw.viz, draw.flags, false); updateDrawBar();
}
function stopDrawing() { if (!draw) return; draw.viz.removeFromParent(); draw = null; $('#draw').hidden = true; view.classList.remove('drawing'); }
$('#draw-undo').onclick = () => { if (!draw) return; draw.flags.pop(); drawRoute(draw.viz, draw.flags, false); updateDrawBar(); };
$('#draw-cancel').onclick = () => { if (draw) log(draw.robot, 'patrol: drawing cancelled', 'err'); stopDrawing(); };
$('#draw-go').onclick = () => { if (!draw || draw.flags.length < 2) return; const { robot, flags } = draw; stopDrawing(); startPatrol(robot, flags); };
function startPatrol(robot, flags) {
  stopPatrol(robot, true);
  const viz = new T.Group(); drawRoute(viz, flags, true); scene.add(viz);
  const task = { flags, lap: 1, next: 0, active: true, viz, label: `Patrol · ${flags.length} flags` };
  task.sub = () => `lap ${task.lap} → ${ordinal(task.next + 1)} flag`;
  robot.bg = task; renderQueue();
  log(robot, `security.start_patrol(waypoints=${flags.length}, loop=true)`, 'call');
  say(robot, 'We will run this patrolling route indefinitely until you tell me to stop.').app('security', 'start_patrol(route)');
  patrolLoop(robot, task);
  return `Patrol started over ${flags.length} flags. It loops until the operator stops it.`;
}
async function patrolLoop(robot, task) {
  while (task.active) {
    if (robot.estop || robot.current || robot.queue.length || robot.asking) { await wait(300); continue; }
    const i = task.next, f = task.flags[i];
    const st = navStep(robot, { x: f.x, z: f.z }, `${ordinal(i + 1)} flag`);
    Object.assign(st, { label: `Patrol → ${ordinal(i + 1)} flag`, skill: `security.patrol_goto(flag=${i + 1}, lap=${task.lap})`, icon: 'flag', patrol: true, app: 'security' });
    const out = await runSteps(robot, [st], false);
    if (!task.active) break;
    if (out === 'done') {
      if (hasExtra('security:checkpoint')) { const r = lookReadout(robot); const t = `Checkpoint ${i + 1}: all clear${r.visible[0] ? `, ${r.visible[0].split(',')[0]} in view` : ''}.`; bubble(robot, t); log(robot, `security.checkpoint_report() · ${t}`, 'ok'); }
      task.next = (i + 1) % task.flags.length; if (task.next === 0) task.lap++; await wait(350);
    } else await wait(300);
  }
}
function stopPatrol(robot, quiet = false) {
  const t = robot.bg; if (!t) return false;
  t.active = false; t.viz.removeFromParent(); robot.bg = null;
  if (robot.current?.patrol) cancelCurrent(robot);
  for (const s of robot.queue.filter(s => s.patrol)) removeStep(robot, s.id);
  renderQueue();
  if (!quiet) { log(robot, 'security.stop_patrol()', 'call'); say(robot, `Patrol stopped after ${t.lap > 1 ? `${t.lap - 1} full lap${t.lap > 2 ? 's' : ''}` : 'less than a lap'}.`); }
  return true;
}

// Learned skills: a request taught from an object menu becomes a reusable list of known actions.
let learned = []; try { learned = JSON.parse(localStorage.getItem('dimdesk.skills') || '[]'); } catch { learned = []; }
const saveSkills = () => { try { localStorage.setItem('dimdesk.skills', JSON.stringify(learned)); } catch { /* per-viewer convenience only */ } };
const OPS = ['navigate_to', 'fetch', 'open', 'close', 'hand_over', 'speak', 'look', 'wait'];
const objName = key => key === 'printer' ? '3D printer' : key === 'fridge' ? 'fridge' : 'command line';
function cleanSkill(spec, key, text) {
  const steps = (Array.isArray(spec?.steps) ? spec.steps : []).map(s => ({ op: String(s?.op ?? ''), arg: s?.arg == null ? '' : String(s.arg) })).filter(s => {
    if (!OPS.includes(s.op)) return false;
    if (s.op === 'navigate_to') { const p = place(s.arg) ?? (/start|back|where/i.test(s.arg) ? { name: 'Start position' } : null); if (!p) return false; s.arg = p.name; }
    if (s.op === 'fetch') return !!ITEMS[s.arg];
    if (s.op === 'open' || s.op === 'close') { s.arg = 'fridge'; }
    if (s.op === 'wait') s.arg = String(Math.min(30, Math.max(1, Number(s.arg) || 2)));
    if (s.op === 'speak') s.arg = s.arg.slice(0, 140);
    return true;
  }).slice(0, 8);
  const name = String(spec?.name || text).replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ').slice(0, 40);
  return { id: Date.now(), name: name.charAt(0).toUpperCase() + name.slice(1), object: key, text, steps };
}
function keywordSkill(text, key) {
  const t = text.toLowerCase(), steps = [];
  const item = /coke|coca/.test(t) ? 'coca_cola' : /banana/.test(t) ? 'banana' : /part|piece|print|pieza|gear/.test(t) ? 'printed_part' : key === 'printer' && /extract|take|grab|get|bring/.test(t) ? 'printed_part' : null;
  if (/open|abr/.test(t) && !item) steps.push({ op: 'open', arg: 'fridge' });
  if (item) steps.push({ op: 'fetch', arg: item });
  if (/look|check|see|mir|revis|what/.test(t)) steps.push({ op: 'look' });
  const p = PLACES.find(q => q.re.test(item ? t.replace(/fridge|heladera|nevera|printer|impresora|3d/g, '') : t));
  if (p) steps.push({ op: 'navigate_to', arg: p.name }); else if (/back|volv|return/.test(t)) steps.push({ op: 'navigate_to', arg: 'Start position' });
  if (/give|bring|hand|deliver|llev|entreg|dale/.test(t)) steps.push({ op: 'hand_over' });
  const sayM = text.match(/(?:say|tell (?:them|him|her|people)|announce|dec[ií]|dile|decile|avis[aá])\s+(?:that\s+)?["“]?(.+?)["”]?$/i);
  if (sayM) steps.push({ op: 'speak', arg: sayM[1] });
  if (/close|cerr/.test(t)) steps.push({ op: 'close', arg: 'fridge' });
  const fetched = steps.find(s => s.op === 'fetch'), dest = steps.find(s => s.op === 'navigate_to');
  const name = fetched && dest ? `${ITEMS[fetched.arg].name} to ${dest.arg}` : fetched ? `Fetch ${ITEMS[fetched.arg].name}` : dest ? `Go to ${dest.arg}` : steps.some(s => s.op === 'speak') ? 'Announce' : text;
  return { name, steps };
}
const fmtOp = s => s.arg && s.op !== 'open' && s.op !== 'close' ? `${s.op}(${s.op === 'speak' ? `"${s.arg}"` : s.arg})` : s.op === 'open' || s.op === 'close' ? `${s.op}(fridge)` : `${s.op}()`;
const modelInText = t => /physical intelligence|\bpi\b/.test(t) ? APPS.pi : /general intuition|\bgi\b/.test(t) ? APPS.gi : /classic/.test(t) ? APPS.classic : null;
function skillSteps(robot, skill, m = null) {
  return skill.steps.map(s => {
    const arms = ['fetch', 'open', 'close', 'hand_over'].includes(s.op);
    if (arms && !robot.cfg.manip) return speakStep(robot, `I can't ${s.op.replace('_', ' ')}: ${robot.cfg.why.toLowerCase()}.`);
    switch (s.op) {
      case 'navigate_to': return s.arg === 'Start position' ? homeStep(robot) : navTo(robot, place(s.arg));
      case 'fetch': return fetchStep(robot, ITEMS[s.arg], m);
      case 'open': return openFridgeStep(robot, m ?? modelFor('open'));
      case 'close': return closeFridgeStep(robot, m ?? modelFor('close'));
      case 'hand_over': return handoverStep(robot, m ?? modelFor('grasp'));
      case 'speak': return speakStep(robot, s.arg);
      case 'look': return describeStep(robot, null, null);
      default: return holdStep(robot, Number(s.arg));
    }
  });
}
function runSkill(robot, skill) {
  recordReturn(robot);
  log(robot, `skill.run("${skill.name}")`, 'call');
  enqueue(robot, skillSteps(robot, skill).map(st => Object.assign(st, { label: `${skill.name}: ${st.label}` })), true);
  return `Running "${skill.name}" (${skill.steps.length} steps).`;
}
async function learnSkill(robot, key, text) {
  const entry = cliEntry(robot, `new skill (${objName(key)}): ${text}`);
  log(robot, `operator: teach skill "${text}"`, 'operator');
  await aiReady;
  let spec = null;
  if (ai) {
    entry.set('Composing the skill from actions I know…');
    try {
      spec = await ai.json(`Turn the operator's request into a reusable robot skill for ${robot.id} (${robot.cfg.model}${robot.cfg.manip ? ', two arms with grippers' : ', cannot grasp'}), taught from the ${objName(key)} menu in a simulated office. Use only these ops: navigate_to (arg: one of ${PLACE_NAMES.join(', ')}); fetch (arg: coca_cola, banana or printed_part; goes to the fridge or the 3D printer, opens it if needed, grabs the item and closes the fridge); open (arg: fridge); close (arg: fridge); hand_over (no arg; holds the carried item out to a person); speak (arg: one short sentence); look (no arg; describes what the camera sees); wait (arg: seconds). Reply with only JSON like {"name":"Coke to the lounge","steps":[{"op":"fetch","arg":"coca_cola"},{"op":"navigate_to","arg":"Window lounge"},{"op":"hand_over"}]}. The name has at most four words. Request: "${text}"`,
        { modelTier: 'quick', cache: false });
    } catch (e) { aiError(robot, e, entry); }
  }
  let skill = cleanSkill(spec, key, text);
  if (!skill.steps.length) skill = cleanSkill(keywordSkill(text, key), key, text);
  if (!skill.steps.length) { entry.set("I couldn't turn that into actions I know. Name an item (coke, banana, printed part), a place, or something to say."); return; }
  learned.push(skill); saveSkills();
  log(robot, `skill.learn("${skill.name}", steps=${skill.steps.length})`, 'call');
  entry.set(`New skill learned: "${skill.name}": ${skill.steps.map(fmtOp).join(' → ')}. You'll find it in the ${objName(key)} menu.`);
  entry.act([
    { label: 'Run it now', primary: true, onClick: () => cliEntry(robot, null).set(runSkill(selected ?? robot, skill)) },
    { label: 'Forget it', onClick: () => { learned = learned.filter(s => s.id !== skill.id); saveSkills(); entry.set(`Forgot "${skill.name}".`); } },
  ]);
}

// Command line. Each command is answered by Claude with the head camera frame and robot skills as tools,
// or by a keyword parser when Claude is not available in this view.
function claudeTools(robot, entry, append = false) {
  // A follow-up typed into a pie keeps what that pie already queued; a fresh command replaces it.
  const run = async (steps, done) => { const out = await runSteps(robot, steps, !append); return out === 'done' ? done() : { outcome: out }; };
  const tools = [
    { name: 'navigate_to', description: `Drive ${robot.id} to a named place and wait until it arrives (5 to 30 s). Returns the outcome and the room it ended in.`,
      inputSchema: { type: 'object', properties: { place: { type: 'string', enum: PLACE_NAMES } }, required: ['place'] },
      execute: async ({ place: name }) => {
        const p = String(name) === 'Start position' ? null : place(name);
        if (!p && String(name) !== 'Start position') throw new Error(`unknown place "${name}"`);
        return run([p ? navTo(robot, p) : homeStep(robot)], () => ({ outcome: 'arrived', room: zoneOf(robot.pos) }));
      } },
    { name: 'look', description: `Perception readout from ${robot.id}'s head camera right now: the room, and the objects and robots in view with distance and direction. Use it after moving; the attached image is from before any move.`,
      execute: () => lookReadout(robot) },
    { name: 'speak', description: 'Say one short sentence out loud through the robot speaker.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      execute: ({ text }) => { const t = String(text).slice(0, 200); say(robot, t); log(robot, `speak("${t.slice(0, 60)}")`, 'call'); return 'said'; } },
    { name: 'fetch_item', description: 'Go to the fridge or the 3D printer, open it if needed, grab the item with the right gripper (closing the fridge after) and wait until done. Only robots with arms can do this. Optionally name the manipulation model the operator asked for.',
      inputSchema: { type: 'object', properties: { item: { type: 'string', enum: Object.keys(ITEMS) }, model: { type: 'string', enum: modelChoices().map(m => m.policy) } }, required: ['item'] },
      execute: ({ item, model }) => {
        const it = ITEMS[String(item)]; if (!it) throw new Error(`unknown item "${item}"`); requireArms(robot); recordReturn(robot);
        const m = model ? modelChoices().find(x => x.policy === String(model)) : null; if (model && !m) throw new Error(`model "${model}" is not installed`);
        return run([fetchStep(robot, it, m)], () => ({ outcome: 'holding', item: it.id, model: (m ?? modelFor('grasp')).name }));
      } },
    { name: 'hand_over', description: 'Hold the carried item out to the person in front of the robot, then take the arm back.',
      execute: () => run([handoverStep(robot)], () => ({ outcome: 'handed over' })) },
    { name: 'explore_office', description: 'Queue a tour of the office (café, window lounge, glass kitchen, timber booths, phone rooms, The Club, open workspace). The robot describes each stop and summarizes at the end. Returns the route right away; do not wait for the tour.',
      execute: () => startTour(robot) },
    { name: 'offer_patrol_drawing', description: 'Dimensional Security app: show the operator a "Draw patrol route" button. They click it, drop flags on the floor in order, and press Start patrol; the robot then loops the route until told to stop. Use it when the operator wants a new patrol route.',
      execute: () => offerPatrol(robot, entry) },
    { name: 'stop_patrol', description: 'Stop the patrol this robot is running in the background.', execute: () => stopPatrol(robot) ? 'patrol stopped' : 'no patrol was running' },
    { name: 'pick_up_chair', description: 'R1 Pro only: walk to the nearest free chair, grip the seat with both arms and carry it upside down over the head. Waits until it is overhead; then navigate_to carries it anywhere.',
      execute: () => { requireArms(robot); const c = nearestChair(robot); if (!c) throw new Error('no free chair nearby'); recordReturn(robot); return run([pickUpChairStep(robot, c)], () => ({ outcome: 'chair overhead' })); } },
    { name: 'put_down_chair', description: 'Put the chair being carried down, either right here in front of the robot or back in its original spot.',
      inputSchema: { type: 'object', properties: { where: { type: 'string', enum: ['here', 'original_spot'] } }, required: ['where'] },
      execute: ({ where }) => { if (!robot.carrying) throw new Error('not carrying a chair'); return run([putDownChairStep(robot, String(where) === 'original_spot' ? 'home' : 'here')], () => ({ outcome: 'chair placed' })); } },
    { name: 'close_fridge', description: 'Close the fridge door if it is open (only robots with arms).', execute: () => { requireArms(robot); return run([closeFridgeStep(robot)], () => 'fridge closed'); } },
  ];
  if (learned.length) tools.push({ name: 'run_skill', description: 'Run a skill the operator taught earlier, by name.', inputSchema: { type: 'object', properties: { name: { type: 'string', enum: learned.map(s => s.name) } }, required: ['name'] },
    execute: ({ name }) => { const sk = learned.find(s => s.name === String(name)); if (!sk) throw new Error(`no skill named "${name}"`); return runSkill(robot, sk); } });
  return tools.slice(0, aiCaps?.tools?.maxCount ?? tools.length);
}
function claudePrompt(robot, text) {
  const r = lookReadout(robot), queued = [robot.current, ...robot.queue].filter(Boolean).map(s => s.label);
  return [
    `You are the onboard agent of ${robot.id}, a ${robot.cfg.model} (${robot.cfg.body}) in Dimensional Desktop, a simulated office (a 3D concept model, not a real building). The operator typed a command to you.`,
    aiCaps?.images ? 'The attached image is your head camera right now.' : 'You have no camera image in this view; use the perception readout.',
    `State: room ${r.room}; pose x ${robot.pos.x.toFixed(1)} m, y ${(-robot.pos.z).toFixed(1)} m; ${robot.carrying ? 'carrying a chair over the head with both arms' : robot.holding ? `holding ${robot.holding.id}` : 'gripper empty'}; battery ${robot.battery.toFixed(0)}%; fridge door ${fridge.doorAngle > .3 ? 'open' : 'closed'}; ${robot.bg ? `patrolling ${robot.bg.flags.length} flags in the background` : 'no patrol running'}. ${robot.cfg.manip ? 'You have two arms with parallel grippers.' : `You cannot grasp: ${robot.cfg.why}.`}`,
    `Perception readout: ${JSON.stringify(r.visible)}`,
    queued.length ? `Already running or queued, in order (your tool actions run after these): ${queued.join(' → ')}.` : 'Nothing is queued.',
    `Apps: manipulation runs on ${modelFor('grasp').name} by default (installed models: ${modelChoices().map(m => m.name).join(', ')}); patrol routes come from the Dimensional Security app${owned.security ? '' : ', which is not installed, so say the operator can install it from Apps'}.`,
    `Places you can go: ${PLACE_NAMES.join(', ')}. Items: coca_cola and banana in the fridge, printed_part on the 3D printer.${learned.length ? ` Taught skills: ${learned.map(s => s.name).join(', ')}.` : ''}`,
    'Reply as the robot in the first person: one to three short sentences, plain text, no markdown. Describe only what the image or readout shows. Act with the tools. For a new patrol route, call offer_patrol_drawing and tell the operator to press the button.',
    `Operator: ${text}`,
  ].join('\n');
}
function keywordCommand(robot, text, entry, append = false) {
  const t = text.toLowerCase();
  const patrol = /patrol|patrull|ronda|route|ruta|recorrido/.test(t);
  if (patrol && /\bstop|\bpara\b|deten|cancel|end\b|termin|basta/.test(t)) { entry.set(stopPatrol(robot) ? 'Patrol stopped.' : 'There is no patrol running.'); return; }
  if (patrol) { entry.set(offerPatrol(robot, entry)); return; }
  if (/explor|tour|recorr/.test(t)) { const r = startTour(robot); entry.set(`Starting a tour: ${r.route.join(' → ')}. I'll describe each stop.`); return; }
  if (/chair|silla/.test(t)) {
    if (/put|drop|down|leave|place|dej|baj|suelt|pon/.test(t)) {
      if (!robot.carrying) { entry.set('I am not carrying a chair.'); return; }
      const home = /back|where it was|original|its spot|volv|lugar/.test(t);
      enqueue(robot, [putDownChairStep(robot, home ? 'home' : 'here')], !append);
      entry.set(home ? 'Putting the chair back where it was.' : 'Putting the chair down here.'); return;
    }
    if (!robot.cfg.manip) { entry.set(`I can't lift a chair. ${robot.cfg.why}.`); return; }
    if (robot.carrying) { entry.set('I already have a chair over my head. Tell me where to take it or to put it down.'); return; }
    const chair = nearestChair(robot), dest = PLACES.find(q => q.re.test(t)), m = modelInText(t);
    if (!chair) { entry.set('There is no free chair nearby.'); return; }
    if (!append) recordReturn(robot);
    enqueue(robot, [pickUpChairStep(robot, chair, m ?? undefined), ...(dest ? [navTo(robot, dest), putDownChairStep(robot, 'here', m ?? undefined)] : [])], !append);
    entry.set(`On it: pick_up(${CHAIR[chair.kind].name.replace(' ', '_')}) overhead${dest ? ` → navigate_to(${dest.name}) → place(chair)` : '. Click the floor to carry it anywhere'}.`); return;
  }
  if (/what do you see|qu[eé] ves|look around|mir[aá]|describe/.test(t)) { describeView(robot, null, undefined, entry); return; }
  const sk = learned.find(s => t.includes(s.name.toLowerCase()));
  if (sk) { entry.set(runSkill(robot, sk)); return; }
  const spec = keywordSkill(text, null), steps = [];
  if (/close|cerr/.test(t) || (fridge.doorAngle > .3 && robot.cfg.manip && near(robot, FRIDGE_REACH, 1.5) && spec.steps.some(s => s.op === 'navigate_to'))) steps.push({ op: 'close', arg: 'fridge' });
  steps.push(...spec.steps.filter(s => s.op !== 'close'));
  if (!steps.length) { entry.set('I can go places, fetch from the fridge or printer, patrol, explore and describe what I see. Try "bring me a coke in the lounge" or "create a patrol route".'); return; }
  const m = modelInText(t);
  if (m && !usable(m.id)) { entry.set(`${m.name} is not installed. Install it from Apps, or leave the model out.`); return; }
  if (!append) recordReturn(robot);
  enqueue(robot, skillSteps(robot, { steps }, m), !append);
  entry.set(`On it: ${steps.map(fmtOp).join(' → ')}${m && steps.some(s => ['fetch', 'open', 'close', 'hand_over'].includes(s.op)) ? `, manipulation on ${m.name}` : ''}.`);
}
async function runCommand(text, robot = selected, append = false) {
  if (!robot) return;
  const entry = cliEntry(robot, text);
  log(robot, `operator: ${text}`, 'operator');
  await aiReady;
  if (!ai) { keywordCommand(robot, text, entry, append); return; }
  robot.asking?.ctl.abort();
  const ctl = new AbortController(); robot.asking = { text, ctl }; renderQueue();
  const live = log(robot, 'thinking…', 'agent'), b = bubble(robot, '…', 90000);
  entry.set('Thinking…');
  try {
    const opts = { modelTier: 'quick', cache: false, signal: ctl.signal, onText: ({ text: t }) => { live.set(t); entry.set(t); b.set(t, 90000); } };
    if (aiCaps?.images) opts.images = [captureFrame(robot)];
    if (aiCaps?.tools) opts.tools = claudeTools(robot, entry, append);
    const { text: answer } = await ai(claudePrompt(robot, text), opts);
    live.set(answer); entry.set(answer); b.set(answer);
    if (!aiCaps?.tools) keywordCommand(robot, text, cliEntry(robot, null), append);
  } catch (e) {
    b.set('…', 0); aiError(robot, e, entry);
    if (!ai) keywordCommand(robot, text, cliEntry(robot, null), append);
  } finally {
    if (robot.asking?.ctl === ctl) robot.asking = null;
    renderQueue();
  }
}
$('#cli').addEventListener('submit', e => { e.preventDefault(); const t = $('#cli-input').value.trim(); if (!t) return; $('#cli-input').value = ''; runCommand(t); });
$('#cli-stop').onclick = () => { if (!selected) return; selected.asking?.ctl.abort(); stopPatrol(selected, true); cancel(selected); log(selected, 'stopped by operator: queue, patrol and Claude request', 'err'); };
$('#cli-clear').onclick = () => { cliFeed.replaceChildren(); cliFeed.hidden = true; $('#cli-clear').hidden = true; };

// Pie menus, Sims style. The first opens beside the object; each choice chains the next one below it.
// Only the previous (collapsed) and the active pie stay on screen.
let chain = [], chainAnchor = null;
const fridgeCam = { kind: 'fixed', cam: fridge.camera, tag: 'fridge cam · live' };
const printerCam = { kind: 'fixed', cam: printer.camera, tag: 'printer cam · live' };
const wristCam = (robot, m) => ({ kind: 'wrist', robot, tag: m ? `wrist cam · ${m.name}` : 'wrist cam · live' });
function makePie(def) {
  const el = document.createElement('div'); el.className = 'pie';
  el.innerHTML = `<div class="center"><canvas width="328" height="328"></canvas><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div class="tag"><i></i><span>${esc(def.src.tag)}</span></div></div><div class="title glass"><b>${esc(def.title)}</b>${esc(def.sub ?? '')}</div><div class="status glass" hidden></div>`;
  overlays.append(el);
  const pie = { el, def, ctx: el.querySelector('canvas').getContext('2d'), svg: el.querySelector('svg'), status: el.querySelector('.status'), sx: 0, sy: 0 };
  el.querySelector('.center').addEventListener('pointerdown', e => e.stopPropagation());
  setOptions(pie, def.options());
  if (def.status) { pie.status.hidden = false; pie.status.textContent = def.status; }
  return pie;
}
function setOptions(pie, opts) {
  pie.el.querySelectorAll('.opt').forEach(o => o.remove());
  const angles = { 1: [90], 2: [150, 30], 3: [155, 90, 25], 4: [168, 124, 56, 12] }[opts.length];
  const rx = opts.length > 3 ? 196 : 172, ry = opts.length > 3 ? 132 : 128;
  opts.forEach((o, i) => {
    const w = document.createElement('div'), b = document.createElement('button');
    w.className = `opt${o.disabled ? ' off' : ''}`; b.className = 'opt-main'; b.type = 'button'; b.disabled = !!o.disabled;
    b.innerHTML = `${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}`; if (o.title) b.title = o.title;
    w.append(b); if (o.task && !o.disabled) w.append(modelBadge(o.task));
    const a = T.MathUtils.degToRad(angles[i]);
    w.style.left = `${Math.cos(a) * rx}px`; w.style.top = `${-Math.sin(a) * ry}px`;
    w.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); if (!pie.el.classList.contains('collapsed')) o.onPick?.(w); });
    pie.el.append(w); setTimeout(() => w.classList.add('in'), 60 + i * 70);
  });
}
// The mark of the model that will run this task; hover it to pick another model for the same task.
function modelBadge(task) {
  const box = document.createElement('span'); box.className = 'opt-model'; box.dataset.task = task;
  box.render = () => {
    const cur = modelFor(task);
    box.innerHTML = `<button type="button" class="mark" aria-haspopup="menu" aria-label="${TASKS[task]} runs on ${esc(cur.name)}. Change model" title="${TASKS[task]} runs on ${esc(cur.name)}">${MARKS[cur.id]}</button>`
      + `<span class="models" role="menu" aria-label="${TASKS[task]} model">${modelChoices().map(m => `<button type="button" role="menuitemradio" aria-checked="${m.id === cur.id}" data-model="${m.id}">${MARKS[m.id]}<span>${esc(m.name)}<small>${m.builtin ? 'built in' : 'model app'}</small></span></button>`).join('')}</span>`;
  };
  box.render();
  box.addEventListener('click', e => {
    e.stopPropagation();
    const pick = e.target.closest('[data-model]');
    if (!pick) { box.classList.toggle('open'); return; }
    prefs[task] = pick.dataset.model; keep('dimdesk.models', prefs);
    document.querySelectorAll(`.opt-model[data-task="${task}"]`).forEach(x => x.render?.());
    box.classList.remove('open');
    log(selected, `${TASKS[task].toLowerCase()} will run on ${APPS[prefs[task]].name}`, 'agent');
  });
  box.addEventListener('pointerleave', () => box.classList.remove('open'));
  return box;
}
function openChain(anchor, def) { closePies(); chainAnchor = anchor; chain = [makePie(def)]; }
function nextPie(def, from) {
  const prev = chain.at(-1); prev.el.classList.add('collapsed'); from.classList.add('chosen');
  const p = makePie(def); p.from = from; chain.push(p);
  while (chain.length > 2) chain.shift().el.remove();
}
function finishChain(button) { button.classList.add('chosen'); chain.at(-1)?.el.classList.add('collapsed'); setTimeout(closePies, 1100); }
function closePies() { for (const p of chain) p.el.remove(); chain = []; chainAnchor = null; $('#links').replaceChildren(); }
function openPrompt(robot, button, mode, key) {
  const pie = chain.at(-1);
  pie.el.querySelectorAll('.opt').forEach(o => o.classList.toggle('chosen', o === button));
  pie.el.querySelector('form')?.remove();
  const form = document.createElement('form'); form.className = 'glass';
  form.innerHTML = `<input name="prompt" autocomplete="off" placeholder="${mode === 'skill' ? 'e.g. grab the coke and bring it to the café' : 'e.g. bring it to the lounge'}" aria-label="${mode === 'skill' ? 'Describe the new skill' : `Next step for ${esc(robot.id)}`}"><button type="submit">${mode === 'skill' ? 'Teach' : 'Send'}</button>`;
  form.addEventListener('pointerdown', e => e.stopPropagation());
  form.addEventListener('submit', e => {
    e.preventDefault(); const text = form.prompt.value.trim(); if (!text) return;
    form.remove(); finishChain(button);
    if (mode === 'skill') learnSkill(robot, key, text); else runCommand(text, robot, true);
  });
  pie.el.append(form); form.prompt.focus();
}
const promptNext = robot => ({ label: 'Prompt next step…', sub: 'tell the agent', onPick: b => openPrompt(robot, b, 'next') });
const promptSkill = (robot, key) => ({ label: 'Prompt new skill', sub: 'teach it a new skill', onPick: b => openPrompt(robot, b, 'skill', key) });
function sendInstead(key, ref) { const r1 = robots.find(r => r.cfg.manip); return { label: `Send ${r1.id} instead`, sub: `${r1.cfg.model} · two arms`, onPick: () => { select(r1); onObject(key, r1, ref); } }; }
const learnedOpts = (robot, key, room) => learned.filter(s => s.object === key).slice(-Math.max(0, room)).map(s => ({ label: s.name, sub: 'learned skill', onPick: b => { cliEntry(robot, null).set(runSkill(robot, s)); finishChain(b); } }));

function onObject(key, robot, ref) {
  if (key === 'chair') { openChain(() => ref.group.getWorldPosition(V()).setY(ref.carriedBy ? ref.carriedBy.height + .6 : .95), chairMenu(robot, ref)); return; }
  if (key === 'fridge') openChain(() => fridge.local(0, 1.95, .36), fridgeMenu(robot));
  else openChain(() => printer.local(0, .62, .2), printerMenu(robot));
}
function grabOpts(robot, first) {
  return fridgeItems().map(it => ({ label: `Grab ${it.name}`, sub: robot.holding ? 'right gripper is full' : `${it.id} · ${it.conf.toFixed(2)}`, disabled: !!robot.holding, task: 'grasp', onPick: b => chooseGrab(robot, it, b, first) }));
}
function fridgeMenu(robot) {
  return { title: 'Fridge', sub: ` · ${robot.id}`, src: fridgeCam, detect: fridgeItems, options: () => {
    if (!robot.cfg.manip) return [{ label: 'Open the door', sub: 'needs a gripper', disabled: true, title: robot.cfg.why }, sendInstead('fridge'), promptSkill(robot, 'fridge')];
    if (fridge.doorAngle > 1) return [...grabOpts(robot, true), { label: 'Close the door', sub: 'close("fridge.door")', task: 'close', onPick: b => { enqueue(robot, [closeFridgeStep(robot)]); finishChain(b); } }, promptSkill(robot, 'fridge')].slice(0, 4);
    return [{ label: 'Open the door', sub: 'open("fridge.door")', task: 'open', onPick: b => chooseOpenFridge(robot, b) }, promptSkill(robot, 'fridge'), ...learnedOpts(robot, 'fridge', 2)];
  } };
}
function chooseOpenFridge(robot, b) {
  recordReturn(robot);
  enqueue(robot, [openFridgeStep(robot)], true);
  nextPie({ title: 'Fridge', sub: ' · pick an item', src: fridgeCam, detect: fridgeItems, options: () => [...grabOpts(robot), promptNext(robot)],
    status: fridgeItems().length ? `${fridgeItems().length} items detected` : 'Nothing inside' }, b);
}
function chooseGrab(robot, item, b, first = false) {
  // Only the first choice of a menu chain saves where the robot should go back to.
  if (first) recordReturn(robot);
  const m = modelFor('grasp');
  enqueue(robot, [graspStep(robot, item, m)]);
  nextPie(afterMenu(robot, item, m), b);
}
function afterMenu(robot, item, m) {
  const go = (steps, b) => { enqueue(robot, steps); finishChain(b); };
  const opts = item.in === 'fridge' ? [
    { label: 'Close the fridge and go back', sub: 'to where you were', task: 'close', onPick: b => go([closeFridgeStep(robot), homeStep(robot)], b) },
    { label: 'Close the fridge and stay', sub: 'hold position here', task: 'close', onPick: b => go([closeFridgeStep(robot), holdStep(robot)], b) },
  ] : [
    { label: 'Go back to where you were', sub: 'carrying the part', onPick: b => go([homeStep(robot)], b) },
    { label: 'Stay here', sub: 'hold position', onPick: b => go([holdStep(robot)], b) },
  ];
  return { title: 'Next', sub: ` · after ${item.name}`, src: wristCam(robot, m), options: () => [...opts, promptNext(robot)] };
}
function printerMenu(robot) {
  const part = ITEMS.printed_part;
  return { title: '3D printer', sub: ` · ${robot.id}`, src: printerCam, detect: () => inContainer(part) ? [part] : [], options: () => {
    const has = inContainer(part);
    if (!robot.cfg.manip) return [{ label: 'Extract 3D printed piece', sub: 'needs a gripper', disabled: true, title: robot.cfg.why }, sendInstead('printer'), promptSkill(robot, 'printer')];
    return [{ label: 'Extract 3D printed piece', sub: !has ? 'bed is empty' : robot.holding ? 'right gripper is full' : 'printed_part · 0.96', disabled: !has || !!robot.holding, task: 'grasp', onPick: b => chooseExtract(robot, b) }, promptSkill(robot, 'printer'), ...learnedOpts(robot, 'printer', 2)];
  } };
}
const headCam = robot => ({ kind: 'head', robot, tag: 'head cam · live' });
// A put-down queues behind a pick-up that is still running; otherwise it replaces what the robot is doing.
const afterPickup = robot => !(robot.current?.icon === 'chair' || robot.queue.some(q => q.icon === 'chair'));
function carryOpts(robot) {
  return [
    { label: 'Walk around with it', sub: 'then click the floor', onPick: b => { say(robot, 'Got it over my head. Click anywhere on the floor and I will carry it there.'); finishChain(b); } },
    { label: 'Put it down here', sub: 'place("chair")', task: 'grasp', onPick: b => { enqueue(robot, [putDownChairStep(robot, 'here')], afterPickup(robot)); finishChain(b); } },
    { label: 'Put it back where it was', sub: 'to its original spot', task: 'grasp', onPick: b => { enqueue(robot, [putDownChairStep(robot, 'home')], afterPickup(robot)); finishChain(b); } },
  ];
}
function chairMenu(robot, chair) {
  const name = CHAIR[chair.kind].name;
  return { title: name[0].toUpperCase() + name.slice(1), sub: ` · ${robot.id}`, src: headCam(robot), detect: () => chair.carriedBy ? [] : [{ obj: chair.group, id: name.replace(' ', '_'), conf: .98 }], options: () => {
    if (chair.carriedBy === robot) return carryOpts(robot);
    if (!robot.cfg.manip) return [{ label: 'Pick it up overhead', sub: 'needs two arms', disabled: true, title: robot.cfg.why }, sendInstead('chair', chair)];
    if (chair.carriedBy) return [{ label: 'Pick it up overhead', sub: `${chair.carriedBy.id} is carrying it`, disabled: true }];
    const busy = robot.carrying ? 'already carrying a chair' : robot.holding ? 'gripper is full' : null;
    return [
      { label: 'Pick it up overhead', sub: busy ?? `pick_up("${name.replace(' ', '_')}")`, disabled: !!busy, task: 'grasp', onPick: b => chooseChair(robot, chair, b) },
      { label: 'Go next to it', sub: 'navigate_to("chair")', onPick: b => { const ap = chairApproach(poseOf(chair)); enqueue(robot, [navStep(robot, { x: ap.x, z: ap.z, yaw: ap.yaw }, `the ${name}`)], true); finishChain(b); } },
    ];
  } };
}
function chooseChair(robot, chair, b) {
  recordReturn(robot);
  enqueue(robot, [pickUpChairStep(robot, chair, modelFor('grasp'))], true);
  nextPie({ title: 'Chair', sub: ' · overhead', src: headCam(robot), options: () => [carryOpts(robot)[0], carryOpts(robot)[2], promptNext(robot)] }, b);
}
function chooseExtract(robot, b) {
  recordReturn(robot);
  const m = modelFor('grasp');
  enqueue(robot, [graspStep(robot, ITEMS.printed_part, m)], true);
  nextPie(afterMenu(robot, ITEMS.printed_part, m), b);
}
function drawDetections(pie) {
  const items = pie.def.detect?.() ?? [], box = new T.Box3(), parts = [];
  for (const [n, it] of items.entries()) {
    box.setFromObject(it.obj); let x0 = 1, y0 = 1, x1 = -1, y1 = -1, front = true;
    for (const c of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      const p = V(c[0] ? box.max.x : box.min.x, c[1] ? box.max.y : box.min.y, c[2] ? box.max.z : box.min.z).project(feedCam);
      if (p.z > 1) front = false; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (!front || x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) continue;
    const l = (x0 + 1) * 50 - 2, r = (x1 + 1) * 50 + 2, t = (1 - y1) * 50 - 2, b = (1 - y0) * 50 + 2;
    parts.push(`<rect x="${l}" y="${t}" width="${r - l}" height="${b - t}" fill="none" stroke="#96cde8" stroke-width="1.2" vector-effect="non-scaling-stroke"/><text x="${l}" y="${n % 2 ? Math.min(98, b + 6) : Math.max(6, t - 1.5)}" fill="#96cde8" font-size="6" font-family="IBM Plex Mono, monospace">${it.id} ${it.conf.toFixed(2)}</text>`);
  }
  pie.svg.innerHTML = parts.join('');
}

// Apps page: what each app exposes, add-ons to get, install state and the default model.
function appCard(id) {
  const a = APPS[id], on = a.builtin || owned[id];
  const defaults = a.model ? Object.keys(TASKS).filter(t => modelFor(t).id === id).map(t => TASKS[t].toLowerCase()) : [];
  const state = !on ? 'Not installed' : defaults.length ? `Default for ${defaults.join(', ')}` : a.builtin ? 'Built in' : 'Installed';
  const tools = a.tools.map(t => `<li><code>${esc(t.sig)}</code><span>${esc(t.desc)}<small>${esc(t.where)}</small></span><em>${on ? 'Included' : 'Install to use'}</em></li>`).join('');
  const extras = a.extras.map(x => {
    const key = `${id}:${x.key}`;
    return `<li class="extra"><code>${esc(x.sig)}</code><span>${esc(x.desc)}<small>Add-on</small></span>${hasExtra(key) ? '<em class="got">Added</em>' : `<button type="button" data-buy="${key}"${on ? '' : ' disabled'}>Get · ${esc(x.price)}</button>`}</li>`;
  }).join('');
  return `<article class="app" data-app="${id}">
    <header>${MARKS[id]}<div><h3>${esc(a.name)}</h3><p>${esc(a.publisher)} · ${esc(a.kind)}</p></div><span class="app-state${on ? ' on' : ''}">${esc(state)}</span></header>
    <p class="blurb">${esc(a.blurb)}</p>
    <h4 class="label">Skills and tools</h4><ul class="app-tools">${tools}${extras}</ul>
    <footer>${a.model && on && defaults.length < 3 ? `<button type="button" data-default="${id}">Use for all manipulation</button>` : ''}${a.builtin ? '<span>Ships with DimOS</span>' : `<button type="button" data-toggle="${id}">${on ? 'Remove' : 'Install'}</button>`}</footer>
  </article>`;
}
function renderApps() {
  $('#apps').innerHTML = `<div class="apps-head"><div><h2>Apps</h2><p>Plugins your robots run. Model apps power every manipulation; apps like Dimensional Security add skills to the command line.</p></div><button type="button" id="apps-close" aria-label="Close apps">×</button></div>
    <p class="apps-note">Concept mock: the third-party apps are placeholders drawn as monograms. No integration, partnership or payment is real.</p>
    <div class="apps-grid">${['gi', 'pi', 'security', 'classic'].map(appCard).join('')}</div>`;
}
function openApps(focus) {
  closePies(); renderApps(); $('#apps').hidden = false; $('#t-apps').setAttribute('aria-pressed', 'true');
  if (focus) $(`#apps [data-app="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
}
function closeApps() { $('#apps').hidden = true; $('#t-apps').setAttribute('aria-pressed', 'false'); }
$('#t-apps').onclick = () => { if ($('#apps').hidden) openApps(); else closeApps(); };
$('#apps').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'apps-close') { closeApps(); return; }
  if (t.dataset.buy) {
    const [id, k] = t.dataset.buy.split(':'), x = APPS[id].extras.find(q => q.key === k), box = document.createElement('span');
    box.className = 'buy'; box.innerHTML = `<button type="button" class="primary" data-confirm="${t.dataset.buy}">Add for ${esc(x.price)}</button><button type="button" data-cancel>Cancel</button>`;
    t.replaceWith(box); return;
  }
  if (t.dataset.confirm) {
    const [id, k] = t.dataset.confirm.split(':');
    owned.extras.push(t.dataset.confirm); keep('dimdesk.apps', owned);
    log(null, `apps: added ${APPS[id].extras.find(q => q.key === k).sig} to ${APPS[id].name} (concept, no payment)`, 'ok'); renderApps(); return;
  }
  if (t.hasAttribute('data-cancel')) { renderApps(); return; }
  if (t.dataset.default) {
    for (const k of Object.keys(TASKS)) prefs[k] = t.dataset.default;
    keep('dimdesk.models', prefs); log(null, `apps: ${APPS[t.dataset.default].name} now runs all manipulation`, 'ok'); renderApps(); return;
  }
  if (t.dataset.toggle) {
    const id = t.dataset.toggle; owned[id] = !owned[id]; keep('dimdesk.apps', owned);
    if (id === 'security' && !owned[id]) robots.forEach(r => stopPatrol(r));
    log(null, `apps: ${owned[id] ? 'installed' : 'removed'} ${APPS[id].name}`, owned[id] ? 'ok' : 'err'); renderApps();
  }
});

// Overlays follow the scene every frame.
const proj = V();
function toScreen(p) { proj.copy(p).project(camera); return [(proj.x + 1) / 2 * view.clientWidth, (1 - proj.y) / 2 * view.clientHeight]; }
function placeOverlays() {
  const W = view.clientWidth, H = view.clientHeight, narrow = W < 760, right = narrow ? W - 20 : W - 370;
  let paths = '';
  if (chain.length) {
    const [ax, ay] = toScreen(chainAnchor());
    // Keep pies clear of the command bar; chain sideways when there is no room to chain downwards.
    const floor = Math.min(H - 190, $('#cli').getBoundingClientRect().top - overlays.getBoundingClientRect().top - 155);
    const side = ax - 270 > 250 ? -1 : 1, two = chain.length > 1, stack = floor - 250 >= 335;
    let x = ax + side * 255, y = ay + 60;
    if (narrow) { x = W / 2; y = 205; } else { x = Math.min(Math.max(x, 300), Math.max(300, right - 300)); y = Math.min(Math.max(y, 250), Math.max(250, floor - (two && stack ? 335 : 0))); }
    const bx = !narrow && two && !stack ? (x - 400 > 280 ? x - 400 : Math.min(x + 400, Math.max(300, right - 300))) : x;
    chain.forEach((pie, i) => {
      pie.sx = i ? bx : x; pie.sy = y + (i ? (narrow ? 235 : stack ? 335 : 0) : 0);
      pie.el.style.transform = `translate(${pie.sx}px, ${pie.sy}px)${narrow ? ' scale(.68)' : ''}`;
    });
    const first = chain[0], dx = ax - first.sx, dy = ay - first.sy, d = Math.hypot(dx, dy) || 1;
    paths += `<path d="M${first.sx + dx / d * 86},${first.sy + dy / d * 86} L${ax},${ay}"/><circle cx="${ax}" cy="${ay}" r="4"/>`;
    const last = chain.at(-1);
    if (last.from && chain.length > 1) {
      const r = last.from.getBoundingClientRect(), o = overlays.getBoundingClientRect(), fx = r.left + r.width / 2 - o.left, fy = r.top + r.height / 2 - o.top;
      const ex = last.sx - fx, ey = last.sy - fy, e = Math.hypot(ex, ey) || 1;
      paths += `<path d="M${fx},${fy + 18} C${fx},${fy + 90} ${last.sx - ex / e * 150},${last.sy - ey / e * 150} ${last.sx - ex / e * 86},${last.sy - ey / e * 86}"/>`;
    }
  }
  $('#links').innerHTML = paths;
  const now = performance.now();
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (now > b.until) { b.el.remove(); bubbles.splice(i, 1); continue; }
    const [x, y] = toScreen(b.robot.pos.clone().setY(b.robot.height + .35));
    b.el.style.left = `${x}px`; b.el.style.top = `${y}px`;
  }
}

// Input: left-drag pans, so a click is a press that barely moves.
const ray = new T.Raycaster(), ndc = new T.Vector2(), floorPlane = new T.Plane(V(0, 1, 0), 0);
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = V(), floor = ray.ray.intersectPlane(floorPlane, p) && Math.abs(p.x) < 7 && Math.abs(p.z) < 18.2 ? p : null;
  if (draw) return floor ? { floor } : null;
  const hit = ray.intersectObjects([...robots.map(b => b.hit), ...fridge.hitMeshes, ...printer.hitMeshes, ...chairMeshes], false)[0];
  if (hit) return hit.object.userData.robot ? { robot: hit.object.userData.robot } : hit.object.userData.chairRef ? { object: 'chair', ref: hit.object.userData.chairRef } : { object: hit.object.userData.interactive };
  return floor ? { floor } : null;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  down = null; const p = pick(e); if (!p) return;
  if (draw) { addFlag(p.floor); return; }
  if (p.robot) { select(p.robot); closePies(); return; }
  if (p.object && selected) { onObject(p.object, selected, p.ref); return; }
  if (chain.length) { closePies(); return; }
  if (p.floor && selected) {
    const label = `${p.floor.x.toFixed(1)}, ${(-p.floor.z).toFixed(1)}`;
    enqueue(selected, [navStep(selected, { x: p.floor.x, z: p.floor.z }, label)], true);
  }
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
const tip = $('#tip'); let hoverQueued = null;
const OBJ_TIPS = { fridge: 'Fridge · interior camera', printer: '3D printer · print finished' };
renderer.domElement.addEventListener('pointermove', e => {
  if (hoverQueued) return;
  hoverQueued = requestAnimationFrame(() => {
    hoverQueued = null; const p = pick(e);
    const text = draw ? (p?.floor ? `Drop the ${ordinal(draw.flags.length + 1)} flag` : '') : p?.robot ? `${p.robot.id} · ${p.robot.cfg.model}` : p?.object === 'chair' ? (p.ref.carriedBy ? `Chair · carried by ${p.ref.carriedBy.id}` : `${CHAIR[p.ref.kind].name[0].toUpperCase()}${CHAIR[p.ref.kind].name.slice(1)} · pick it up`) : p?.object ? OBJ_TIPS[p.object] : '';
    view.classList.toggle('hover-hit', !!text && !draw); tip.hidden = !text;
    if (text) { tip.textContent = text; tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`; }
  });
});
renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#apps').hidden) closeApps(); else if (draw) stopDrawing(); else closePies(); }
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'q' || e.key === 'Q') rotateView(-Math.PI / 4);
  if (e.key === 'e' || e.key === 'E') rotateView(Math.PI / 4);
});
controls.addEventListener('start', () => { follow = false; $('#focus').setAttribute('aria-pressed', 'false'); });

let swing = null;
function rotateView(delta) {
  const off = camera.position.clone().sub(controls.target), s = new T.Spherical().setFromVector3(off);
  const to = T.MathUtils.clamp(s.theta + delta, controls.minAzimuthAngle, controls.maxAzimuthAngle);
  swing = { from: s.theta, to, s, t: 0 };
}

// Toolbar.
function toggle(id, fn) { const b = $(id); b.onclick = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); fn(on); }; }
toggle('#t-costmap', on => { cmPlane.visible = on; });
toggle('#t-paths', on => { layersOn.paths = on; robots.forEach(r => { if (r.pathViz) r.pathViz.visible = on; }); });
toggle('#t-ceiling', on => { office.layers.lights.visible = office.layers.services.visible = on; });
$('#rot-l').onclick = () => rotateView(-Math.PI / 4); $('#rot-r').onclick = () => rotateView(Math.PI / 4);
$('#reset').onclick = () => location.reload();
$('#estop').onclick = () => {
  if (!selected) return; selected.estop = !selected.estop;
  $('#estop').setAttribute('aria-pressed', String(selected.estop)); $('#estop').textContent = selected.estop ? 'RELEASE E-STOP' : 'E-STOP';
  if (selected.live && selected.estop) { cancel(selected); selected.live.halt(); }
  log(selected, selected.estop ? 'E-STOP engaged: motors held, queue and patrol paused' : 'E-STOP released: resuming', selected.estop ? 'err' : 'ok');
};
$('#focus').onclick = () => { follow = !follow; $('#focus').setAttribute('aria-pressed', String(follow)); };

// Selection, panel and fleet.
function select(robot) {
  selected = robot;
  document.querySelectorAll('.bot').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === robot.id)));
  $('#p-name').textContent = robot.id; $('#cli-who').textContent = `${robot.id} ›`; $('#p-model').textContent = `${robot.cfg.model} · ${robot.cfg.body}`;
  $('#estop').setAttribute('aria-pressed', String(robot.estop)); $('#estop').textContent = robot.estop ? 'RELEASE E-STOP' : 'E-STOP';
  $('#cam-tag').textContent = robot.cfg.sensors[0][0].toLowerCase();
  const video = $('#panel-video'); video.hidden = !robot.live;
  if (robot.live) robot.stopCamera ??= robot.live.camera(video);
  $('#sensors').innerHTML = robot.cfg.sensors.map(([name, frame, hz], i) =>
    `<div class="row"><span class="dot" style="--p:${Math.min(1, Math.max(.14, 4 / hz))}s"></span><span>${name}<small>${frame || 'driver'}</small></span><span id="hz-${i}">${hz} Hz</span></div>`).join('');
  robot.panelJoints = robot.kind === 'r1' ? robot.armJoints('right').map(j => j.name)
    : robot.kind === 'go2' ? ['FL', 'FR', 'RL', 'RR'].flatMap(l => [`${l}_thigh_joint`, `${l}_calf_joint`])
    : ['left', 'right'].flatMap(s => [`${s}_hip_pitch_joint`, `${s}_knee_joint`, `${s}_ankle_pitch_joint`]);
  $('#joints-title').textContent = robot.kind === 'r1' ? 'Right arm joints' : 'Leg joints';
  $('#joints').innerHTML = robot.panelJoints.map(n => `<div class="joint"><span>${n.replace('_joint', '')}</span><span class="bar"><i id="jb-${n}"></i></span><span id="jv-${n}"></span></div>`).join('');
  renderQueue(); updatePanel();
}
function updatePanel() {
  const r = selected; if (!r) return;
  const st = r.estop ? 'E-stop' : r.asking ? 'Thinking' : r.status; const pill = $('#p-status'); pill.dataset.s = st; pill.textContent = st;
  if (r.live) { $('#v-batt').textContent = '—'; $('#v-link').textContent = r.live.fresh ? 'odom live' : 'waiting for odom'; }
  else {
    $('#v-batt').textContent = `${r.battery.toFixed(0)}% · ${(44 + r.battery * .07).toFixed(1)} V`; $('#v-batt-m').style.width = `${r.battery}%`;
    $('#v-link').textContent = `WebRTC ${(26 + Math.random() * 14).toFixed(0)} ms`;
  }
  $('#v-pose').textContent = `${r.pos.x.toFixed(1)}, ${(-r.pos.z).toFixed(1)}, ${Math.round(T.MathUtils.radToDeg(Math.atan2(Math.sin(r.yaw), Math.cos(r.yaw)))) || 0}°`;
  $('#v-loc').textContent = r.live ? r.live.run.blueprint : `${(.955 + Math.random() * .035).toFixed(3)} · office-v0.5`;
  r.cfg.sensors.forEach(([, , hz], i) => { const el = document.getElementById(`hz-${i}`); if (el) el.textContent = `${(hz * (.985 + Math.random() * .03)).toFixed(hz > 50 ? 0 : 1)} Hz`; });
  for (const n of r.panelJoints) {
    const j = r.model.joints[n]; if (!j) continue;
    const lo = j.limit.lower, hi = j.limit.upper, val = j.jointValue[0];
    document.getElementById(`jb-${n}`).style.left = `calc(${T.MathUtils.clamp((val - lo) / (hi - lo || 1), 0, 1) * 100}% - 1px)`;
    document.getElementById(`jv-${n}`).textContent = `${T.MathUtils.radToDeg(val).toFixed(0)}°`;
  }
  document.querySelectorAll('.bot').forEach(b => {
    const bot = robots.find(x => x.id === b.dataset.id);
    b.querySelector('small').textContent = bot.estop ? 'E-stop' : bot.asking ? 'Thinking' : bot.bg && !bot.current ? 'Patrolling' : bot.status;
    b.querySelector('.meter i').style.width = `${bot.battery}%`;
  });
  updateQueueProgress();
}
function portrait(robot) {
  const f = robot.forward(), r = robot.right(), h = robot.height;
  return renderStill(96, 96, () => {
    feedCam.fov = 30; feedCam.position.copy(robot.pos).addScaledVector(f, h * 2.2 + .6).addScaledVector(r, h * .5).setY(h * .95);
    feedCam.lookAt(robot.pos.clone().setY(h * .58));
  });
}

// The live robot: an office robot that mirrors the running blueprint instead of simulating.
function linkLive(r, run) {
  r.live = new Live(run, r.home);
  r.cfg = { ...r.cfg, manip: false, why: 'the live robot only navigates from here', sensors: [['Camera', 'color_image', 30], ['Odometry', 'odom', 30]] };
  let last = null, lastAt = 0;
  r.follow = function (points) {
    const end = points.at(-1);
    return new Promise((resolve, reject) => {
      this.path = { points, i: points.length - 1, resolve, live: true }; this.goalSent = true;
      this.live.goal(end.x, end.z).catch(err => { this.path = null; this.goalSent = false; reject(err); });
    });
  };
  r.update = function (dt, time) {
    const p = this.live.officePose();
    if (p && p !== last) {
      const now = performance.now(), speed = last ? Math.hypot(p.x - last.x, p.z - last.z) / Math.max(.001, (now - lastAt) / 1000) : 0;
      this.speedNow += (Math.min(speed, 2) - this.speedNow) * .5;
      this.pos.x = p.x; this.pos.z = p.z; this.yaw = p.yaw; last = p; lastAt = now;
    }
    if (this.path?.live) {
      const end = this.path.points.at(-1);
      if (Math.hypot(end.x - this.pos.x, end.z - this.pos.z) < .35) { const done = this.path.resolve; this.path = null; this.goalSent = false; done(); }
    } else if (this.goalSent) { this.goalSent = false; this.live.halt(); }
    this.wrap.rotation.y = this.yaw; this.gait(dt, time);
  };
}

// Keys drive the live robot on cmd_vel while held (W/S or ↑/↓ forward and back, A/D or ←/→ turn).
const held = new Set(), DRIVE_KEYS = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, 1], arrowleft: [0, 1], d: [0, -1], arrowright: [0, -1] };
setInterval(() => {
  const live = selected?.live; if (!live) return;
  if (!held.size) { live.stopDriving(); return; }
  let f = 0, t = 0; for (const k of held) { f += DRIVE_KEYS[k][0]; t += DRIVE_KEYS[k][1]; }
  live.drive(Math.sign(f) * .5, Math.sign(t) * 1.0);
}, 100);
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!selected?.live || !DRIVE_KEYS[k] || e.target.closest?.('input, textarea')) return;
  e.preventDefault(); held.add(k); cancel(selected);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

// Boot.
(async () => {
  let loaded = 0;
  const run = await findRun();
  if (run) {
    const kind = kindOf(run.blueprint), dock = snapToFree(costmap, .3, 3.0) ?? { x: .3, z: 3.0 };
    FLEET.unshift({ id: `LIVE-${kind.toUpperCase()}`, kind, x: dock.x, z: dock.z, yaw: -Math.PI / 2, run });
    $('.site .chip').textContent = 'LIVE'; $('.site .chip').title = `${run.blueprint} is running: LIVE-${kind.toUpperCase()} mirrors it, the rest are simulated`;
  }
  const kinds = [...new Set(FLEET.map(f => f.kind))];
  const templates = Object.fromEntries(await Promise.all(kinds.map(async k => {
    const t = await loadTemplate(k); $('#loading').textContent = `Loading robot URDFs ${++loaded}/${kinds.length}`; return [k, t];
  })));
  for (const f of FLEET) { const r = new Robot(f.id, f.kind, templates[f.kind], f, scene); r.queue = []; if (f.run) linkLive(r, f.run); robots.push(r); }
  scene.updateMatrixWorld(true);
  $('#fleet').innerHTML = robots.map(r => `<button class="bot glass" data-id="${r.id}" aria-pressed="false"><img alt="" src="${portrait(r)}"><strong>${r.id}</strong><small>${r.status}</small><span class="meter"><i></i></span></button>`).join('');
  document.querySelectorAll('.bot').forEach(b => {
    const bot = robots.find(x => x.id === b.dataset.id);
    b.onclick = () => { select(bot); closePies(); };
    b.ondblclick = () => { follow = true; $('#focus').setAttribute('aria-pressed', 'true'); };
  });
  $('#loading').hidden = true;
  window.__desk = {
    camera, controls, robots, fridge, printer, ITEMS, APPS, prefs, owned, chairs, openApps, select, onObject, costmap, aim, lookReadout, runCommand, startDrawing, addFlag, startPatrol, stopPatrol, startTour,
    setAI(fn, caps) { ai = fn; aiCaps = caps; setMode(!!fn); }, get chain() { return chain; }, get learned() { return learned; }, get draw() { return draw; },
  };
  select(robots[0]);
  log(null, `${robots.length} robots online · map office-v0.5 · costmap ${costmap.W}×${costmap.H} at 10 cm`);
  log(robots[0], robots[0].live ? `linked to ${robots[0].live.run.blueprint} · click the floor to send it, WASD to drive` : 'ready · two 7-DOF arms, parallel grippers');
  requestAnimationFrame(frame);
})().catch(err => { $('#loading').textContent = `Could not load the robots: ${err.message}`; console.error(err); });

const clock = new T.Clock(); let time = 0, lastPanel = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), .05); time += dt;
  if (swing) {
    swing.t = Math.min(1, swing.t + dt / .45); const e = 1 - (1 - swing.t) ** 3;
    swing.s.theta = swing.from + (swing.to - swing.from) * e;
    camera.position.copy(controls.target).add(V().setFromSpherical(swing.s)); if (swing.t >= 1) swing = null;
  }
  if (follow && selected) { const d = selected.pos.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(d); camera.position.add(d); }
  controls.update();
  for (const r of robots) {
    r.update(dt, time); r.stepTweens(dt);
    r.battery = Math.max(5, r.battery - dt * (r.speedNow > .05 ? .03 : .004));
  }
  if (selected) {
    plumb.position.copy(selected.pos).setY(selected.height + (selected.carrying ? 1.05 : .32) + Math.sin(time * 2.4) * .04); plumb.rotation.y = time * 1.6;
    ring.position.copy(selected.pos).setY(.04); ring.scale.setScalar(1 + Math.sin(time * 3) * .03);
    aimHead(selected, dt); renderView(FEED.pie, FEED.w - FEED.pie, FEED.h); copyView(panelCtx, FEED.pie, FEED.w - FEED.pie, FEED.h);
  }
  const active = chain.at(-1);
  if (active) { aimSource(active.def.src, dt); renderView(0, FEED.pie, FEED.h); copyView(active.ctx, 0, FEED.pie, FEED.h); drawDetections(active); }
  renderer.render(scene, camera);
  placeOverlays();
  if (time - lastPanel > .18) { lastPanel = time; updatePanel(); }
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  requestAnimationFrame(frame);
}
