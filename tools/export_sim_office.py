# One-off: the MuJoCo office_555 scene's visual geoms -> one GLB, y-up (three.js: x = world x, z = -world y).
import sys, xml.etree.ElementTree as ET, numpy as np, mujoco, trimesh
from pathlib import Path
root_dir = Path(sys.argv[1]); out = sys.argv[2]
root = ET.parse(root_dir / "scene_office_555.xml").getroot()
for el, folder in [("mesh", "meshes"), ("texture", "textures")]:
    for a in root.iter(el):
        if a.get("file"): a.set("file", (root_dir / folder / a.get("file")).as_posix())
m = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding="unicode")); d = mujoco.MjData(m); mujoco.mj_forward(m, d)
from collections import Counter
Y_UP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)
parts = []
for g in range(m.ngeom):
    if m.geom_group[g] == 3 or m.geom_type[g] == mujoco.mjtGeom.mjGEOM_PLANE: continue
    t, size = m.geom_type[g], m.geom_size[g].copy()
    # the ground floor only (the upper storey and ceiling lights start above 2.4 m); walls cut down to 1.2 m so the view sees in
    if d.geom_xpos[g][2] > 2.4 or d.geom_xpos[g][2] < -.5: continue
    cut = t == mujoco.mjtGeom.mjGEOM_BOX and size[2] > .75 and abs(d.geom_xmat[g][8]) > .99
    if t == mujoco.mjtGeom.mjGEOM_MESH:
        mid = m.geom_dataid[g]; va, vn = m.mesh_vertadr[mid], m.mesh_vertnum[mid]; fa, fn = m.mesh_faceadr[mid], m.mesh_facenum[mid]
        mesh = trimesh.Trimesh(m.mesh_vert[va:va + vn].copy(), m.mesh_face[fa:fa + fn].copy(), process=False)
    elif t == mujoco.mjtGeom.mjGEOM_BOX: mesh = trimesh.creation.box(extents=2 * size)
    elif t == mujoco.mjtGeom.mjGEOM_CYLINDER: mesh = trimesh.creation.cylinder(radius=size[0], height=2 * size[1], sections=24)
    elif t == mujoco.mjtGeom.mjGEOM_SPHERE: mesh = trimesh.creation.icosphere(radius=size[0], subdivisions=2)
    elif t == mujoco.mjtGeom.mjGEOM_CAPSULE: mesh = trimesh.creation.capsule(radius=size[0], height=2 * size[1])
    else: continue
    T = np.eye(4); T[:3, :3] = d.geom_xmat[g].reshape(3, 3); T[:3, 3] = d.geom_xpos[g]
    if cut:
        bottom = d.geom_xpos[g][2] - size[2]
        mesh = trimesh.creation.box(extents=[2 * size[0], 2 * size[1], 1.2]); T[2, 3] = bottom + .6
    mesh.apply_transform(Y_UP @ T)
    rgba = m.mat_rgba[m.geom_matid[g]] if m.geom_matid[g] >= 0 else m.geom_rgba[g]
    if rgba[3] < .05: continue
    mesh.visual = trimesh.visual.ColorVisuals(mesh, face_colors=np.tile((np.array(rgba) * 255).astype(np.uint8), (len(mesh.faces), 1)))
    parts.append(mesh)
merged = trimesh.util.concatenate(parts)
print("geoms", len(parts), "faces", len(merged.faces), "bounds", merged.bounds.round(2).tolist())
merged.export(out)
