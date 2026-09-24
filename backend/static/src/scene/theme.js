import * as THREE from "three";

//Scene themes for different scenarios
const THEMES = {
  sunny_day: {
    ui: "sunny_day",
    bg: "#eef1f4",
    fog: "#eef1f4",
    hemi: { intensity: 0.95, sky: "#ffffff", ground: "#cfe7e1" },
    sun: { intensity: 1.25, color: "#ffffff" },
    exposure: 1.03,
    bloom: 0.75,
    water: { color: "#2b78ff", opacity: 0.92, roughness: 0.12 },
    glow: { intensity: 0.15 },
  },

  night: {
    ui: "night",
    bg: "#0b1220",
    fog: "#0b1220",
    hemi: { intensity: 0.22, sky: "#1a2a44", ground: "#06111f" },
    sun: { intensity: 0.35, color: "#bcd5ff" },
    exposure: 0.78,
    bloom: 1.05,
    water: { color: "#1d3f8a", opacity: 0.88, roughness: 0.18 },
    glow: { intensity: 1.25 },
  },

  wind_lull: {
    ui: "wind_lull",
    bg: "#f1f4f6",
    fog: "#f1f4f6",
    hemi: { intensity: 0.85, sky: "#ffffff", ground: "#d6eee6" },
    sun: { intensity: 1.10, color: "#ffffff" },
    exposure: 1.00,
    bloom: 0.72,
    water: { color: "#2b78ff", opacity: 0.92, roughness: 0.12 },
    glow: { intensity: 0.20 },
  },

  dry_season: {
    ui: "dry_season",
    bg: "#f2efe7",
    fog: "#f2efe7",
    hemi: { intensity: 0.90, sky: "#fff8e6", ground: "#e4dcc8" },
    sun: { intensity: 1.15, color: "#fff3d1" },
    exposure: 1.02,
    bloom: 0.68,
    water: { color: "#2a6bd6", opacity: 0.88, roughness: 0.16 },
    glow: { intensity: 0.10 },
  },

  peak_demand: {
    ui: "peak_demand",
    bg: "#edf4f2",
    fog: "#edf4f2",
    hemi: { intensity: 0.92, sky: "#ffffff", ground: "#cfe7e1" },
    sun: { intensity: 1.20, color: "#ffffff" },
    exposure: 1.00,
    bloom: 0.85,
    water: { color: "#2b78ff", opacity: 0.92, roughness: 0.12 },
    glow: { intensity: 0.35 },
  },

  grid_outage: {
    ui: "grid_outage",
    bg: "#0a0f18",
    fog: "#0a0f18",
    hemi: { intensity: 0.18, sky: "#1a2030", ground: "#070b12" },
    sun: { intensity: 0.22, color: "#9fb3d9" },
    exposure: 0.70,
    bloom: 1.18,
    water: { color: "#183a7c", opacity: 0.85, roughness: 0.20 },
    glow: { intensity: 1.45 },
  },
};

function makeStars() {
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 140 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * (Math.PI * 0.45);
    const x = r * Math.cos(theta) * Math.sin(phi);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(theta) * Math.sin(phi);
    pos[i * 3 + 0] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: "#ffffff", size: 0.35, transparent: true, opacity: 0.75 });
  const p = new THREE.Points(g, m);
  p.visible = false;
  return p;
}

