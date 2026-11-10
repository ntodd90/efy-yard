import { ASSUMPTIONS, FREQUENCIES, replayTrip, rollingBreadcrumbs, breadcrumbTimestamp } from "./picking-model.js?v=20261110-quayside-v10";

export const FORKLIFT_SIZE = 17;
export const REPLAY_SPEEDS = [1, 6, 20, 400];
export const DEFAULT_REPLAY_SPEED = 1;
export const DEFAULT_HEAT_VISIBLE = false;
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
  metricsEl.innerHTML = '<div class="muted">Loading simulated picking scenarios...</div>';
  const [GraphicsLayer, Graphic, FeatureLayer] = await $arcgis.import(["@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Graphic.js", "@arcgis/core/layers/FeatureLayer.js"]);
  const sourceLayers = view.map.allLayers.toArray();
  const find = (title) => sourceLayers.find((layer) => layer.title === title);
  const [racks, stalls, doors] = await Promise.all([queryFeatures(find("Racks")), queryFeatures(find("TrailerStalls")), queryFeatures(find("DockDoors"))]);
  const storage = racks.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "")).map((feature) => ({
    id: feature.attributes.RACK_ID, kind: "rack", facility: feature.attributes.FACILITY_ID, level: feature.attributes.LEVEL_ID,
    aisle: feature.attributes.AISLE, zone: feature.attributes.ZONE,
    geometry: feature.geometry, point: coordinate(feature.geometry)
  }));
  const entrances = doors.filter(isLoadingDock).map((feature) => ({
    id: feature.attributes.DOOR_ID, facility: feature.attributes.FACILITY_ID, level: feature.attributes.LEVEL_ID, point: coordinate(feature.geometry)
  })).filter((dock) => dock.point);
  const loading = QUAY_HANDOFFS.map((handoff) => ({ ...handoff, point: [...handoff.point] }));
  const [sites, zones, units, details, facilities] = await Promise.all([queryFeatures(find("Sites")), queryFeatures(find("YardZones")), queryFeatures(find("Units")), queryFeatures(find("Details")), queryFeatures(find("Facilities"))]);
  const areas = [
    ...zones.filter((feature) => ["Roadway", "Trailer Parking", "Equipment Pool"].includes(feature.attributes.ZONE_TYPE)),
    ...units.filter((feature) => /\.L1$/.test(feature.attributes.LEVEL_ID || "") && /Storage|Staging|Dock|Picking|Shipping|Receiving|Cross|Circulation|Corridor|Warehouse|Packing/i.test(feature.attributes.USE_TYPE || ""))
  ].map((feature) => feature.geometry).filter(Boolean);
  const validStorage = storage.filter((slot) => slot.id && slot.point);
  const serialize = (geometry) => ({ ...geometry.toJSON(), extent: geometry.extent.toJSON() });
  const scenarios = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./picking-worker.js?v=20261110-quayside-v10", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Picking calculation timed out. The yard map remains available.")); }, 120000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { metricsEl.textContent = data.progress; return; }
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
  Object.values(scenarios).forEach((scenario) => scenario.placements.forEach((slot) => { slot.geometry = geometries.get(slot.id); }));
  const handoffs = new GraphicsLayer({ title: "Ship-loading handoffs (quayside)", visible: false });
  loading.forEach((handoff) => {
    const geometry = { type: "point", x: handoff.point[0], y: handoff.point[1], spatialReference };
    handoffs.add(new Graphic({ geometry, attributes: { name: handoff.name, destination: "Dock-side container staging; forklift stops here. Crane loading is not animated." },
      symbol: { type: "simple-marker", style: "square", size: 12, color: "#f5c84c", outline: { color: "#18332e", width: 2 } },
      popupTemplate: popup("{name}", [["destination", "Handoff"]])
    }));
    handoffs.add(new Graphic({ geometry, symbol: { type: "text", text: handoff.name, color: "#18332e", haloColor: "#fffef8", haloSize: 1.5, yoffset: 16,
      font: { family: "IBM Plex Sans", size: 9, weight: "bold" } } }));
  });
  view.map.add(handoffs);
  let extent = null;
  scenarios.current.placements.forEach((slot) => {
    const bounds = slot.geometry.extent;
    if (bounds) extent = extent ? extent.union(bounds) : bounds.clone();
  });
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
    layers[id] = { storage: storageLayer, breadcrumbs, vehicles, records: new Map(), editing: false, replaySeconds: 0, epoch: Date.now() };
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
      const graphic = new Graphic({
        geometry: { type: "point", x: forklift.trips[0].outbound.points[0][0], y: forklift.trips[0].outbound.points[0][1], spatialReference },
        symbol: { type: "picture-marker", url: icon(forklift.color, false), width: FORKLIFT_SIZE, height: FORKLIFT_SIZE },
        attributes: { forklift: forklift.id, scenario: prefix, role: forklift.role, status: "Returning empty to warehouse", battery: forklift.battery, source: "Accelerated simulated container moves; not GPS" },
        popupTemplate: popup("{forklift} · {scenario}", [["role", "Assignment"], ["status", "Activity"], ["storage", "Warehouse pickup"], ["dock", "Quayside handoff"], ["battery", "Estimated battery (%)"], ["source", "Source"]])
      });
      vehicles.add(graphic);
      return { forklift, graphic, tripIndex: 0, elapsed: 0, distance: 0, state: null };
    });
    view.map.addMany([storageLayer, breadcrumbs, vehicles]);
  }
  const originalStorage = sourceLayers.filter((layer) => ["Racks", "RackLocations"].includes(layer.title));
  let active = null, paused = false, speed = DEFAULT_REPLAY_SPEED, lastFrame = performance.now(), lastRender = 0;
  let showHeat = DEFAULT_HEAT_VISIBLE;
  let selectedForklift = "all", historyDay = "rolling";
  let lastBreadcrumbRender = 0;
  let trafficVisibility = null;
  async function updateTrails() {
    if (!active) return;
    const group = layers[active], scenario = scenarios[active];
    group.breadcrumbs.definitionExpression = selectedForklift === "all" ? null : `forklift = '${selectedForklift}'`;
    group.vehicles.graphics.forEach((graphic) => { graphic.visible = selectedForklift === "all" || graphic.attributes.forklift === selectedForklift; });
    group.breadcrumbs.visible = showHeat;
    if (!showHeat || group.editing) return;
    group.editing = true;
    const features = replay[active].flatMap((vehicle, forkliftIndex) => {
      const forklift = vehicle.forklift;
      let tripIndex = vehicle.tripIndex, elapsed = vehicle.elapsed, epoch = group.epoch + group.replaySeconds * 1000;
      if (historyDay !== "rolling") {
        tripIndex = forklift.trips.findLastIndex((trip) => trip.day === Number(historyDay));
        if (tripIndex < 0) return [];
        elapsed = replayTrip(forklift.trips[tripIndex], Infinity).duration;
        epoch = forklift.trips[tripIndex].timestamp;
      }
      return rollingBreadcrumbs(forklift.trips, tripIndex, elapsed).map((sample, sampleIndex) => new Graphic({
        geometry: { type: "point", x: sample.point[0], y: sample.point[1], spatialReference },
        attributes: { sampleKey: forkliftIndex * 100 + sampleIndex + 1, forklift: forklift.id, timestamp: breadcrumbTimestamp(epoch, sample.ageSeconds), status: sample.status,
          source: "Rolling 30 simulated minutes; sampled every 30 simulated seconds. Not recorded GPS." }
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
    finally { group.editing = false; }
  }
  const metric = (value, label, tone) => `<div class="kpi ${tone}"><div class="v">${value}</div><div class="l">${label}</div></div>`;
  function render() {
    if (!active) return;
    const scenario = scenarios[active], total = scenario.total;
    const reduction = (1 - total.distance / scenarios.current.total.distance) * 100;
    const date = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
    metricsEl.innerHTML = `<div class="picking-heading"><strong>${active === "current" ? "Current" : "Optimized"} pick pattern</strong><span class="picking-badge">SIMULATED</span></div>
      <div class="muted">${date(scenario.week.start)} to ${date(scenario.week.end - 1)} · UTC</div>
      <div class="kpis mt">${metric(`${km(total.distance)} km`, "Weekly fleet travel", "blue")}${metric(`${hours(total.travelSeconds)} h`, "Weekly travel time", "green")}
      ${metric(total.picks.toLocaleString(), "Weekly container moves", "mint")}${metric(`${total.energy.toFixed(1)} kWh`, "Estimated traction energy", "peach")}</div>
      <dl class="picking-summary"><div><dt>Travel change vs current</dt><dd>${active === "current" ? "Baseline" : `${Math.abs(reduction).toFixed(1)}% ${reduction >= 0 ? "less" : "more"}`}</dd></div>
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
      <label>History <select id="pickDay" aria-label="Breadcrumb history"><option value="rolling">Rolling 30 min</option>${Array.from({ length: 7 }, (_, day) => `<option value="${day}" ${historyDay === String(day) ? "selected" : ""}>${date(scenario.week.start + day * 86400000)}</option>`).join("")}</select></label></div>
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
      <p class="picking-disclaimer">${scenario.workloadUplift ? "Optimized workload assumes 5% additional container moves, rounded to whole containers; all travel and handling totals include them. This is an illustrative productivity scenario, not a measured increase. " : ""}Travel heat: relative density of routed samples in the rolling 30 simulated minutes, sampled every 30 seconds of replay time. Dated history shows a 30-minute window ending at that day's final synthetic event. Battery: estimated remaining since replay restart, traction only. ${ASSUMPTIONS.speed * 3.6} km/h; ${ASSUMPTIONS.pickSeconds}s pickup + ${ASSUMPTIONS.unloadSeconds}s quayside handoff; ${ASSUMPTIONS.batteryKwh} kWh battery; ${ASSUMPTIONS.kwhPerKm} kWh/km.</p>
      <p class="picking-disclaimer">Aisle reservations model conflicts at shared rack approaches. Yielding includes a small on-route reverse, a queue stop and a forward clearance maneuver. Optimized high-volume stock is spread across picking areas; FL-04 serves the farthest quarter of reachable racks. This is illustrative traffic behavior, not a validated collision-avoidance system.</p>
      <p class="picking-disclaimer">Every loaded trip runs from a warehouse pickup directly to QUAY-W or QUAY-E. Forklifts stop in land-side container staging; ships and crane operations are not animated. The yellow squares mark the two handoffs corresponding to the supplied image. Ground floor only. ${scenario.excluded} unreachable warehouse positions are retained on the map but excluded from travel totals. Routes use mapped land, doors and a 1.25 m grid; clearance and cargo capacity require operational validation. No WMS data or measured savings.</p>`;
    metricsEl.querySelector("#pickPause").addEventListener("click", () => { paused = !paused; render(); });
    metricsEl.querySelector("#pickReset").addEventListener("click", () => {
      replay[active].forEach((vehicle) => { vehicle.tripIndex = 0; vehicle.elapsed = 0; vehicle.distance = 0; vehicle.state = null; });
      layers[active].epoch = Date.now(); layers[active].replaySeconds = 0;
      render();
    });
    metricsEl.querySelector("#pickSpeed").addEventListener("change", (event) => {
      speed = Number(event.target.value);
      if (speed === 400) flashRaceFlag();
    });
    metricsEl.querySelector("#pickFleet").addEventListener("change", (event) => { selectedForklift = event.target.value; updateTrails(); });
    metricsEl.querySelector("#pickHeatToggle").addEventListener("click", () => { showHeat = !showHeat; render(); });
    metricsEl.querySelector("#pickDay").addEventListener("change", (event) => { historyDay = event.target.value; render(); updateTrails(); });
    updateTrails();
  }
  function animate(now) {
    const elapsed = Math.min((now - lastFrame) / 1000, 0.5);
    lastFrame = now;
    if (active && !paused && !document.hidden && layers[active].vehicles.visible) {
      layers[active].replaySeconds += elapsed * speed;
      for (const vehicle of replay[active]) {
        const forklift = vehicle.forklift;
        const before = vehicle.state?.traveled || 0;
        vehicle.elapsed += elapsed * speed;
        let trip = forklift.trips[vehicle.tripIndex];
        let state = replayTrip(trip, vehicle.elapsed);
        let traveled = state.traveled - before;
        while (vehicle.elapsed >= state.duration) {
          vehicle.elapsed -= state.duration;
          vehicle.tripIndex = (vehicle.tripIndex + 1) % forklift.trips.length;
          trip = forklift.trips[vehicle.tripIndex];
          state = replayTrip(trip, vehicle.elapsed);
          traveled += state.traveled;
        }
        vehicle.distance += Math.max(0, traveled);
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
      if (now - lastRender > 700) lastRender = now;
      if (now - lastBreadcrumbRender > 3000) { void updateTrails(); lastBreadcrumbRender = now; }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {
    extent,
    setActive(id) {
      active = id;
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