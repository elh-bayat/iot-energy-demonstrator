import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export function createSceneContext({ canvas }) {
  if (!canvas) throw new Error("Canvas element (#c) not found");

  THREE.ColorManagement.enabled = true;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e7eaee");

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 400);
  camera.position.set(42, 38, 54);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 8, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 22;
  controls.maxDistance = 120;

  //Touch interaction
  controls.enableZoom = true;
  controls.zoomSpeed = 0.85;
  controls.enablePan = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // CSS2D labels renderer
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";

  const hemi = new THREE.HemisphereLight("#ffffff", "#cde7e1", 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#ffffff", 0.65);
  sun.position.set(30, 55, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 2;
  scene.add(sun);

  // Scenario lighting (Day/Night)
  const moon = new THREE.DirectionalLight("#b9d5ff", 0.0);
  moon.position.set(-30, 45, -25);
  scene.add(moon);

  // Bloom
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    0.28,
    0.24,
    0.75
  );
  composer.addPass(bloomPass);

  return {
    THREE,
    canvas,
    renderer,
    scene,
    camera,
    controls,
    composer,
    bloom: bloomPass,
    labelRenderer,
    lights: { hemi, sun, moon },
  };
}
