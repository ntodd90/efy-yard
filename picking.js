import { ASSUMPTIONS, FREQUENCIES, breadcrumbTimestamp, HISTORY_WINDOWS, HEAT_SAMPLE_SECONDS, HISTORY_PREROLL_SECONDS, createReplayTimeline, replayAtTime, movementHistory } from "./picking-model.js?v=20261110-loading-v15";
import { initShipping } from "./shipping.js?v=20261110-shipping-v19";

export const FORKLIFT_SIZE = 17;
export const REPLAY_SPEEDS = [1, 6, 20, 400];
export const DEFAULT_REPLAY_SPEED = 1;
export const DEFAULT_HEAT_VISIBLE = false;
export const PICKING_LOADING_MESSAGE = "Querying telemitry data and generating optimized routes";

export function loadingPercent(phase, completed, total, ready = false) {
  if (ready) return 100;
  const ranges = { data: [0, 12], navigation: [12, 23], planning: [35, 50], layers: [85, 14], ready: [99, 0] };
  const [start, span] = ranges[phase] || [0, 0];
  const fraction = total > 0 && Number.isFinite(completed) ? Math.max(0, Math.min(1, completed / total)) : 0;
  return Math.min(99, Math.floor(start + span * fraction));
}

export function createPickingLoader(container) {
  const element = document.createElement("div");
  element.className = "picking-loader";
  element.dataset.percent = "0";
  element.innerHTML = `<div class="picking-loading-message" role="status">${PICKING_LOADING_MESSAGE}</div>
    <div class="picking-loading-game">
    <div class="picking-loading-meter" role="progressbar" aria-label="Scenario preparation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div>
    <div class="picking-loading-caption"><span>LOADING</span><strong>0%</strong></div></div>`;
  container.replaceChildren(element);
  const bar = element.querySelector('[role="progressbar"]'), fill = bar.firstElementChild, label = element.querySelector("strong");
  let percent = 0;
  return {
    element,
    update(phase, completed, total, ready = false) {
      percent = Math.max(percent, loadingPercent(phase, completed, total, ready));
      element.dataset.percent = String(percent);
      bar.setAttribute("aria-valuenow", String(percent));
      fill.style.width = `${percent}%`;
      label.textContent = `${percent}%`;
      return percent;
    }
  };
}
export const QUAY_HANDOFFS = [
  { id: "QUAY-W", kind: "quay", name: "West ship-loading handoff", point: [87745, 433168] },
  { id: "QUAY-E", kind: "quay", name: "East ship-loading handoff", point: [88620, 432861] }
];
export const TRAVEL_HEAT_RENDERER = {
  type: "heatmap", radius: 16, minDensity: 0, maxDensity: 0.015,
  colorStops: [
    { ratio: 0, color: [0, 127, 134, 0] },
    { ratio: 0.2, color: [0, 127, 134, 0.45] },
    { ratio: 0.45, color: [93, 194, 162, 0.75] },
    { ratio: 0.7, color: [245, 200, 76, 0.85] },
    { ratio: 1, color: [212, 81, 50, 0.95] }
  ]
};

export function flashRaceFlag() {
  document.querySelector(".race-flag")?.remove();
  const canvas = document.createElement("canvas");
  canvas.className = "race-flag";
  canvas.width = 64;
  canvas.height = 48;
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#172224";
  context.fillRect(8, 4, 6, 44);
  context.fillStyle = "#cad6d8";
  context.fillRect(10, 6, 2, 40);
  const offsets = [0, 0, -2, -2, 0, 2, 2, 0, -2, -2];
  for (let column = 0; column < offsets.length; column++) {
    const top = 8 + offsets[column];
    context.fillStyle = "#172224";
    context.fillRect(14 + column * 4, top - 2, 4, 28);
    for (let row = 0; row < 6; row++) {
      context.fillStyle = (column + row) % 2 ? "#172224" : "#fffef8";
      context.fillRect(14 + column * 4, top + row * 4, 4, 4);
    }
  }
  document.body.append(canvas);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animation = canvas.animate(reducedMotion ? [
    { transform: "translate(calc(50vw - 50%), -50%)", opacity: 0 },
    { transform: "translate(calc(50vw - 50%), -50%)", opacity: 1 },
    { transform: "translate(calc(50vw - 50%), -50%)", opacity: 0 }
  ] : [
    { transform: "translate(-100%, -50%) rotate(-10deg)", opacity: 0 },
    { transform: "translate(15vw, -50%) rotate(6deg)", opacity: 1, offset: 0.2 },
    { transform: "translate(50vw, -50%) rotate(-6deg)", opacity: 1, offset: 0.65 },
    { transform: "translate(100vw, -50%) rotate(10deg)", opacity: 0 }
  ], { duration: reducedMotion ? 600 : 1600, easing: reducedMotion ? "linear" : "steps(16, end)" });
  animation.finished.finally(() => canvas.remove()).catch(() => {});
}

