import { clamp, niceTime } from "../utils.js";

//Creates the three Chart.js charts and returns an updater.
export function createCharts(ui) {
  const Chart = window.Chart;
  if (!Chart) {
    return {
      updateFromHistory: () => {},
    };
  }

  Chart.defaults.font.family = "'Segoe UI', 'Inter', system-ui, -apple-system";
  Chart.defaults.color = "rgba(240,250,255,0.9)";
  Chart.defaults.borderColor = "rgba(255,255,255,0.08)";

  const glow = {
    id: "glow",
    beforeDatasetsDraw(chart, args, opts) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.shadowBlur = opts?.blur ?? 16;
      ctx.shadowColor = opts?.color ?? "rgba(46,230,199,.25)";
    },
    afterDatasetsDraw(chart) {
      chart.ctx.restore();
    },
  };

  const glassPanel = {
    id: "glassPanel",
    beforeDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom } = chartArea;
      const radius = 12;
      ctx.save();
      const grd = ctx.createLinearGradient(left, top, right, bottom);
      grd.addColorStop(0, opts?.from || "rgba(255,255,255,0.14)");
      grd.addColorStop(1, opts?.to || "rgba(255,255,255,0.06)");
      ctx.fillStyle = grd;
      ctx.strokeStyle = opts?.border || "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      const w = right - left,
        h = bottom - top;
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(left + r, top);
      ctx.lineTo(right - r, top);
      ctx.quadraticCurveTo(right, top, right, top + r);
      ctx.lineTo(right, bottom - r);
      ctx.quadraticCurveTo(right, bottom, right - r, bottom);
      ctx.lineTo(left + r, bottom);
      ctx.quadraticCurveTo(left, bottom, left, bottom - r);
      ctx.lineTo(left, top + r);
      ctx.quadraticCurveTo(left, top, left + r, top);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  };

  const glassy = {
    id: "glassy",
    beforeDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom, width, height } = chartArea;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      const shine = ctx.createRadialGradient(
        left + width * 0.2,
        top + height * 0.2,
        0,
        left + width * 0.2,
        top + height * 0.2,
        width * 0.9
      );
      shine.addColorStop(0, opts?.shine || "rgba(255,255,255,0.32)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = shine;
      ctx.fillRect(left, top, width, height);

      const sheen = ctx.createLinearGradient(left, top, right, bottom);
      sheen.addColorStop(0, "rgba(255,255,255,0.12)");
      sheen.addColorStop(1, "rgba(255,255,255,0.02)");
      ctx.fillStyle = sheen;
      ctx.fillRect(left, top, width, height);

      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = opts?.shadow || "rgba(12,44,37,0.32)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = opts?.border || "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 1, top + 1, width - 2, height - 2);
      ctx.restore();
    },
  };

  // HUD frame lines (corners + inner grid)
  const hudFrame = {
    id: "hudFrame",
    afterDraw(chart, args, opts) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom } = chartArea;
      ctx.save();
      ctx.strokeStyle = opts?.color || "rgba(120,240,255,0.35)";
      ctx.lineWidth = 1.2;
      // outer frame
      ctx.strokeRect(left, top, right - left, bottom - top);
      // corner ticks
      const len = 14;
      const drawCorner = (x, y, dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * len, y);
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + dy * len);
        ctx.stroke();
      };
      drawCorner(left, top, 1, 1);
      drawCorner(right, top, -1, 1);
      drawCorner(left, bottom, 1, -1);
      drawCorner(right, bottom, -1, -1);
      // inner guide lines
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = opts?.grid || "rgba(120,240,255,0.20)";
      ctx.beginPath();
      ctx.moveTo((left + right) / 2, top);
      ctx.lineTo((left + right) / 2, bottom);
      ctx.moveTo(left, (top + bottom) / 2);
      ctx.lineTo(right, (top + bottom) / 2);
      ctx.stroke();
      ctx.restore();
    },
  };

  Chart.register(glow, glassPanel, glassy, hudFrame);

  const commonScales = {
    x: { grid: { color: "rgba(255,255,255,.08)" }, ticks: { maxTicksLimit: 6 } },
    y: { grid: { color: "rgba(255,255,255,.08)" } },
  };

  const pcCtx = ui.chart_pc?.getContext("2d");
  const pcChart = pcCtx
    ? new Chart(pcCtx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Production (kW)",
              data: [],
              borderColor: "rgba(80,220,255,1)",
              backgroundColor: "rgba(80,220,255,0.18)",
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2.4,
            },
            {
              label: "Consumption (kW)",
              data: [],
              borderColor: "rgba(255,140,110,1)",
              backgroundColor: "rgba(255,140,110,0.18)",
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2.4,
            },
            {
              label: "Grid import (kW)",
              data: [],
              borderColor: "rgba(255,114,182,1)",
              backgroundColor: "rgba(255,114,182,0.16)",
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2.2,
              borderDash: [6, 5],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
            glow: { blur: 18, color: "rgba(80,220,255,.22)" },
            glassPanel: {},
            glassy: { shine: "rgba(255,255,255,0.32)", shadow: "rgba(16,53,45,0.28)" },
            hudFrame: {},
          },
          scales: commonScales,
        },
      })
    : null;

  const socCtx = ui.chart_soc?.getContext("2d");
  const socChart = socCtx
    ? new Chart(socCtx, {
        type: "doughnut",
        data: {
          labels: ["SOC", "Remaining"],
          datasets: [
            {
              data: [65, 35],
              backgroundColor: ["rgba(80,220,255,0.78)", "rgba(255,255,255,0.14)"],
              borderColor: "rgba(255,255,255,0.28)",
              borderWidth: 1.2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "78%",
          rotation: -225,
          circumference: 270,
          plugins: {
            legend: { display: false },
            glow: { blur: 18, color: "rgba(80,220,255,.18)" },
            glassPanel: {},
            glassy: { shine: "rgba(255,255,255,0.38)" },
          },
        },
      })
    : null;

  const splitCtx = ui.chart_split?.getContext("2d");
  const splitChart = splitCtx
    ? new Chart(splitCtx, {
        type: "doughnut",
        data: {
          labels: ["Wind", "Hydro", "Solar"],
          datasets: [
            {
              data: [2, 2, 2],
              backgroundColor: ["rgba(80,220,255,0.82)", "rgba(94,234,212,0.82)", "rgba(255,199,120,0.88)"],
              borderColor: "rgba(255,255,255,0.26)",
              borderWidth: 1.2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "70%",
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true, pointStyle: "circle" } },
            glow: { blur: 14, color: "rgba(80,220,255,.15)" },
            glassPanel: {},
            glassy: { shine: "rgba(255,255,255,0.32)" },
          },
        },
      })
    : null;

  function updateFromHistory(items) {
    if (!pcChart || !socChart || !splitChart || !Array.isArray(items) || items.length === 0) return;

    const labels = items.map((it) => niceTime(it.ts));
    pcChart.data.labels = labels;
    pcChart.data.datasets[0].data = items.map((it) => it.production_kw);
    pcChart.data.datasets[1].data = items.map((it) => it.consumption_kw);
    pcChart.data.datasets[2].data = items.map((it) => it.grid_import_kw);
    pcChart.update("none");

    const last = items[items.length - 1];
    const s = clamp(last.battery_soc, 0, 100);
    socChart.data.datasets[0].data = [s, 100 - s];
    socChart.update("none");

    splitChart.data.datasets[0].data = [last.wind_kw, last.hydro_kw, last.solar_kw];
    splitChart.update("none");
  }

  return {
    updateFromHistory,
    charts: { pcChart, socChart, splitChart },
  };
}
