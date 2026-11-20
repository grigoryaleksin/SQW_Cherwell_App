"use strict";

// Cherwell: three clickable areas (aggregates of LSOAs) with population and jobs charts.

const AREAS = ["Banbury", "Bicester", "Kidlington"];
const AREA_COLOURS = { Banbury: "#1b6ca8", Bicester: "#d9822b", Kidlington: "#2f9468" };

const BASE_WEIGHT = 1.5;
const HOVER_STYLE = { weight: 3, color: "#000000" };

// CARTO's free basemaps now need an API key, or they show an "API KEY REQUIRED"
// watermark. Optional: request a free key at https://www.carto.com/basemaps/apikey/
// and paste it between the quotes to add the CARTO basemaps. Leave it empty to
// use only the key-free basemaps (Esri light grey, OpenStreetMap).
const CARTO_KEY = "";

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = OSM_ATTR + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';
const ESRI_ATTR = "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ";

let areaGeo, popByArea, jobsByArea;
let map, areaLayer = null, popChart = null, jobsChart = null;
let selectedArea = null;   // null = all three areas shown equally

const el = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

function groupByKey(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  for (const series of groups.values()) series.sort((a, b) => a.year - b.year);
  return groups;
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Value for one area in one year (null if missing)
function valueFor(byArea, area, year, field) {
  const row = (byArea.get(area) || []).find((r) => r.year === year);
  return row && row[field] !== null && row[field] !== undefined ? row[field] : null;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function isOn(area) {
  return !selectedArea || selectedArea === area;
}

function drawCharts() {
  const popYears = [...new Set([...popByArea.values()].flat().map((r) => r.year))].sort((a, b) => a - b);
  const jobYears = [...new Set([...jobsByArea.values()].flat().map((r) => r.year))].sort((a, b) => a - b);
  const suffix = selectedArea ? `: ${selectedArea} highlighted` : "";

  const popDatasets = AREAS.map((a) => ({
    label: a,
    data: popYears.map((y) => valueFor(popByArea, a, y, "population")),
    borderColor: rgba(AREA_COLOURS[a], isOn(a) ? 1 : 0.2),
    backgroundColor: rgba(AREA_COLOURS[a], isOn(a) ? 1 : 0.2),
    borderWidth: selectedArea === a ? 4 : 2,
    pointRadius: 3,
    tension: 0,
  }));

  // One dataset per year; bars are paler for the earlier year
  const jobDatasets = jobYears.map((y, i) => ({
    label: String(y),
    data: AREAS.map((a) => valueFor(jobsByArea, a, y, "jobs")),
    backgroundColor: AREAS.map((a) => rgba(AREA_COLOURS[a], isOn(a) ? (i === 0 ? 0.5 : 1) : 0.12)),
    borderColor: AREAS.map((a) => rgba(AREA_COLOURS[a], isOn(a) ? 1 : 0.2)),
    borderWidth: 1,
  }));

  if (!popChart) {
    popChart = new Chart(el("pop-chart"), {
      type: "line",
      data: { labels: popYears, datasets: popDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          title: { display: true, text: "", font: { size: 15 } },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Population" },
            ticks: { callback: (v) => v.toLocaleString("en-GB") },
          },
        },
      },
    });

    jobsChart = new Chart(el("jobs-chart"), {
      type: "bar",
      data: { labels: AREAS, datasets: jobDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: "", font: { size: 15 } },
          legend: {
            // The default legend swatch would use one area's colour; keep it neutral
            labels: { generateLabels: (c) => c.data.datasets.map((d, i) => ({
              text: d.label,
              fillStyle: i === 0 ? "#bbbbbb" : "#666666",
              strokeStyle: "#666666",
              lineWidth: 1,
              hidden: !c.isDatasetVisible(i),
              datasetIndex: i,
            })) },
          },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Employee jobs" },
            ticks: { callback: (v) => v.toLocaleString("en-GB") },
          },
        },
      },
    });
  } else {
    popChart.data.labels = popYears;
    popChart.data.datasets = popDatasets;
    jobsChart.data.labels = AREAS;
    jobsChart.data.datasets = jobDatasets;
  }

  popChart.options.plugins.title.text = `Population by area${suffix}`;
  jobsChart.options.plugins.title.text = `Employee jobs (BRES) by area${suffix}`;
  popChart.update();
  jobsChart.update();
}

