from __future__ import annotations

import time
from pathlib import Path
from collections import deque
from dataclasses import dataclass, asdict
from typing import Deque, Dict, Optional, Any

from fastapi import FastAPI, Body, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

HISTORY_SECONDS_DEFAULT = 300
HISTORY_MAX_POINTS = 3000           

SCENARIOS: Dict[str, Dict[str, float]] = {
    "sunny_day": dict(wind_kw=2.2, hydro_kw=2.4, solar_kw=1.8, house_kw=1.2, factory_kw=2.2, hospital_kw=1.3),
    "night": dict(wind_kw=2.0, hydro_kw=2.4, solar_kw=0.05, house_kw=1.1, factory_kw=2.0, hospital_kw=1.4),
    "wind_lull": dict(wind_kw=0.3, hydro_kw=2.6, solar_kw=1.2, house_kw=1.2, factory_kw=2.2, hospital_kw=1.3),
    "dry_season": dict(wind_kw=2.0, hydro_kw=0.6, solar_kw=1.5, house_kw=1.2, factory_kw=2.2, hospital_kw=1.3),
    "peak_demand": dict(wind_kw=2.2, hydro_kw=2.4, solar_kw=1.2, house_kw=1.6, factory_kw=3.1, hospital_kw=1.5),
    "grid_outage": dict(wind_kw=1.8, hydro_kw=2.1, solar_kw=0.8, house_kw=1.2, factory_kw=2.2, hospital_kw=1.4),
}




@dataclass
class RFIDEvent:
    tag_uid: str
    reader_id: str
    ts: float


@dataclass
class Telemetry:
 
    wind_kw: float = 0.0
    hydro_kw: float = 0.0
    solar_kw: float = 0.0
  
    house_kw: float = 0.0
    factory_kw: float = 0.0
    hospital_kw: float = 0.0
   
    battery_soc: float = 55.0  
    grid_available: bool = True
    emergency_mode: bool = False
    
    scenario: str = "sunny_day"
    live_mode: bool = False 
    last_rfid: Optional[RFIDEvent] = None


"""Scenario state"""
state = Telemetry(**SCENARIOS["sunny_day"])


history: Deque[Dict[str, Any]] = deque(maxlen=HISTORY_MAX_POINTS)

co2_avoided_kg = 0.0
_last_tick = time.time()


def _now() -> float:
    return time.time()


def _compute_and_store_sample() -> None:
    """Compute derived values and push to history.
    Also updates CO2 avoided with a very simple model."""
    global co2_avoided_kg, _last_tick

    ts = _now()
    dt = max(0.0, ts - _last_tick)
    _last_tick = ts

    # production/consumption
    production = max(0.0, state.wind_kw) + max(0.0, state.hydro_kw) + max(0.0, state.solar_kw)
    consumption = max(0.0, state.house_kw) + max(0.0, state.factory_kw) + max(0.0, state.hospital_kw)

    # net positive = surplus
    net = production - consumption

    # grid import if deficit and grid is available
    grid_import = 0.0
    if net < 0 and state.grid_available:
        grid_import = -net

    # if surplus then charge, if deficit and grid not available then discharge
    soc = state.battery_soc
    if net > 0:
        soc += dt * 0.25 
    else:
        if not state.grid_available:
            soc += dt * (-0.35) 
    soc = clamp(soc, 0.0, 100.0)
    state.battery_soc = soc

    # assume grid electricity is 0.35 kgCO2/kWh
    avoided_kwh = min(production, consumption) * (dt / 3600.0)
    co2_avoided_kg += avoided_kwh * 0.35

    history.append({
        "ts": ts,
        "wind_kw": float(state.wind_kw),
        "hydro_kw": float(state.hydro_kw),
        "solar_kw": float(state.solar_kw),
        "house_kw": float(state.house_kw),
        "factory_kw": float(state.factory_kw),
        "hospital_kw": float(state.hospital_kw),
        "production_kw": float(production),
        "consumption_kw": float(consumption),
        "net_kw": float(net),
        "grid_import_kw": float(grid_import),
        "battery_soc": float(state.battery_soc),
    })


def clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


# Seed history so that  charts are not empty at start
for _ in range(30):
    _compute_and_store_sample()
    time.sleep(0.01)



