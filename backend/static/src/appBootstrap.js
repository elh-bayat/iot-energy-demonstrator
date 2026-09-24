import { getUI } from "./ui/elements.js";
import { createCharts } from "./ui/charts.js";
import { updateHUD } from "./ui/hud.js";
import { createApi } from "./services/api.js";
import { initScene } from "./scene/index.js";

export async function bootstrap() {
  const ui = getUI();
  const labelParent = document.getElementById("center");
  const loadingScreen = document.getElementById("loadingScreen");

  let loadingHidden = false;
  const loadingStart = performance.now();

  const hideLoading = ({ success = true, message } = {}) => {
    if (!loadingScreen) return;
    if (loadingHidden) return;
    loadingHidden = true;

    if (message) {
      const t = loadingScreen.querySelector(".loadingText");
      if (t) t.textContent = message;
    }

    const elapsed = performance.now() - loadingStart;
    const minSpin = success ? 600 : 2000; // keep visible longer on failure so users notice
    const delay = Math.max(0, minSpin - elapsed);

    setTimeout(() => {
      loadingScreen.classList.add("fade");
      setTimeout(() => loadingScreen.remove(), 260);
    }, delay);
  };

  const api = createApi();
  const charts = createCharts(ui);

  const scene = initScene({ canvas: ui.canvas, labelParent, ui });
  scene.fitView();
  scene.resize();

  let lastState = null;

  async function refreshState() {
    try {
      const s = await api.get("/api/state");
      lastState = s;

      updateHUD(s, ui);
      scene.setState(s);
      scene.theme.applyScenarioLook(s);
      scene.theme.applyThemeFromState(s);

      if (ui.toast) ui.toast.textContent = `${s.live_mode ? "Live mode" : "Demo mode"} • ${String(s.scenario).replaceAll("_", " ")}`;
    } catch (err) {
      if (ui.toast) ui.toast.textContent = "Backend not reachable (is FastAPI running?)";
      console.error(err);
    }
  }

  async function refreshHistory() {
    try {
      const h = await api.get("/api/history?seconds=300");
      charts.updateFromHistory(h.items || []);
    } catch {
      // ignore
    }
  }

  // Buttons
  ui.btnApply?.addEventListener("click", async () => {
    const sc = ui.scenarioSel?.value || "sunny_day";
    try {
      await api.post("/api/scenario/apply", { scenario: sc });
      await refreshState();
      await refreshHistory();
    } catch (e) {
      console.error(e);
    }
  });

  ui.btnEmergency?.addEventListener("click", async () => {
    try {
      const cur = lastState?.emergency_mode || false;
      await api.post("/api/control", { set: { emergency_mode: !cur } });
      await refreshState();
    } catch (e) {
      console.error(e);
    }
  });

  ui.btnGrid?.addEventListener("click", async () => {
    try {
      const cur = lastState?.grid_available ?? true;
      await api.post("/api/control", { set: { grid_available: !cur } });
      await refreshState();
    } catch (e) {
      console.error(e);
    }
  });

  ui.btnFit?.addEventListener("click", scene.fitView);

  // Kickstart
  if (ui.toast) ui.toast.textContent = "Ready";
  try {
    await refreshState();
    await refreshHistory();
    hideLoading({ success: true });
  } catch (err) {
    console.error(err);
    hideLoading({ success: false, message: "Backend not reachable (is FastAPI running?)" });
  }
  setInterval(refreshState, 1000);
  setInterval(refreshHistory, 5000);
}
