// Fleet: the Hangar Austral robots (official URDF joint trees, decimated meshes), with simple gaits,
// CCD arm IK for the R1 Pro, and per-robot capabilities and sensors taken from their URDF frames.
import * as T from 'three';
import URDFLoader from 'urdf-loader';

export const KINDS = {
  r1: {
    model: 'Galaxea R1 Pro', body: 'Wheeled dual-arm', speed: 1.25, manip: true, camera: 'zed_link',
    sensors: [['Head stereo camera', 'zed_link', 30], ['Left wrist camera', 'left_realsense_link', 15], ['Right wrist camera', 'right_realsense_link', 15], ['IMU', '', 200], ['Joint states', '', 250], ['Wheel odometry', '', 50]],
  },
  g1: {
    model: 'Unitree G1', body: 'Humanoid, 29 DOF', speed: .7, manip: false, why: 'Rubber hands on this G1: it cannot grasp', camera: 'd435_link',
    sensors: [['Depth camera (D435)', 'd435_link', 30], ['LiDAR (MID-360)', 'mid360_link', 10], ['IMU', 'imu_in_torso', 500], ['Joint states', '', 500]],
  },
  x2: {
    model: 'AgiBot X2 Ultra', body: 'Humanoid', speed: .7, manip: false, why: 'No end effector on this X2', camera: 'rgbd_head_front_link',
    sensors: [['Head RGB-D camera', 'rgbd_head_front_link', 30], ['Head stereo camera', 'stereo_head_front_link', 30], ['Chest LiDAR', 'lidar_chest_front_link', 10], ['IMU', 'imu_in_torso_link', 200]],
  },
  go2: {
    model: 'Unitree Go2', body: 'Quadruped', speed: 1.0, manip: false, why: 'Go2 has no arm', camera: 'front_camera',
    sensors: [['Front camera', 'front_camera', 30], ['LiDAR (L1)', 'radar', 11], ['IMU', 'imu', 500], ['Foot contacts', '', 500]],
  },
};
const TINT = { go2: [0x394950, 0x64777e], g1: [0x68777d, 0xaeb8bb], x2: [0x869da5, 0xb8c5c5], r1: [0xb4c0c0, 0x687f88] };

