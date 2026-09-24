import * as THREE from "three";

// Raycasting-based hover tooltips for 3D scene

export function createHover({ canvas, camera }) {
  const hoverTip = document.createElement("div");
  hoverTip.id = "hoverTip";
  hoverTip.style.position = "fixed";
  hoverTip.style.pointerEvents = "none";
  hoverTip.style.padding = "6px 10px";
  hoverTip.style.background = "rgba(20,31,28,0.92)";
  hoverTip.style.color = "#e9fff5";
  hoverTip.style.borderRadius = "6px";
  hoverTip.style.font = "13px/1.2 'Segoe UI', system-ui, sans-serif";
  hoverTip.style.boxShadow = "0 8px 18px rgba(0,0,0,0.28)";
  hoverTip.style.transform = "translate(-50%, -130%)";
  hoverTip.style.opacity = "0";
  hoverTip.style.transition = "opacity 120ms ease, transform 120ms ease";
  document.body.appendChild(hoverTip);

  const hoverTargets = [];
  const hoverRay = new THREE.Raycaster();
  const hoverPointer = new THREE.Vector2(2, 2);
  let hoverLockUntil = 0; 

  function registerHover(obj, label) {
    if (!obj) return;
    obj.userData.hoverLabel = label;
    hoverTargets.push(obj);
  }

  function pointToScreen(p) {
    const v = p.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  function setHoverPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    hoverPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    hoverPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function updateHover() {
    if (!hoverTargets.length) return;

   
    if (hoverLockUntil && performance.now() > hoverLockUntil) {
      hoverLockUntil = 0;
      hoverPointer.set(2, 2);
      hoverTip.style.opacity = "0";
      hoverTip.style.transform = "translate(-50%, -130%) scale(0.98)";
      return;
    }

    hoverRay.setFromCamera(hoverPointer, camera);
    const hits = hoverRay.intersectObjects(hoverTargets, true);
    const hit = hits.find((h) => h.object.userData.hoverLabel || h.object.parent?.userData.hoverLabel);

    if (!hit) {
      hoverTip.style.opacity = "0";
      hoverTip.style.transform = "translate(-50%, -130%) scale(0.98)";
      return;
    }

    const owner = hit.object.userData.hoverLabel ? hit.object : hit.object.parent;
    const label = owner?.userData.hoverLabel;
    if (!label) return;

    const rect = canvas.getBoundingClientRect();
    const screen = pointToScreen(hit.point);
    hoverTip.textContent = label;
    hoverTip.style.left = `${rect.left + screen.x}px`;
    hoverTip.style.top = `${rect.top + screen.y}px`;
    hoverTip.style.opacity = "1";
    hoverTip.style.transform = "translate(-50%, -130%) scale(1)";
  }

  // Mouse hover to tooltip follows cursor
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    setHoverPointer(e.clientX, e.clientY);
  });

  // Touch hover to tooltip locks for a short time
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
 
    if (!e.isPrimary) return;
    setHoverPointer(e.clientX, e.clientY);
    hoverLockUntil = performance.now() + 1800;
  });

  canvas.addEventListener("pointerleave", () => {
    hoverPointer.set(2, 2);
    hoverTip.style.opacity = "0";
  });

  return {
    registerHover,
    updateHover,
  };
}
