import * as THREE from "three";
import { clamp } from "../utils.js";

export const FLOW_COLORS = {
  DC: 0xff8a00,
  AC: 0xff3b30,
  GRID: 0xffd400,
};

/**
 * Glowing moving dots along a curve.
 */
export class FlowDots {
  constructor(curve, color, count = 60) {
    this.curve = curve;
    this.count = count;
    const geo = new THREE.SphereGeometry(0.12, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.speed = 0.10 + Math.random() * 0.07;
    this.power = 1.0;
    this._dummy = new THREE.Object3D();
  }

  setPower(p) {
    this.power = clamp(p, 0, 1);
    this.mesh.material.opacity = 0.25 + 0.75 * this.power;
  }

  update(t) {
    const scale = 0.7 + this.power * 1.25;
    for (let i = 0; i < this.count; i++) {
      const u = (i / this.count + t * this.speed) % 1;
      const p = this.curve.getPointAt(u);
      this._dummy.position.copy(p);
      this._dummy.scale.setScalar(scale);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function makeFlowTube(points, colorHex, radius = 0.09) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geom = new THREE.TubeGeometry(curve, 120, radius, 10, false);

  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 25;
  mesh.userData._flow = { curve, t: Math.random(), speed: 0.22, baseOpacity: 0.80 };
  return mesh;
}

export function animateFlowTube(mesh, dt, power01) {
  const f = mesh?.userData?._flow;
  if (!f) return;

  // pulse brightness with power and time
  f.t += dt * f.speed;
  const pulse = 0.55 + 0.45 * Math.sin(f.t * 6.0);
  mesh.material.opacity = (0.25 + 0.60 * power01) * pulse;
  mesh.material.emissiveIntensity = 0.6 + 1.8 * power01;
}
