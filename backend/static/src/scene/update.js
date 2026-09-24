import * as THREE from "three";
import { clamp } from "../utils.js";
import { animateFlowTube } from "./flows.js";

// Updates 3D world elements based on the current state
export function create3DUpdater(worldRefs, getScenarioLook) {
  const { turbines, hydro, hospital, house, factory, gridLine, clouds, waterMeshes, flowWindGen, flowWindToHouse, flowHydroToSub, flowSubToFactory, flowSolar } = worldRefs;

  return function update3DFromState(s, t) {
    // Wind rotor speed
    const windSpeed = clamp(s.wind_kw / 6.0, 0, 1);
    turbines.forEach((tr) => {
      const rotor = tr.userData.rotor;
      if (rotor) rotor.rotation.x += 0.06 + windSpeed * 0.28;
    });

    // Hydro waterfall intensity
    const hydroP = clamp(s.hydro_kw / 6.0, 0, 1);
    const substationPowered = hydroP > 0.05 || s.grid_available;
    const substationFlowPower = substationPowered ? Math.max(hydroP, s.grid_available ? 0.5 : 0) : 0;
    const factoryPowered = substationPowered;
    if (hydro.userData.fallMat) {
      hydro.userData.fallMat.opacity = 0.20 + hydroP * 0.80;
    }
    if (hydro.userData.foamMat) {
      hydro.userData.foamMat.opacity = 0.30 + hydroP * 0.40;
    }
    if (hydro.userData.splash) {
      const splashScale = 0.90 + hydroP * 0.80;
      hydro.userData.splash.scale.setScalar(splashScale);
      hydro.userData.splash.material.opacity = 0.20 + hydroP * 0.55;
    }

    // animate waterfall points downward
    const fallPos = hydro.userData.fallPos;
    const fallVel = hydro.userData.fallVel;
    const N = hydro.userData.fallN;
    if (fallPos && N) {
      for (let i = 0; i < N; i++) {
        const idx = i * 3 + 1;
        const v = (fallVel ? fallVel[i] : 0.05) + hydroP * 0.28;
        fallPos[idx] -= v;
        if (fallPos[idx] < -1.3) {
          fallPos[idx] = 4.2;
          if (fallVel) fallVel[i] = 0.05 + Math.random() * 0.08;
        }
      }
    }
    if (hydro.userData.waterfall?.geometry?.attributes?.position) {
      hydro.userData.waterfall.geometry.attributes.position.needsUpdate = true;
    }

    // Whitewater dots movement intensity
    const ww = hydro.userData.whitewaterDots;
    if (ww) {
      const curve = ww.userData.curve;
      const dummy = new THREE.Object3D();
      const speed = 0.12 + hydroP * 0.25;
      for (let i = 0; i < ww.count; i++) {
        const u = (i / ww.count + t * speed) % 1;
        const p = curve.getPointAt(u);
        dummy.position.copy(p);
        dummy.scale.setScalar(0.70 + hydroP * 1.1);
        dummy.updateMatrix();
        ww.setMatrixAt(i, dummy.matrix);
      }
      ww.instanceMatrix.needsUpdate = true;
      ww.material.opacity = 0.30 + hydroP * 0.70;
    }

    // mist motion/opacity
    const mist = hydro.userData.mist;
    if (mist) {
      const arr = mist.pos;
      const base = mist.base;
      const phase = mist.phase;
      const geo = mist.geo;
      for (let i = 0; i < phase.length; i++) {
        const idx = i * 3;
        arr[idx + 0] = base[idx + 0] + Math.sin(t * 0.8 + phase[i]) * 0.25;
        arr[idx + 1] = base[idx + 1] + Math.abs(Math.sin(t * 1.4 + phase[i])) * (0.6 + hydroP * 1.5);
        arr[idx + 2] = base[idx + 2] + Math.cos(t * 0.7 + phase[i]) * 0.22;
      }
      geo.attributes.position.needsUpdate = true;
      mist.points.material.opacity = 0.18 + hydroP * 0.35;
    }

    // Solar / hospital PV emissive
    const solarP = clamp(s.solar_kw / 6.0, 0, 1);
    if (hospital.userData.pvMat) {
      hospital.userData.pvMat.emissiveIntensity = 0.10 + solarP * 0.55;
    }

    // Hospital outline increases in emergency
    if (hospital.userData.glowMat) {
      hospital.userData.glowMat.opacity = s.emergency_mode ? 0.85 : 0.50;
    }

    // Hospital grid feed wire + meter + flow for powered if grid available or solar on
    const hospitalPowered = s.grid_available || solarP > 0.05;
    if (hospital.userData.serviceWire) {
      hospital.userData.serviceWire.material.opacity = hospitalPowered ? 0.75 : 0.25;
      hospital.userData.serviceWire.material.emissiveIntensity = hospitalPowered ? 0.8 : 0.05;
    }
    if (hospital.userData.meterMat) {
      hospital.userData.meterMat.emissiveIntensity = hospitalPowered ? 0.6 : 0.05;
    }
    if (hospital.userData.serviceFlow) {
      hospital.userData.serviceFlow.mesh.visible = hospitalPowered;
      hospital.userData.serviceFlow.setPower(hospitalPowered ? 1 : 0);
    }

    // PV flow tubes
    if (hospital.userData.pvDcTube) animateFlowTube(hospital.userData.pvDcTube, 0.016, solarP);
    if (hospital.userData.pvAcTube) animateFlowTube(hospital.userData.pvAcTube, 0.016, solarP);

    const demo = hospital.children.find((o) => o.name === "HospitalEnergySystem")?.userData?.demo;
    if (demo) {
      demo.dcLedMat.emissiveIntensity = 0.15 + 1.6 * solarP;
      demo.acLedMat.emissiveIntensity = 0.10 + 1.2 * solarP;
    }

    // House window dimming based on grid deficit
    const deficitNoGrid = s.net_kw < -0.2 && !s.grid_available;
    if (house.userData.windowMats) {
      house.userData.windowMats.forEach((m) => (m.emissiveIntensity = deficitNoGrid ? 0.25 : 1.0));
    }

    // house service bulb + drop wire glow based on grid availability
    if (house.userData.bulbMat) {
      house.userData.bulbMat.emissiveIntensity = s.grid_available ? 1.2 : 0.05;
    }
    if (gridLine.userData.serviceWire) {
      gridLine.userData.serviceWire.material.opacity = s.grid_available ? 0.75 : 0.25;
      gridLine.userData.serviceWire.material.emissiveIntensity = s.grid_available ? 0.8 : 0.05;
    }

    // Factory beacon and smoke stacks
    if (factory.userData.beaconMat) {
      const base = factoryPowered ? 1.25 : 0.12;
      factory.userData.beaconMat.emissiveIntensity = s.emergency_mode ? Math.max(base, 0.6) : base;
    }
    if (factory.userData.smokes) {
      factory.userData.smokes.forEach((puff, i) => {
        puff.visible = factoryPowered;
        if (!factoryPowered) return;
        puff.position.y = puff.userData.baseY + Math.sin(t * 1.3 + puff.userData.phase) * 0.25 + i * 0.02;
        puff.position.x += Math.sin(t * 0.3 + i) * 0.002;
      });
    }

    // Flow tubes
    flowWindGen.setPower(windSpeed);
    flowWindToHouse.setPower(windSpeed);
    if (flowHydroToSub) {
      flowHydroToSub.mesh.visible = substationPowered;
      flowHydroToSub.setPower(substationFlowPower);
    }
    if (flowSubToFactory) {
      flowSubToFactory.mesh.visible = factoryPowered;
      flowSubToFactory.setPower(substationFlowPower);
    }
    flowSolar.setPower(solarP);

    // clouds drift
    clouds.children.forEach((c) => {
      c.position.x += (c.userData.speed || 0.3) * 0.02;
      if (c.position.x > 60) c.position.x = -60;
    });

    // subtle water normal scroll
    if (Array.isArray(waterMeshes)) {
      waterMeshes.forEach((m) => {
        const mat = m?.material;
        const tex = mat?.normalMap;
        const scroll = m?.userData?.waterScroll;
        if (!tex || !scroll) return;
        tex.offset.x = (t * scroll.x) % 1;
        tex.offset.y = (t * scroll.y) % 1;
      });
    }

    // energy dots update
    flowWindGen.update(t);
    flowWindToHouse.update(t);
    if (flowHydroToSub?.mesh?.visible) flowHydroToSub.update(t);
    if (flowSubToFactory?.mesh?.visible) flowSubToFactory.update(t);
    flowSolar.update(t);
    if (hospital.userData.serviceFlow) {
      hospital.userData.serviceFlow.update(t);
    }

    // Night window boost
    if (getScenarioLook?.() === "night") {
      if (hospital?.userData?.winMat) hospital.userData.winMat.emissiveIntensity = 1.35;
      if (house?.userData?.windowMats) {
        house.userData.windowMats.forEach((m) => (m.emissiveIntensity = Math.max(m.emissiveIntensity, 1.15)));
      }
    }
  };
}