export function createThemeController(ctx, registries, ui) {
  const { scene, renderer, bloom, lights } = ctx;
  const { hemi, sun, moon } = lights;
  const { waterMeshes, glowMats } = registries;
  const toast = ui?.toast;

  // Add stars to the scene
  const stars = makeStars();
  scene.add(stars);

  const nightLamps = new THREE.Group();
  nightLamps.visible = false;
  scene.add(nightLamps);

  function addLamp(x, y, z) {
    const poleMat = new THREE.MeshStandardMaterial({ color: "#4b5563", roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: "#fff7ed", emissive: "#ffcc88", emissiveIntensity: 1.2 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 2.4, 10), poleMat);
    pole.position.set(x, y + 1.2, z);
    pole.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), headMat);
    head.position.set(x, y + 2.35, z);
    head.castShadow = true;

    const light = new THREE.PointLight("#ffcc88", 0.0, 18, 2.0);
    light.position.set(x, y + 2.35, z);
    light.castShadow = false;

    nightLamps.add(pole, head, light);
    return { headMat, light };
  }

  // Place lamps near key assets
  const lampHouse = addLamp(-18, 0.6, -6);
  const lampFactory = addLamp(6, 0.6, -2);
  const lampHospital = addLamp(26, 0.8, 6);

  // Track current look
  let currentScenarioLook = "sunny_day";
  let CURRENT_THEME = "";

  function applyScenarioLook(s) {
    const scenario = s?.scenario || "sunny_day";
    currentScenarioLook = scenario;

    const isNight = scenario === "night";
    const isOutage = scenario === "grid_outage" || (s && s.grid_available === false);

    // Scene background , fog and stars
    if (isNight || isOutage) {
      scene.background = new THREE.Color(isNight ? "#0b1220" : "#121826");
      scene.fog = new THREE.Fog(scene.background, 35, 140);
      stars.visible = isNight;
    } else {
      scene.background = new THREE.Color("#e7eaee");
      scene.fog = null;
      stars.visible = false;
    }

    // Light levels
    if (isNight) {
      hemi.intensity = 0.22;
      sun.intensity = 0.05;
      moon.intensity = 0.38;
      renderer.toneMappingExposure = 0.55;

      bloom.strength = 0.55;
      bloom.radius = 0.35;
      bloom.threshold = 0.80;

      nightLamps.visible = true;
      lampHouse.light.intensity = 0.85;
      lampFactory.light.intensity = 0.65;
      lampHospital.light.intensity = 0.95;
    } else if (isOutage) {
      hemi.intensity = 0.35;
      sun.intensity = 0.12;
      moon.intensity = 0.20;
      renderer.toneMappingExposure = 0.62;

      bloom.strength = 0.42;
      bloom.radius = 0.30;
      bloom.threshold = 0.84;

      nightLamps.visible = true;
      lampHouse.light.intensity = 0.15;
      lampFactory.light.intensity = 0.10;
      lampHospital.light.intensity = 0.95;
    } else {
      hemi.intensity = 0.85;
      sun.intensity = 0.65;
      moon.intensity = 0.0;
      renderer.toneMappingExposure = 0.78;

      bloom.strength = scenario === "peak_demand" ? 0.30 : 0.22;
      bloom.radius = 0.22;
      bloom.threshold = 0.92;

      nightLamps.visible = false;
      lampHouse.light.intensity = 0.0;
      lampFactory.light.intensity = 0.0;
      lampHospital.light.intensity = 0.0;
    }
  }

  function applyThemeFromState(state) {
    const key = THEMES[state?.scenario] ? state.scenario : "sunny_day";
    if (key === CURRENT_THEME) return;
    CURRENT_THEME = key;

    const t = THEMES[key];

    // Scene background and fog
    scene.background = new THREE.Color(t.bg);
    if (!scene.fog) scene.fog = new THREE.Fog(new THREE.Color(t.fog), 90, 220);
    scene.fog.color = new THREE.Color(t.fog);

    // Lights
    hemi.intensity = t.hemi.intensity;
    hemi.color = new THREE.Color(t.hemi.sky);
    hemi.groundColor = new THREE.Color(t.hemi.ground);

    sun.intensity = t.sun.intensity;
    sun.color = new THREE.Color(t.sun.color);

    // Tone mapping over bloom
    renderer.toneMappingExposure = t.exposure;
    bloom.strength = t.bloom;

    // Water materials
    waterMeshes.forEach((m) => {
      if (!m?.material) return;
      if (m.material.color) m.material.color.set(t.water.color);
      if ("opacity" in m.material) m.material.opacity = t.water.opacity;
      if ("roughness" in m.material) m.material.roughness = t.water.roughness;
      m.material.needsUpdate = true;
    });

    // Building glows
    glowMats.forEach((mat) => {
      if (!mat) return;
      mat.emissiveIntensity = t.glow.intensity;
      mat.needsUpdate = true;
    });

    // UI theme hook
    document.body.dataset.theme = t.ui;

    // Toast readability
    if (!toast) return;
    if (t.ui === "night" || t.ui === "grid_outage") toast.classList.add("toastDark");
    else toast.classList.remove("toastDark");
  }

  return {
    applyScenarioLook,
    applyThemeFromState,
    getCurrentScenarioLook: () => currentScenarioLook,
  };
}