// Each robot's meshes ship as one JSON pack: uint16-quantized positions inside the mesh bounds plus indices.
const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
function unpack({ b, p, i, w }) {
  const q = new Uint16Array(bytes(p)), pos = new Float32Array(q.length);
  for (let k = 0; k < q.length; k++) { const a = k % 3; pos[k] = b[a] + q[k] / 65535 * (b[a + 3] - b[a]); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setIndex(new T.BufferAttribute(w === 32 ? new Uint32Array(bytes(i)) : new Uint16Array(bytes(i)), 1));
  g.computeBoundingSphere(); return g;
}
async function loadURDF(kind) {
  const pack = await (await fetch(`robots/${kind}/meshes.json`)).json();
  return new Promise((resolve, reject) => {
    const loader = new URDFLoader();
    loader.loadMeshCb = (path, manager, done) => {
      const entry = pack[path.split('/').pop().replace(/\.stl$/i, '')];
      entry ? done(new T.Mesh(unpack(entry))) : done(null, new Error(`missing mesh ${path}`));
    };
    loader.load(`robots/${kind}/robot.xml`, resolve, null, reject);
  });
}

function standingPose(model, kind) {
  if (kind === 'go2') for (const leg of ['FL', 'FR', 'RL', 'RR']) { model.setJointValue(`${leg}_thigh_joint`, .8); model.setJointValue(`${leg}_calf_joint`, -1.55); }
  if (kind === 'g1' || kind === 'x2') for (const s of ['left', 'right']) {
    model.setJointValue(`${s}_hip_pitch_joint`, -.1); model.setJointValue(`${s}_knee_joint`, .25); model.setJointValue(`${s}_ankle_pitch_joint`, -.15);
    model.setJointValue(`${s}_elbow_joint`, kind === 'g1' ? .35 : -.35);
  }
}

export async function loadTemplate(kind) {
  const model = await loadURDF(kind);
  standingPose(model, kind);
  model.rotation.x = -Math.PI / 2; model.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(model);
  model.position.y -= bounds.min.y;
  const [shellColor, limbColor] = TINT[kind];
  const mats = { shell: new T.MeshStandardMaterial({ color: shellColor, roughness: .55, metalness: .15, flatShading: true }), limb: new T.MeshStandardMaterial({ color: limbColor, roughness: .6, metalness: .12, flatShading: true }) };
  model.traverse(o => {
    if (!o.isMesh) return;
    let link = o; while (link.parent && !link.isURDFLink) link = link.parent;
    o.material = /torso|pelvis|head|base/i.test(link.name) ? mats.shell : mats.limb;
    o.castShadow = true; o.receiveShadow = true;
  });
  const size = bounds.getSize(new T.Vector3());
  return { model, height: size.y, footprint: Math.max(size.x, size.z) };
}

const v = () => new T.Vector3();

// Cyclic coordinate descent over a joint chain; joint limits come from the URDF via setJointValue.
function ccd(joints, end, target, iterations) {
  const pivot = v(), axis = v(), e = v(), a = v(), b = v(), cross = v();
  for (let n = 0; n < iterations; n++) {
    if (end.getWorldPosition(e).distanceTo(target) < .008) return;
    for (let i = joints.length - 1; i >= 0; i--) {
      const joint = joints[i];
      joint.getWorldPosition(pivot); axis.copy(joint.axis).transformDirection(joint.matrixWorld);
      a.copy(end.getWorldPosition(e)).sub(pivot).projectOnPlane(axis); b.copy(target).sub(pivot).projectOnPlane(axis);
      if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
      a.normalize(); b.normalize();
      const delta = Math.atan2(axis.dot(cross.crossVectors(a, b)), T.MathUtils.clamp(a.dot(b), -1, 1));
      joint.setJointValue(joint.jointValue[0] + delta * .8); joint.updateMatrixWorld(true);
    }
  }
}

export class Robot {
  constructor(id, kind, template, spawn, parent) {
    Object.assign(this, { id, kind, cfg: KINDS[kind], height: template.height });
    this.wrap = new T.Group(); this.wrap.position.set(spawn.x, 0, spawn.z); this.wrap.rotation.y = spawn.yaw; parent.add(this.wrap);
    this.model = template.model.clone(true); this.wrap.add(this.model);
    this.baseY = this.model.position.y;
    this.home = { ...spawn }; this.yaw = spawn.yaw;
    this.path = null; this.speedNow = 0; this.phase = Math.random() * 6; this.estop = false;
    this.battery = 62 + Math.random() * 30; this.status = 'Idle'; this.holding = null;
    this.camLink = this.model.links[this.cfg.camera];
    const r = Math.max(.28, template.footprint * .45);
    this.hit = new T.Mesh(new T.CylinderGeometry(r, r, template.height, 12), new T.MeshBasicMaterial({ visible: false }));
    this.hit.position.y = template.height / 2; this.hit.userData.robot = this; this.wrap.add(this.hit);
    if (kind === 'r1') {
      this.tool = {};
      for (const side of ['left', 'right']) { const t = new T.Object3D(); t.position.set(0, 0, -.115); this.model.links[`${side}_gripper_link`].add(t); this.tool[side] = t; }
      this.setGripper('right', .045); this.setGripper('left', .045);
    }
    this.restPose = this.jointSnapshot();
  }
  get pos() { return this.wrap.position; }
  forward(out = v()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  right(out = v()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  jointSnapshot() { const s = {}; for (const [n, j] of Object.entries(this.model.joints)) if (j.jointType !== 'fixed') s[n] = j.jointValue[0]; return s; }
  headWorld(out = v()) { this.model.updateMatrixWorld(true); return (this.camLink || this.model).getWorldPosition(out); }

  // Drive along waypoints: turn in place when the heading error is large, then roll/walk.
  follow(points) { return new Promise(resolve => { this.path = { points, i: 0, resolve }; }); }
  update(dt, time) {
    if (this.estop) { this.speedNow = 0; return; }
    let target = 0;
    if (this.path) {
      const p = this.path.points[this.path.i], dx = p.x - this.pos.x, dz = p.z - this.pos.z, dist = Math.hypot(dx, dz);
      const last = this.path.i === this.path.points.length - 1;
      if (dist < (last ? .03 : .12)) {
        if (last) { const done = this.path.resolve; this.path = null; done(); }
        else this.path.i++;
      } else {
        const want = Math.atan2(-dz, dx), err = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        const turn = Math.sign(err) * Math.min(Math.abs(err), dt * (this.path.reverse ? 0 : 3.2)); this.yaw += turn;
        const align = Math.max(0, Math.cos(err)) ** 4;
        target = Math.min(this.cfg.speed, dist * 2.2 + .15) * (this.path.reverse ? 1 : align);
        const step = Math.min(dist, this.speedNow * dt);
        this.pos.x += dx / dist * step; this.pos.z += dz / dist * step;
      }
    }
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * 6);
    this.wrap.rotation.y = this.yaw;
    this.gait(dt, time);
  }
  gait(dt, time) {
    const m = this.model, s = this.speedNow;
    if (this.kind === 'r1') { this.model.position.y = this.baseY; return; }
    this.phase += dt * (2.2 + s * 7);
    const amp = Math.min(1, s / .4), sin = Math.sin(this.phase);
    if (this.kind === 'go2') {
      for (const [leg, sign] of [['FL', 1], ['RR', 1], ['FR', -1], ['RL', -1]]) {
        const p = sin * sign;
        m.setJointValue(`${leg}_thigh_joint`, .8 - .32 * p * amp);
        m.setJointValue(`${leg}_calf_joint`, -1.55 - .38 * Math.max(0, Math.cos(this.phase + (sign > 0 ? 0 : Math.PI))) * amp);
      }
      m.position.y = this.baseY + Math.abs(sin) * .008 * amp;
      return;
    }
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const p = sin * sign, lift = Math.max(0, Math.cos(this.phase + (sign > 0 ? 0 : Math.PI)));
      m.setJointValue(`${side}_hip_pitch_joint`, -.1 - .42 * p * amp - .25 * lift * amp);
      m.setJointValue(`${side}_knee_joint`, .25 + .6 * lift * amp);
      m.setJointValue(`${side}_ankle_pitch_joint`, -.15 - .3 * lift * amp + .2 * p * amp);
      m.setJointValue(`${side}_shoulder_pitch_joint`, .3 * p * amp);
    }
    m.position.y = this.baseY - .025 * amp + Math.abs(Math.cos(this.phase)) * .012 * amp + Math.sin(time * 1.7) * .003 * (1 - amp);
  }

  // R1 arm control. Solve to a target from the current pose, then tween in joint space.
  armJoints(side) { return Array.from({ length: 7 }, (_, i) => this.model.joints[`${side}_arm_joint${i + 1}`]); }
  torsoJoints() { return ['torso_joint2', 'torso_joint3'].map(n => this.model.joints[n]).filter(Boolean); }
  solveArm(side, target, approach, iterations = 4, torso = false) {
    this.model.updateMatrixWorld(true);
    const joints = [...(torso ? this.torsoJoints() : []), ...this.armJoints(side)], wrist = this.model.links[`${side}_arm_link6`], tool = this.tool[side];
    const reach = torso ? 6 : 4;
    const pre = approach ? target.clone().addScaledVector(approach, -.2) : null;
    for (let k = 0; k < iterations; k++) {
      if (pre) ccd(joints.slice(0, reach), wrist, pre, 12);
      ccd(approach ? joints.slice(reach - 1) : joints, tool, target, 12);
    }
    ccd(joints, tool, target, 10);
  }
  goalFor(side, target, approach, torso = false) {
    const joints = [...(torso ? this.torsoJoints() : []), ...this.armJoints(side)], before = joints.map(j => j.jointValue[0]);
    this.solveArm(side, target, approach, 4, torso);
    const goal = joints.map(j => j.jointValue[0]);
    joints.forEach((j, i) => j.setJointValue(before[i])); this.model.updateMatrixWorld(true);
    return goal;
  }
  armTo(side, target, approach, seconds = 1, torso = false) {
    return this.tweenJoints([...(torso ? this.torsoJoints() : []), ...this.armJoints(side)], this.goalFor(side, target, approach, torso), seconds);
  }
  armRest(side, seconds = .9) { const joints = [...this.torsoJoints(), ...this.armJoints(side)]; return this.tweenJoints(joints, joints.map(j => this.restPose[j.name] ?? 0), seconds); }
  torsoRest(seconds = .8) { const joints = this.torsoJoints(); return this.tweenJoints(joints, joints.map(j => this.restPose[j.name] ?? 0), seconds); }
  tweenJoints(joints, goal, seconds) {
    const start = joints.map(j => j.jointValue[0]);
    return this.tween(seconds, t => joints.forEach((j, i) => j.setJointValue(start[i] + (goal[i] - start[i]) * t)));
  }
  setGripper(side, w) { for (const n of [1, 2]) this.model.joints[`${side}_gripper_finger_joint${n}`]?.setJointValue(w); }
  toolWorld(side, out = v()) { this.model.updateMatrixWorld(true); return this.tool[side].getWorldPosition(out); }

  // Time-based tweens advance only while the robot is not e-stopped.
  tween(seconds, fn) {
    return new Promise(resolve => { (this.tweens ??= []).push({ t: 0, seconds, fn, resolve }); });
  }
  stepTweens(dt) {
    if (this.estop || !this.tweens?.length) return;
    for (const tw of [...this.tweens]) {
      tw.t = Math.min(1, tw.t + dt / tw.seconds);
      const e = tw.t < .5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      tw.fn(e);
      if (tw.t >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.resolve(); }
    }
  }
}
