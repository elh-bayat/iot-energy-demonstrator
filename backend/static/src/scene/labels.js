import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export function makeTextLabelMesh(
  text,
  { w = 0.9, h = 0.22, font = "bold 44px Arial", fg = "#111", bg = "rgba(255,255,255,0.0)" } = {}
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (bg && bg !== "rgba(255,255,255,0.0)") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.font = font;
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 18, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const geo = new THREE.PlaneGeometry(w, h);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 30;
  return mesh;
}

export function addOutline(mesh, color = "#111", opacity = 0.35) {
  const edges = new THREE.EdgesGeometry(mesh.geometry);
  const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const outline = new THREE.LineSegments(edges, lineMat);
  outline.renderOrder = (mesh.renderOrder ?? 0) + 1;
  mesh.add(outline);
  return outline;
}

export function makeLabel(text, className = "") {
  const el = document.createElement("div");
  el.className = `label ${className}`.trim();
  el.textContent = text;
  return new CSS2DObject(el);
}
