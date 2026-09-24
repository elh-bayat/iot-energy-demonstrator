import { $ } from "../utils.js";

/* Centralized DOM lookups so other modules don't re-query repeatedly*/
export function getUI() {
  return {
    // Canvas / overlays
    canvas: $("c"),
    toast: $("toast"),
    modePill: $("modePill"),

    // KPIs
    k_prod: $("k_prod"),
    k_prod_b: $("k_prod_b"),
    k_wind: $("k_wind"),
    k_hydro: $("k_hydro"),
    k_solar: $("k_solar"),
    k_cons: $("k_cons"),
    k_cons_b: $("k_cons_b"),
    k_net: $("k_net"),
    k_grid: $("k_grid"),
    k_soc: $("k_soc"),
    k_co2: $("k_co2"),
    k_priority: $("k_priority"),

    // Controls
    scenarioSel: $("scenario"),
    btnApply: $("btn_apply"),
    btnFit: $("btn_fit"),
    btnEmergency: $("btn_emergency"),
    btnGrid: $("btn_grid"),

    // Right panel
    statusBox: $("statusBox"),
    hintBox: $("hintBox"),

    // Charts
    chart_pc: $("chart_pc"),
    chart_soc: $("chart_soc"),
    chart_split: $("chart_split"),
  };
}