const spatialReference = { wkid: 28992 };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const km = (meters) => (meters / 1000).toFixed(1);
const hours = (seconds) => (seconds / 3600).toFixed(1);
const popup = (title, fields) => ({ title, content: [{ type: "fields", fieldInfos: fields.map(([fieldName, label]) => ({ fieldName, label })) }] });
const icon = (color, loaded) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M8 9h15v17H8z" fill="${color}" stroke="#fff" stroke-width="2"/><path d="M12 12h8v7h-8z" fill="#18332e"/><path d="M25 7v23m0-3h9m-9-5h9" fill="none" stroke="#18332e" stroke-width="2.5"/><circle cx="11" cy="28" r="3" fill="#18332e"/><circle cx="21" cy="28" r="3" fill="#18332e"/>${loaded ? '<path d="M28 12h6v9h-6z" fill="#f5c84c" stroke="#18332e"/>' : ""}</svg>`
);

async function queryFeatures(layer) {
  if (!layer) return [];
  await layer.load();
  const query = layer.createQuery();
  query.where = "1=1";
  const ids = await layer.queryObjectIds(query);
  const result = [];
  for (let offset = 0; offset < (ids?.length || 0); offset += 200) {
    const batch = layer.createQuery();
    batch.objectIds = ids.slice(offset, offset + 200);
    batch.outFields = ["*"];
    batch.returnGeometry = true;
    batch.outSpatialReference = spatialReference;
    result.push(...(await layer.queryFeatures(batch)).features);
  }
  return result;
}

function coordinate(geometry) {
  if (!geometry) return null;
  const point = geometry.type === "point" ? geometry : geometry.extent?.center;
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
}

export function isLoadingDock(feature) {
  const attributes = feature.attributes;
  return ["Dock", "Dock Door"].includes(attributes.DOOR_TYPE) && attributes.DEMO_STATUS !== "Out of Service" && /\.L1$/.test(attributes.LEVEL_ID || "");
}

