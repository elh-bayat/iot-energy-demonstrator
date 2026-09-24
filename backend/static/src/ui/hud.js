import { formatKW } from "../utils.js";

/*Updates the leftand right UI panels*/
export function updateHUD(s, ui) {
  ui.k_prod.textContent = formatKW(s.production_kw);
  if (ui.k_wind) ui.k_wind.textContent = `${s.wind_kw.toFixed(2)} kW`;
  if (ui.k_hydro) ui.k_hydro.textContent = `${s.hydro_kw.toFixed(2)} kW`;
  if (ui.k_solar) ui.k_solar.textContent = `${s.solar_kw.toFixed(2)} kW`;
  if (ui.k_prod_b) ui.k_prod_b.textContent = "";

  ui.k_cons.textContent = formatKW(s.consumption_kw);
  ui.k_cons_b.textContent = `House ${s.house_kw.toFixed(2)} • Factory ${s.factory_kw.toFixed(2)} • Hospital ${s.hospital_kw.toFixed(2)}`;

  ui.k_net.textContent = formatKW(s.net_kw);
  ui.k_grid.textContent = `Grid import ${s.grid_import_kw.toFixed(2)} kW • Grid available: ${s.grid_available ? "YES" : "NO"}`;

  ui.k_soc.textContent = `${s.battery_soc.toFixed(0)}%`;
  ui.k_co2.textContent = `CO₂ avoided: ${s.co2_avoided_kg.toFixed(3)} kg`;

  ui.k_priority.textContent = `Hospital: ON (priority)\nFactory: ${s.emergency_mode ? "SHED FIRST" : "ON"}\nHouse: ON`;

  // Mode pill
  ui.modePill.textContent = s.live_mode ? "Live mode" : "Demo mode";
  ui.modePill.style.background = s.live_mode ? "rgba(46,230,199,.40)" : "rgba(255,255,255,.55)";
  ui.modePill.style.color = s.live_mode ? "rgba(234,255,247,.96)" : "rgba(12,44,37,.85)";

  // Device status
  const lr = s.last_rfid;
  ui.statusBox.innerHTML = `
    <div><b>Emergency:</b> ${s.emergency_mode ? "ON" : "OFF"}</div>
    <div><b>Last RFID:</b> ${lr ? `${lr.tag_uid} (${lr.reader_id})` : "—"}</div>
    <div><b>Last update:</b> ${new Date().toLocaleTimeString()}</div>
  `;

  // Teaching hint
  if (s.net_kw < -0.2 && s.grid_available) {
    ui.hintBox.textContent =
      "Deficit: demand exceeds renewables. Grid import is filling the gap. Try increasing wind/hydro/solar or lowering demand.";
  } else if (s.net_kw < -0.2 && !s.grid_available) {
    ui.hintBox.textContent =
      "Grid outage + deficit: battery and load shedding matter. Hospital stays on; factory may be curtailed.";
  } else if (s.net_kw > 0.2) {
    ui.hintBox.textContent = "Surplus: renewables exceed demand. Charge the battery or export to the grid.";
  } else {
    ui.hintBox.textContent =
      "Balanced: renewables closely match demand. Small fluctuations may use battery or grid support.";
  }
}