// Short text summary in the sidebar for the current selection
function updateSummary() {
  const areas = selectedArea ? [selectedArea] : AREAS;
  const popYears = [...new Set([...popByArea.values()].flat().map((r) => r.year))].sort((a, b) => a - b);
  const jobYears = [...new Set([...jobsByArea.values()].flat().map((r) => r.year))].sort((a, b) => a - b);
  const total = (byArea, y, f) => areas.reduce((s, a) => s + (valueFor(byArea, a, y, f) || 0), 0);

  const lines = [];
  if (popYears.length) {
    const y0 = popYears[0], y1 = popYears[popYears.length - 1];
    const p0 = total(popByArea, y0, "population"), p1 = total(popByArea, y1, "population");
    const chg = p0 ? ((p1 / p0 - 1) * 100).toFixed(1) : "n/a";
    lines.push(`Population ${y1}: ${fmt(p1)} (${chg}% since ${y0})`);
  }
  if (jobYears.length) {
    const jy = jobYears[jobYears.length - 1];
    lines.push(`Employee jobs ${jy}: ${fmt(total(jobsByArea, jy, "jobs"))}`);
  }
  el("summary-title").textContent = selectedArea || "All of Cherwell";
  el("summary-body").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
}

// ---------------------------------------------------------------------------
// Styling and selection
// ---------------------------------------------------------------------------
function styleFor(layer) {
  const area = layer.feature.properties.area;
  const colour = AREA_COLOURS[area] || "#4C9BE8";
  if (selectedArea === area) {
    return { weight: 4, color: "#000000", fillColor: colour, fillOpacity: 0.8 };
  }
  return {
    weight: BASE_WEIGHT,
    color: "#ffffff",
    fillColor: colour,
    fillOpacity: selectedArea ? 0.2 : 0.6,
  };
}

function restyleAll() {
  if (areaLayer) areaLayer.eachLayer((l) => l.setStyle(styleFor(l)));
}

function setSelected(area) {
  selectedArea = area || null;
  el("area").value = selectedArea || "";
  restyleAll();
  drawCharts();
  updateSummary();
}

// Clicking the selected area again clears the selection
function toggleArea(area) {
  setSelected(selectedArea === area ? null : area);
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
function buildAreaLayer() {
  areaLayer = L.geoJSON(areaGeo, {
    style: (f) => ({ weight: BASE_WEIGHT, color: "#ffffff", fillColor: AREA_COLOURS[f.properties.area] || "#4C9BE8", fillOpacity: 0.6 }),
    onEachFeature: (feature, layer) => {
      const area = feature.properties.area;
      layer.bindTooltip(area, { sticky: true });
      layer.on({
        mouseover: () => {
          // Don't call bringToFront() here: re-ordering the SVG element under the
          // cursor makes the browser lose mouseout/click events.
          if (selectedArea !== area) layer.setStyle(HOVER_STYLE);
        },
        mouseout: () => layer.setStyle(styleFor(layer)),
        click: (e) => {
          L.DomEvent.stopPropagation(e);   // don't let the map's own click clear it
          toggleArea(area);
        },
      });
    },
  }).addTo(map);

  map.fitBounds(areaLayer.getBounds());
}

function setupMap() {
  // Small, unobtrusive credit (kept: CARTO / OpenStreetMap require attribution)
  map = L.map("map", { attributionControl: false });
  L.control.attribution({ prefix: false }).addTo(map);

  // The first basemap listed is the one shown by default
  const basemaps = {};

  if (CARTO_KEY) {
    const carto = (path) =>
      L.tileLayer(`https://basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png?key=${CARTO_KEY}`, {
        attribution: CARTO_ATTR,
        maxZoom: 19,
      });
    basemaps["Light (CARTO)"] = carto("light_all");
    basemaps["Light, no labels (CARTO)"] = carto("light_nolabels");
    basemaps["Colour (CARTO)"] = carto("rastertiles/voyager");
  }

  basemaps["Light grey (Esri)"] = L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    { attribution: ESRI_ATTR, maxNativeZoom: 16, maxZoom: 19 }
  );
  basemaps["Streets (OpenStreetMap)"] = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: OSM_ATTR, maxZoom: 19 }
  );

  Object.values(basemaps)[0].addTo(map);
  L.control.layers(basemaps, null, { position: "topright" }).addTo(map);

  // Clicking empty map clears the selection
  map.on("click", () => setSelected(null));
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [geo, pop, jobs] = await Promise.all([
      loadJSON("data/areas.geojson"),
      loadJSON("data/area_pop.json"),
      loadJSON("data/area_jobs.json"),
    ]);

    areaGeo = geo;
    popByArea = groupByKey(pop, "area");
    jobsByArea = groupByKey(jobs, "area");

    setupMap();

    const select = el("area");
    select.add(new Option("— All areas —", ""));
    for (const a of AREAS) select.add(new Option(a, a));
    select.addEventListener("change", () => setSelected(select.value));
    el("clear").addEventListener("click", () => setSelected(null));

    buildAreaLayer();
    drawCharts();
    updateSummary();
  } catch (err) {
    console.error(err);
    el("status").textContent =
      "Failed to load data: " + err.message +
      ". If you opened index.html directly, serve the folder with a local web server instead.";
  }
}

init();