export async function initPicking({ view, metricsEl, trafficLayer }) {
  const loader = createPickingLoader(metricsEl);
  const [GraphicsLayer, Graphic, FeatureLayer, reactiveUtils] = await $arcgis.import(["@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Graphic.js", "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/core/reactiveUtils.js"]);
  const sourceLayers = view.map.allLayers.toArray();
  const find = (title) => sourceLayers.find((layer) => layer.title === title);
  let queriesCompleted = 0;
  const fetchLayer = async (title) => { const features = await queryFeatures(find(title)); loader.update("data", ++queriesCompleted, 8); return features; };
  const [racks, stalls, doors] = await Promise.all([fetchLayer("Racks"), fetchLayer("TrailerStalls"), fetchLayer("DockDoors")]);
  const storage = racks.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "")).map((feature) => ({
    id: feature.attributes.RACK_ID, kind: "rack", facility: feature.attributes.FACILITY_ID, level: feature.attributes.LEVEL_ID,
    aisle: feature.attributes.AISLE, zone: feature.attributes.ZONE,
    geometry: feature.geometry, point: coordinate(feature.geometry)
  }));
  const entrances = doors.filter(isLoadingDock).map((feature) => ({
    id: feature.attributes.DOOR_ID, facility: feature.attributes.FACILITY_ID, level: feature.attributes.LEVEL_ID, point: coordinate(feature.geometry)
  })).filter((dock) => dock.point);
  const loading = QUAY_HANDOFFS.map((handoff) => ({ ...handoff, point: [...handoff.point] }));
  const [sites, zones, units, details, facilities] = await Promise.all([fetchLayer("Sites"), fetchLayer("YardZones"), fetchLayer("Units"), fetchLayer("Details"), fetchLayer("Facilities")]);
  const areas = [
    ...zones.filter((feature) => ["Roadway", "Trailer Parking", "Equipment Pool"].includes(feature.attributes.ZONE_TYPE)),
    ...units.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "") && /Storage|Staging|Dock|Picking|Shipping|Receiving|Cross|Circulation|Corridor|Warehouse|Packing/i.test(feature.attributes.USE_TYPE || ""))
  ].map((feature) => feature.geometry).filter(Boolean);
  const validStorage = storage.filter((slot) => slot.id && slot.point);
  const serialize = (geometry) => ({ ...geometry.toJSON(), extent: geometry.extent.toJSON() });
  const scenarios = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./picking-worker.js?v=20261110-loading-v15", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Picking calculation timed out. The yard map remains available.")); }, 120000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { loader.update(data.progress.phase, data.progress.completed, data.progress.total); return; }
      finish();
      if (data.error) reject(new Error(data.error)); else resolve(data.scenarios);
    };
    worker.onerror = () => { finish(); reject(new Error("Picking worker could not load. Check browser access to the ArcGIS and routing CDNs.")); };
    worker.postMessage({ storage: validStorage.map((slot) => ({ ...slot, geometry: serialize(slot.geometry) })), loading,
      navigation: {
        land: sites.map((feature) => serialize(feature.geometry)), areas: areas.map(serialize),
        facilities: facilities.map((feature) => serialize(feature.geometry)), portals: entrances.map((dock) => dock.point),
        obstacles: [...racks.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "")), ...stalls].map((feature) => serialize(feature.geometry)),
        walls: details.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "") && /Wall/i.test(feature.attributes.USE_TYPE || "")).map((feature) => serialize(feature.geometry))
      }
    });
  });
  const geometries = new Map(validStorage.map((slot) => [slot.id, slot.geometry]));
  let layerWork = 0;
  loader.update("layers", 0, 12);
  Object.values(scenarios).forEach((scenario) => scenario.placements.forEach((slot) => { slot.geometry = geometries.get(slot.id); }));
  const handoffs = new GraphicsLayer({ title: "Ship-loading handoffs (quayside)", visible: false });
  loading.forEach((handoff) => {
    const geometry = { type: "point", x: handoff.point[0], y: handoff.point[1], spatialReference };
    handoffs.add(new Graphic({ geometry, attributes: { name: handoff.name, destination: "Dock-side container staging; forklifts stop here and the berth crane transfers cargo to the ship." },
      symbol: { type: "simple-marker", style: "square", size: 12, color: "#f5c84c", outline: { color: "#18332e", width: 2 } },
      popupTemplate: popup("{name}", [["destination", "Handoff"]])
    }));
    handoffs.add(new Graphic({ geometry, symbol: { type: "text", text: handoff.name, color: "#18332e", haloColor: "#fffef8", haloSize: 1.5, yoffset: 16,
      font: { family: "IBM Plex Sans", size: 9, weight: "bold" } } }));
  });
  view.map.add(handoffs);
  const shipping = initShipping({ view, GraphicsLayer, Graphic });
  let extent = null;
  scenarios.current.placements.forEach((slot) => {
    const bounds = slot.geometry.extent;
    if (bounds) extent = extent ? extent.union(bounds) : bounds.clone();
  });
  if (shipping.extent) extent = extent ? extent.union(shipping.extent) : shipping.extent.clone();
  const layers = {};
  const replay = {};
  for (const [id, scenario] of Object.entries(scenarios)) {
    const prefix = id === "current" ? "Current" : "Optimized";
    const storageLayer = new GraphicsLayer({ title: `${prefix} storage pick frequency (Simulated)`, visible: false });
    const breadcrumbs = new FeatureLayer({
      title: id === "current" ? "Current breadcrumbs" : "Optimized breadcrumbs", visible: false,
      source: [], geometryType: "point", spatialReference, objectIdField: "OBJECTID",
      fields: [{ name: "OBJECTID", type: "oid" }, { name: "sampleKey", type: "integer" }, { name: "forklift", type: "string" }, { name: "timestamp", type: "date" }, { name: "status", type: "string" }, { name: "source", type: "string" }],
      renderer: TRAVEL_HEAT_RENDERER,
      popupTemplate: popup("{forklift} · breadcrumb", [["timestamp", "Simulated time"], ["status", "Activity"], ["source", "Source"]])
    });
    const vehicles = new GraphicsLayer({ title: id === "current" ? "Current forklifts" : "Optimized forklifts", visible: false });
    layers[id] = { storage: storageLayer, breadcrumbs, vehicles, records: new Map(), editing: false, refreshPending: false, replaySeconds: HISTORY_PREROLL_SECONDS, epoch: Date.now() - HISTORY_PREROLL_SECONDS * 1000 };
    for (const slot of scenario.placements) {
      const color = FREQUENCIES[slot.frequency].color;
      const symbol = slot.geometry.type === "polygon" ? { type: "simple-fill", color, outline: { color: "#fffef8", width: 0.5 } }
        : slot.geometry.type === "polyline" ? { type: "simple-line", color, width: 4 }
        : { type: "simple-marker", style: "square", color, size: 8, outline: { color: "white", width: 0.5 } };
      storageLayer.add(new Graphic({ geometry: slot.geometry, symbol,
        attributes: { storageId: slot.id, sku: slot.sku, frequency: slot.frequency, weeklyPicks: slot.weekly, dock: slot.dock?.id || "No reachable loading area",
          kind: "Warehouse container pickup", scenario: prefix, source: "Synthetic container demand; illustrative warehouse storage positions." },
        popupTemplate: popup("{storageId} · {frequency} frequency", [["scenario", "Scenario"], ["kind", "Storage"], ["sku", "Simulated cargo group"], ["weeklyPicks", "Container moves / week"], ["dock", "Ship-loading handoff"], ["source", "Source"]])
      }));
    }
    breadcrumbs.opacity = 0.8;
    replay[id] = scenario.fleet.map((forklift, index) => {
      const timeline = createReplayTimeline(forklift.trips);
      const state = replayAtTime(timeline, HISTORY_PREROLL_SECONDS);
      const trip = forklift.trips[state.tripIndex];
      const graphic = new Graphic({
        geometry: { type: "point", x: state.point[0], y: state.point[1], spatialReference },
        symbol: { type: "picture-marker", url: icon(forklift.color, state.loaded), width: FORKLIFT_SIZE, height: FORKLIFT_SIZE, angle: (state.bearing + 270) % 360 },
        attributes: { forklift: forklift.id, scenario: prefix, role: forklift.role, storage: trip.slot.id, dock: trip.slot.dock.id, status: state.status, battery: forklift.battery, source: "Accelerated simulated container moves; not GPS" },
        popupTemplate: popup("{forklift} · {scenario}", [["role", "Assignment"], ["status", "Activity"], ["storage", "Warehouse pickup"], ["dock", "Quayside handoff"], ["battery", "Estimated battery (%)"], ["source", "Source"]])
      });
      vehicles.add(graphic);
      return { forklift, graphic, timeline, originDistance: state.totalDistance, tripIndex: state.tripIndex, elapsed: state.elapsed, distance: 0, state };
    });
    view.map.addMany([storageLayer, breadcrumbs, vehicles]);
    loader.update("layers", ++layerWork, 12);
  }
  await Promise.all([handoffs, ...shipping.layers, ...Object.values(layers).flatMap((group) => [group.storage, group.breadcrumbs, group.vehicles])].map(async (layer) => {
    await layer.load();
    loader.update("layers", ++layerWork, 12);
  }));
  const originalStorage = sourceLayers.filter((layer) => ["Racks", "RackLocations"].includes(layer.title));
  let ready = false;
  let active = null, paused = false, speed = DEFAULT_REPLAY_SPEED, lastFrame = performance.now(), lastRender = 0;
  let showHeat = DEFAULT_HEAT_VISIBLE;
  let selectedForklift = "all", historySeconds = HISTORY_WINDOWS[0].seconds;
  let lastBreadcrumbRender = 0;
  let trafficVisibility = null;
  async function updateTrails() {
    if (!active) return;
    const group = layers[active];
    group.breadcrumbs.definitionExpression = selectedForklift === "all" ? null : `forklift = '${selectedForklift}'`;
    group.vehicles.graphics.forEach((graphic) => { graphic.visible = selectedForklift === "all" || graphic.attributes.forklift === selectedForklift; });
    group.breadcrumbs.visible = showHeat;
    if (!showHeat) return;
    if (group.editing) { group.refreshPending = true; return; }
    group.editing = true;
    const clock = group.replaySeconds, epoch = group.epoch + clock * 1000;
    const keyStride = Math.floor(HISTORY_PREROLL_SECONDS / HEAT_SAMPLE_SECONDS) + 1;
    const features = replay[active].flatMap((vehicle, forkliftIndex) => {
      const forklift = vehicle.forklift;
      return movementHistory(vehicle.timeline, clock, historySeconds).map((sample, sampleIndex) => new Graphic({
        geometry: { type: "point", x: sample.point[0], y: sample.point[1], spatialReference },
        attributes: { sampleKey: forkliftIndex * keyStride + sampleIndex + 1, forklift: forklift.id, timestamp: breadcrumbTimestamp(epoch, sample.ageSeconds), status: sample.status,
          source: "Exact forklift replay positions, including queue stops; sampled every 30 simulated seconds. Not recorded GPS." }
      }));
    });
    try {
      const currentKeys = new Set(features.map((feature) => feature.attributes.sampleKey));
      const deletedKeys = [...group.records.keys()].filter((key) => !currentKeys.has(key));
      const added = features.filter((feature) => !group.records.has(feature.attributes.sampleKey));
      const updated = features.filter((feature) => group.records.has(feature.attributes.sampleKey));
      updated.forEach((feature) => { feature.attributes.OBJECTID = group.records.get(feature.attributes.sampleKey); });
      const result = await group.breadcrumbs.applyEdits({
        deleteFeatures: deletedKeys.map((key) => ({ objectId: group.records.get(key) })),
        addFeatures: added,
        updateFeatures: updated
      });
      result.deleteFeatureResults.forEach((feature, index) => { if (!feature.error) group.records.delete(deletedKeys[index]); });
      result.addFeatureResults.forEach((feature, index) => { if (!feature.error) group.records.set(added[index].attributes.sampleKey, feature.objectId); });
      const failed = [...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults].find((feature) => feature.error);
      if (failed) throw failed.error;
    } catch (error) { console.warn("Could not update rolling breadcrumb points.", error); }
    finally {
      group.editing = false;
      if (group.refreshPending) { group.refreshPending = false; void updateTrails(); }
    }
  }
  const metric = (value, label, tone) => `<div class="kpi ${tone}"><div class="v">${value}</div><div class="l">${label}</div></div>`;
  function render() {
    if (!active || !ready) return;
    const showCompletion = loader.element.isConnected;
    const scenario = scenarios[active], total = scenario.total;
    const reduction = (1 - total.distance / scenarios.current.total.distance) * 100;
    const date = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
    metricsEl.innerHTML = `<div class="picking-heading"><strong>${active === "current" ? "Current" : "Optimized"} pick pattern</strong><span class="picking-badge">SIMULATED</span></div>
      <div class="muted">${date(scenario.week.start)} to ${date(scenario.week.end - 1)} · UTC</div>
      <div class="kpis mt">${metric(`${km(total.distance)} km`, "Weekly fleet travel", "blue")}${metric(`${hours(total.travelSeconds)} h`, "Weekly travel time", "green")}
      ${metric(total.picks.toLocaleString(), "Weekly container moves", "mint")}${metric(`${total.energy.toFixed(1)} kWh`, "Estimated traction energy", "peach")}</div>
      <dl class="picking-summary"><div><dt>Travel change vs current</dt><dd>${active === "current" ? "Baseline" : `${Math.abs(reduction).toFixed(1)}% ${reduction >= 0 ? "less" : "more"}`}</dd></div>
      <div><dt>Routing plan</dt><dd>${escapeHtml(scenario.routePolicy)}</dd></div>
      <div><dt>Cargo allocation</dt><dd>${scenario.fixedQuayAssignments ? "Fixed quay per cargo group" : "Nearest quay"}</dd></div>
      <div><dt>Central corridor moves</dt><dd>${scenario.centralCorridorTrips.toLocaleString()} / week</dd></div>
      <div><dt>Weekly workload</dt><dd>${scenario.workloadUplift ? `+${(scenario.workloadUplift * 100).toFixed(0)}% (simulated)` : "Baseline"}</dd></div>
      <div><dt>Total travel + handling + delays</dt><dd>${hours(total.travelSeconds + total.handlingSeconds + total.congestionSeconds)} h / week</dd></div>
      <div><dt>Queue + maneuver delays</dt><dd>${hours(total.congestionSeconds)} h / week</dd></div>
      <div><dt>Aisle conflicts</dt><dd>${total.conflicts.toLocaleString()} / week</dd></div>
      <div><dt>Distance per pick</dt><dd>${(total.distance / total.picks).toFixed(0)} m</dd></div>
      <div><dt>Pickup + quayside handoff</dt><dd>${hours(total.handlingSeconds)} h / week</dd></div>
      <div><dt>Modeled moves / labor hour</dt><dd>${(total.picks / ((total.travelSeconds + total.handlingSeconds + total.congestionSeconds) / 3600)).toFixed(1)}</dd></div></dl>
      <div class="picking-controls"><calcite-button id="pickPause" appearance="outline" icon-start="${paused ? "play" : "pause"}" scale="s">${paused ? "Resume" : "Pause"}</calcite-button>
      <calcite-button id="pickReset" appearance="outline" icon-start="reset" scale="s">Restart</calcite-button>
      <label>Replay <select id="pickSpeed" aria-label="Replay speed">${REPLAY_SPEEDS.map((value) => `<option value="${value}" ${speed === value ? "selected" : ""}>${value}x</option>`).join("")}</select></label></div>
      <div class="picking-controls mt"><label>Paths <select id="pickFleet" aria-label="Forklift paths"><option value="all">All forklifts</option>${scenario.fleet.map((forklift) => `<option value="${forklift.id}" ${selectedForklift === forklift.id ? "selected" : ""}>${forklift.id}</option>`).join("")}</select></label>
      <calcite-button id="pickHeatToggle" scale="s" appearance="${showHeat ? "solid" : "outline"}" icon-start="${showHeat ? "view-visible" : "view-hide"}" aria-pressed="${showHeat}" title="${showHeat ? "Hide travel heatmap" : "Show travel heatmap"}">Travel heat</calcite-button>
      <label>History <select id="pickDay" aria-label="Travel heat history">${HISTORY_WINDOWS.map((window) => `<option value="${window.seconds}" ${historySeconds === window.seconds ? "selected" : ""}>${window.label}</option>`).join("")}</select></label></div>
      <div class="section-title">Forklift fleet</div><div class="picking-fleet">${replay[active].map((vehicle) => {
        const forklift = vehicle.forklift;
        const battery = Math.max(0, forklift.battery - vehicle.distance / 1000 * ASSUMPTIONS.kwhPerKm / ASSUMPTIONS.batteryKwh * 100);
        const lineStyle = "solid";
        return `<article class="picking-vehicle" style="--forklift-color:${forklift.color}"><div class="picking-vehicle-title"><strong><span class="picking-trail-key" style="border-top-style:${lineStyle}"></span>${forklift.id}</strong><span data-battery="${forklift.id}">${battery.toFixed(0)}%</span></div>
          <div class="meter"><div data-battery-bar="${forklift.id}" style="width:${battery}%;background:${forklift.color}"></div></div>
          <div class="muted">${escapeHtml(forklift.role)}</div>
          <div class="picking-activity" data-activity="${forklift.id}">${escapeHtml(vehicle.state?.status || "Ready")}</div>
          <div class="muted">${km(forklift.distance)} km · ${hours(forklift.travelSeconds)} h · ${forklift.picks} picks / week</div></article>`;
      }).join("")}</div>
      <div class="section-title">Storage frequency · baseline picks / week</div><div class="picking-legend">${Object.entries(FREQUENCIES).map(([label, frequency]) => `<span><i style="background:${frequency.color}"></i>${label} · ${frequency.daily * 7}</span>`).join("")}</div>
      <p class="picking-disclaimer">${scenario.workloadUplift ? "Optimized workload assumes 5% additional container moves, rounded to whole containers; all travel and handling totals include them. This is an illustrative productivity scenario, not a measured increase. " : ""}Travel heat uses the same timeline and positions as the forklifts, including stops and yielding, sampled every 30 simulated seconds. Larger windows add older movement without changing the density scale. Replay starts after a matching 12-hour simulated pre-roll. Battery: estimated remaining since replay restart, traction only. ${ASSUMPTIONS.speed * 3.6} km/h; ${ASSUMPTIONS.pickSeconds}s pickup + ${ASSUMPTIONS.unloadSeconds}s quayside handoff; ${ASSUMPTIONS.batteryKwh} kWh battery; ${ASSUMPTIONS.kwhPerKm} kWh/km.</p>
      <p class="picking-disclaimer">Aisle reservations model conflicts at shared rack approaches. Yielding includes a small on-route reverse, a queue stop and a forward clearance maneuver. Optimized high-volume stock is spread across picking areas; FL-03 serves the central Warehouse E zone and FL-04 serves farther racks outside that zone. This is illustrative traffic behavior, not a validated collision-avoidance system.</p>
      <p class="picking-disclaimer">Routing-plan assumption: the current operation uses the shared outer network. The proposed optimized operation enables the central link between Warehouses C and E and combines it with zoned dispatch. A synthetic cargo manifest fixes each cargo group's quay in both plans; optimized storage can move the cargo, not change its ship-loading destination. Every link still obeys mapped land and obstacle checks; opening that corridor requires operational approval.</p>
      <p class="picking-disclaimer">Every loaded trip runs from a warehouse pickup directly to QUAY-W or QUAY-E. Forklifts remain on land; berth cranes move staged cargo onto stationary simulated ships. Two containers start staged at each berth. Ship fill increases only when a crane places a container. Ground floor only. ${scenario.excluded} unreachable warehouse positions are retained on the map but excluded from travel totals. Dimensions, cargo capacity and clearances are illustrative and require operational validation. No WMS data, AIS or measured savings.</p>`;
    metricsEl.querySelector("#pickPause").addEventListener("click", () => { paused = !paused; render(); });
    metricsEl.querySelector("#pickReset").addEventListener("click", () => { resetReplay(active); render(); });
    metricsEl.querySelector("#pickSpeed").addEventListener("change", (event) => {
      speed = Number(event.target.value);
      if (speed === 400) flashRaceFlag();
    });
    metricsEl.querySelector("#pickFleet").addEventListener("change", (event) => { selectedForklift = event.target.value; updateTrails(); });
    metricsEl.querySelector("#pickHeatToggle").addEventListener("click", () => { showHeat = !showHeat; render(); });
    metricsEl.querySelector("#pickDay").addEventListener("change", (event) => { historySeconds = Number(event.target.value); void updateTrails(); });
    if (showCompletion) metricsEl.prepend(loader.element);
    updateTrails();
  }
  function resetReplay(scenarioId) {
    replay[scenarioId].forEach((vehicle) => {
      const state = replayAtTime(vehicle.timeline, HISTORY_PREROLL_SECONDS);
      vehicle.tripIndex = state.tripIndex; vehicle.elapsed = state.elapsed; vehicle.distance = 0; vehicle.state = state; vehicle.originDistance = state.totalDistance;
      vehicle.graphic.geometry = { type: "point", x: state.point[0], y: state.point[1], spatialReference };
      vehicle.graphic.symbol = { type: "picture-marker", url: icon(vehicle.forklift.color, state.loaded), width: FORKLIFT_SIZE, height: FORKLIFT_SIZE, angle: (state.bearing + 270) % 360 };
      const trip = vehicle.forklift.trips[state.tripIndex];
      Object.assign(vehicle.graphic.attributes, { status: state.status, battery: vehicle.forklift.battery, storage: trip.slot.id, dock: trip.slot.dock.id });
    });
    layers[scenarioId].epoch = Date.now() - HISTORY_PREROLL_SECONDS * 1000;
    layers[scenarioId].replaySeconds = HISTORY_PREROLL_SECONDS;
    shipping.reset(scenarioId);
  }
  function animate(now) {
    const elapsed = Math.min((now - lastFrame) / 1000, 0.5);
    lastFrame = now;
    if (active && ready && !paused && !document.hidden) {
      const previousClock = layers[active].replaySeconds;
      layers[active].replaySeconds += elapsed * speed;
      for (const vehicle of replay[active]) {
        const forklift = vehicle.forklift;
        const state = replayAtTime(vehicle.timeline, layers[active].replaySeconds);
        const trip = forklift.trips[state.tripIndex];
        vehicle.distance += Math.max(0, state.totalDistance - (vehicle.state?.totalDistance ?? vehicle.originDistance));
        vehicle.tripIndex = state.tripIndex; vehicle.elapsed = state.elapsed;
        vehicle.state = state;
        const battery = Math.max(0, forklift.battery - vehicle.distance / 1000 * ASSUMPTIONS.kwhPerKm / ASSUMPTIONS.batteryKwh * 100);
        vehicle.graphic.geometry = { type: "point", x: state.point[0], y: state.point[1], spatialReference };
        vehicle.graphic.symbol = { type: "picture-marker", url: icon(forklift.color, state.loaded), width: FORKLIFT_SIZE, height: FORKLIFT_SIZE, angle: (state.bearing + 270) % 360 };
        Object.assign(vehicle.graphic.attributes, { status: state.status, battery: Number(battery.toFixed(1)), storage: trip.slot.id, dock: trip.slot.dock.id });
        if (now - lastRender > 700) {
          const batteryText = metricsEl.querySelector(`[data-battery="${forklift.id}"]`);
          const bar = metricsEl.querySelector(`[data-battery-bar="${forklift.id}"]`);
          const activity = metricsEl.querySelector(`[data-activity="${forklift.id}"]`);
          if (batteryText) batteryText.textContent = `${battery.toFixed(0)}%`;
          if (bar) bar.style.width = `${battery}%`;
          if (activity) activity.textContent = `${state.status} · ${state.loaded ? trip.slot.dock.id : trip.slot.id}`;
        }
      }
      shipping.advance(active, previousClock, layers[active].replaySeconds, replay[active]);
      if (now - lastRender > 700) lastRender = now;
      if (now - lastBreadcrumbRender > 1000) { void updateTrails(); lastBreadcrumbRender = now; }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {
    extent,
    reset() {
      showHeat = DEFAULT_HEAT_VISIBLE;
      historySeconds = HISTORY_WINDOWS[0].seconds;
      selectedForklift = "all";
      speed = DEFAULT_REPLAY_SPEED;
      paused = false;
      Object.keys(replay).forEach(resetReplay);
      active = null;
      metricsEl.hidden = true;
      handoffs.visible = true;
      Object.values(layers).forEach((group) => {
        group.storage.visible = false;
        group.breadcrumbs.visible = false;
        group.vehicles.visible = false;
      });
      if (trafficLayer && trafficVisibility !== null) {
        trafficLayer.visible = trafficVisibility;
        trafficVisibility = null;
      }
    },
    async completeLoading() {
      if (ready) return;
      const visible = [...shipping.layers, ...(active ? [handoffs, layers[active].storage, layers[active].vehicles] : [])];
      await Promise.all(visible.map(async (layer) => {
        const layerView = await view.whenLayerView(layer);
        await reactiveUtils.whenOnce(() => !layerView.updating);
      }));
      if (!document.hidden) await new Promise((resolve) => requestAnimationFrame(resolve));
      loader.update("layers", ++layerWork, 12);
      ready = true;
      loader.element.dataset.ready = "true";
      loader.update("ready", 1, 1, true);
      if (active) {
        render();
        const animation = loader.element.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 800, easing: "steps(3, end)"
        });
        animation.finished.finally(() => loader.element.remove()).catch(() => {});
      } else loader.element.remove();
    },
    setActive(id) {
      active = id;
      shipping.setActive(id);
      metricsEl.hidden = !id;
      handoffs.visible = Boolean(id);
      Object.entries(layers).forEach(([scenarioId, group]) => {
        group.storage.visible = scenarioId === id;
        group.vehicles.visible = scenarioId === id;
        group.breadcrumbs.visible = scenarioId === id && showHeat;
      });
      if (id) {
        originalStorage.forEach((layer) => { layer.visible = false; });
        if (trafficLayer) {
          if (trafficVisibility === null) trafficVisibility = trafficLayer.visible;
          trafficLayer.visible = false;
        }
        render();
      } else if (trafficLayer && trafficVisibility !== null) {
        trafficLayer.visible = trafficVisibility;
        trafficVisibility = null;
      }
    }
  };
}