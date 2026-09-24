import { createSceneContext } from "./createScene.js";
import { createHover } from "./hover.js";
import { createWorld } from "./world.js";
import { createThemeController } from "./theme.js";
import { create3DUpdater } from "./update.js";
import { clamp } from "../utils.js";
import { animateFlowTube } from "./flows.js";

// Initializes the 3D scene and returns the scene controller
export function initScene({ canvas, labelParent, ui }) {
  const ctx = createSceneContext({ canvas });

  // Attach CSS2D labels overlay into the same stacking context as the canvas
  if (labelParent) labelParent.appendChild(ctx.labelRenderer.domElement);

  const hover = createHover({ canvas, camera: ctx.camera });

  const registries = { waterMeshes: [], glowMats: [] };

  const theme = createThemeController(ctx, registries, ui);

  const worldRefs = createWorld(ctx, hover, registries);

  const update3DFromState = create3DUpdater(worldRefs, theme.getCurrentScenarioLook);

  // Public state
  let lastState = null;

  function setState(s) {
    lastState = s;
  }

  function fitView() {
    ctx.controls.target.set(0, 8, 0);
    ctx.camera.position.set(44, 40, 55);
    ctx.controls.update();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h, false);
    ctx.composer.setSize(w, h);
    ctx.bloom.setSize(w, h);
    ctx.labelRenderer.setSize(w, h);
  }

  window.addEventListener("resize", resize);

  // Animation loop
  const t0 = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    ctx.controls.update();

    const t = (performance.now() - t0) / 1000;

    if (lastState) {
      update3DFromState(lastState, t);

      // Additional hospital PV system tube animations 
      const hospitalSystem = worldRefs.hospitalSystem;
      if (hospitalSystem?.userData?.lines) {
        const solarP = clamp((lastState.solar_kw || 0) / 3.0, 0, 1);
        const gridP = clamp((lastState.grid_import_kw || 0) / 4.0, 0, 1);
        const { dcLine, acLine, gridLine } = hospitalSystem.userData.lines;

        if (dcLine) animateFlowTube(dcLine, 0.016, solarP);
        if (acLine) animateFlowTube(acLine, 0.016, solarP);

        if (gridLine) {
          const gridAvail = !!lastState.grid_available;
          gridLine.visible = gridAvail || gridP > 0.02;
          if (gridLine.visible) animateFlowTube(gridLine, 0.016, gridAvail ? Math.max(gridP, 0.15) : gridP);
        }
      }
    }

    hover.updateHover();

    ctx.composer.render();
    ctx.labelRenderer.render(ctx.scene, ctx.camera);
  }
  animate();

  // Initial look
  theme.applyThemeFromState({ scenario: "sunny_day" });

  return {
    ctx,
    hover,
    world: worldRefs,
    theme,
    registries,
    setState,
    fitView,
    resize,
  };
}