"""FASTAPI APP SETUP"""
app = FastAPI(title="Energy Demonstrator API")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
def root() -> HTMLResponse:
    with open(STATIC_DIR / "index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

"""ENDPOINTS"""

@app.get("/api/state")
def get_state() -> Dict[str, Any]:
    """Return the exact shape app.js expects."""
    _compute_and_store_sample()

    production = state.wind_kw + state.hydro_kw + state.solar_kw
    consumption = state.house_kw + state.factory_kw + state.hospital_kw
    net = production - consumption

    grid_import = 0.0
    if net < 0 and state.grid_available:
        grid_import = -net

    out = {
        "scenario": state.scenario,
        "live_mode": state.live_mode,

        "wind_kw": float(state.wind_kw),
        "hydro_kw": float(state.hydro_kw),
        "solar_kw": float(state.solar_kw),

        "house_kw": float(state.house_kw),
        "factory_kw": float(state.factory_kw),
        "hospital_kw": float(state.hospital_kw),

        "production_kw": float(production),
        "consumption_kw": float(consumption),
        "net_kw": float(net),
        "grid_import_kw": float(grid_import),

        "battery_soc": float(state.battery_soc),
        "grid_available": bool(state.grid_available),
        "emergency_mode": bool(state.emergency_mode),

        "co2_avoided_kg": float(co2_avoided_kg),

        "last_rfid": asdict(state.last_rfid) if state.last_rfid else None,
    }
    return out


@app.get("/api/history")
def get_history(seconds: int = Query(HISTORY_SECONDS_DEFAULT, ge=10, le=3600)) -> Dict[str, Any]:
    """Return time-series for charts, last N seconds."""
    now = _now()
    cutoff = now - seconds
    items = [it for it in history if it["ts"] >= cutoff]
    return {"items": items}


@app.post("/api/scenario/apply")
def apply_scenario(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Switch demo scenario. If live telemetry is active, you can still apply a scenario
    but it mainly serves as a 'mode' + defaults."""
    scenario = str(payload.get("scenario", "sunny_day"))
    if scenario not in SCENARIOS:
        scenario = "sunny_day"

    state.scenario = scenario

    # Apply default values
    defaults = SCENARIOS[scenario]
    state.wind_kw = float(defaults["wind_kw"])
    state.hydro_kw = float(defaults["hydro_kw"])
    state.solar_kw = float(defaults["solar_kw"])
    state.house_kw = float(defaults["house_kw"])
    state.factory_kw = float(defaults["factory_kw"])
    state.hospital_kw = float(defaults["hospital_kw"])

    # Grid outage scenario implies grid down unless user overrides later
    if scenario == "grid_outage":
        state.grid_available = False
    else:
        state.grid_available = True
    """scenario apply implies demo mode unless telemetry comes in"""
    state.live_mode = False
    _compute_and_store_sample()
    return {"ok": True, "scenario": scenario}


@app.post("/api/control")
def control(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Generic control endpoint used by UI toggles.
    Example payload from UI:
    { "set": { "emergency_mode": true } }
    { "set": { "grid_available": false } }
    You may also set power values manually:
    { "set": { "wind_kw": 2.0, "house_kw": 1.4 } }
    """
    set_obj = payload.get("set", {}) or {}

    if "emergency_mode" in set_obj:
        state.emergency_mode = bool(set_obj["emergency_mode"])

    if "grid_available" in set_obj:
        state.grid_available = bool(set_obj["grid_available"])

    # Optional manual overrides
    for k in ["wind_kw", "hydro_kw", "solar_kw", "house_kw", "factory_kw", "hospital_kw", "battery_soc"]:
        if k in set_obj:
            try:
                v = float(set_obj[k])
                setattr(state, k, v)
            except Exception:
                pass

    _compute_and_store_sample()
    return {"ok": True}


@app.post("/api/telemetry")
def post_telemetry(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """ESP32 posts live telemetry here.
    Expected JSON keys (any subset allowed):
      wind_kw, hydro_kw, solar_kw, house_kw, factory_kw, hospital_kw
      battery_soc
      grid_available, emergency_mode
      scenario
      rfid_tag_uid, rfid_reader_id  (optional)
    """
    # mark as live by default is True
    state.live_mode = True

    # update numeric fields if present
    for k in ["wind_kw", "hydro_kw", "solar_kw", "house_kw", "factory_kw", "hospital_kw", "battery_soc"]:
        if k in payload:
            try:
                setattr(state, k, float(payload[k]))
            except Exception:
                pass

    # update booleans
    if "grid_available" in payload:
        state.grid_available = bool(payload["grid_available"])
    if "emergency_mode" in payload:
        state.emergency_mode = bool(payload["emergency_mode"])

    # scenario
    if "scenario" in payload and str(payload["scenario"]) in SCENARIOS:
        state.scenario = str(payload["scenario"])

    # RFID event
    tag = payload.get("rfid_tag_uid")
    reader = payload.get("rfid_reader_id")
    if tag and reader:
        state.last_rfid = RFIDEvent(tag_uid=str(tag), reader_id=str(reader), ts=_now())

    _compute_and_store_sample()
    return {"ok": True}


@app.post("/api/rfid")
def post_rfid(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """If you prefer sending RFID separately:
    { "tag_uid": "...", "reader_id": "hospital" }
    """
    tag = str(payload.get("tag_uid", "")).strip()
    reader = str(payload.get("reader_id", "")).strip()
    if tag and reader:
        state.last_rfid = RFIDEvent(tag_uid=tag, reader_id=reader, ts=_now())
        state.live_mode = True
        _compute_and_store_sample()
    return {"ok": True}
