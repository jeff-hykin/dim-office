// The link to a running dimOS blueprint, through Desktop's gateways (the same plumbing as dim-controller):
// its odom places one office robot, navigation goals go to its goal input, keys drive its velocity input (tele_cmd_vel on a Go2), its camera shows in the panel.
import { DimApp } from 'https://esm.sh/gh/jeff-hykin/dim-app@v0.22.3/source/dim_app.js';

const DEFAULT_TOPICS = { odom: 'odom', goal: 'goal_request', drive: 'cmd_vel', camera: 'color_image' };

const isVelocity = s => /cmd_vel/.test(s.name) && /\.Twist$/.test(s.type ?? '');
function driveTopic(modules) {
  const takers = modules.filter(m => m.streams?.some(s => s.direction === 'in' && isVelocity(s)));
  const muxOut = new Set(takers.flatMap(m => m.streams.filter(s => s.direction === 'out' && isVelocity(s)).map(s => s.topic)));
  const rank = t => /(^|\/)tele_/.test(t) ? 0 : /(^|\/)cmd_vel$/.test(t) ? 1 : /(^|\/)nav_/.test(t) ? 3 : 2;
  const inputs = takers.flatMap(m => m.streams.filter(s => s.direction === 'in' && isVelocity(s) && !muxOut.has(s.topic)).map(s => s.topic));
  return inputs.sort((a, b) => rank(a) - rank(b))[0]?.replace(/^\//, '');
}

// The run's topics by message type and direction, from its blueprint's streams; a name a blueprint lacks keeps the default.
async function topicsOf(blueprint) {
  const topics = { ...DEFAULT_TOPICS };
  try {
    const res = await fetch(`../../dimos-gateway/catalog/blueprints/${encodeURIComponent(blueprint)}`);
    if (!res.ok) return topics;
    const modules = (await res.json()).modules ?? [], streams = modules.flatMap(m => m.streams ?? []);
    const find = (type, direction, prefer) => {
      const all = streams.filter(s => s.type?.endsWith(`.${type}`) && s.direction === direction).map(s => s.topic.replace(/^\//, ''));
      return prefer.map(re => all.find(t => re.test(t))).find(Boolean) ?? all[0];
    };
    topics.odom = find('PoseStamped', 'out', [/^odom$/, /odom/]) ?? topics.odom;
    topics.goal = find('PoseStamped', 'in', [/^goal_request$/, /^goal_pose$/, /goal/]) ?? topics.goal;
    // dim-controller's rule: a velocity input another velocity-taking module outputs is a mux's output (skip it), then tele_* first
    topics.drive = driveTopic(modules) ?? topics.drive;
    topics.camera = find('Image', 'out', [/^color_image$/, /color/, /image/]) ?? topics.camera;
  } catch { /* no catalog: the defaults */ }
  return topics;
}

export const kindOf = blueprint => /g1/i.test(blueprint) ? 'g1' : /r1|galaxea/i.test(blueprint) ? 'r1' : /x2|agibot/i.test(blueprint) ? 'x2' : 'go2';

// The newest running blueprint, or null with no dimos (or no run).
export async function findRun() {
  try {
    const res = await fetch('../../dimos-gateway/runs');
    if (!res.ok) return null;
    const run = (await res.json()).runs?.at(-1);
    return run ? { ...run, topics: await topicsOf(run.blueprint) } : null;
  } catch { return null; }
}

// 2D poses {x, y, th}; the office plane is (x, -z) so its yaw turns the same way as odom's.
const compose = (a, b) => ({ x: a.x + Math.cos(a.th) * b.x - Math.sin(a.th) * b.y, y: a.y + Math.sin(a.th) * b.x + Math.cos(a.th) * b.y, th: a.th + b.th });
const invert = a => ({ x: -Math.cos(a.th) * a.x - Math.sin(a.th) * a.y, y: Math.sin(a.th) * a.x - Math.cos(a.th) * a.y, th: -a.th });
const yawOf = ({ x, y, z, w }) => Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));

export class Live {
  constructor(run, dock) {
    this.run = run;
    this.dock = { x: dock.x, y: -dock.z, th: dock.yaw };
    this.anchor = null; // the first odom pose: where the robot stood when the dock was assigned
    this.pose = null; this.frameId = 'odom'; this.lastAt = 0;
    this.app = new DimApp({ msgDecodeEndpoint: '../../dimos-gateway/msgs.js', connectOptions: { heartbeatHz: 5, heartbeatMisses: 3 } });
    this.app.subscribe(run.topics.odom, ({ header, pose }) => {
      const p = { x: pose.position.x, y: pose.position.y, th: yawOf(pose.orientation) };
      this.anchor ??= p; this.frameId = header?.frame_id || this.frameId; this.lastAt = performance.now();
      this.pose = compose(this.dock, compose(invert(this.anchor), p));
    }, { type: 'geometry_msgs.PoseStamped', delivery: 'latest', maxHz: 30 });
    // Publishers open now but stay silent until a command; the cmd_vel deadman is armed by the first drive input.
    this.goalPub = this.app.publisher(run.topics.goal, 'geometry_msgs.PoseStamped', { delivery: 'latest' });
    this.drivePub = this.app.publisher(run.topics.drive, 'geometry_msgs.Twist', { delivery: 'latest' })
      .then(async pub => { await pub.setDeadman({ linear: { x: 0 }, angular: { z: 0 } }); return pub; });
    this.driving = false;
  }
  get fresh() { return performance.now() - this.lastAt < 1500; }
  // The robot's pose in office coordinates {x, z, yaw}, or null before the first odom.
  officePose() { return this.pose && { x: this.pose.x, z: -this.pose.y, yaw: this.pose.th }; }
  async goal(x, z, yaw = null) {
    if (!this.anchor) throw new Error('no odom from the robot yet');
    const office = { x, y: -z, th: yaw ?? this.pose?.th ?? 0 };
    const p = compose(this.anchor, compose(invert(this.dock), office));
    const pub = await this.goalPub;
    pub.put({
      header: { frame_id: this.frameId, stamp: { sec: Math.floor(Date.now() / 1000), nsec: (Date.now() % 1000) * 1e6 } },
      pose: { position: { x: p.x, y: p.y, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(p.th / 2), w: Math.cos(p.th / 2) } },
    });
  }
  // Cancels a navigation goal by asking for the pose it is at now.
  async halt() {
    const p = this.officePose(); if (p) await this.goal(p.x, p.z, p.yaw);
    await this.stopDriving();
  }
  async drive(forward, turn) {
    const pub = await this.drivePub;
    this.driving = true; pub.put({ linear: { x: forward }, angular: { z: turn } });
  }
  async stopDriving() { if (this.driving) { this.driving = false; (await this.drivePub).stop(); } }
  // Plays the robot's camera into a <video>; returns the unsubscribe.
  camera(video) {
    return this.app.zenoh.subscribe(`dimos/${this.run.topics.camera}/sensor_msgs.Image`, { delivery: 'latest', maxHz: 30, encoding: 'dimos_lcm_image' }, ({ mediaStream }) => {
      if (mediaStream && video.srcObject !== mediaStream) { video.srcObject = mediaStream; video.play().catch(() => {}); }
    });
  }
}
