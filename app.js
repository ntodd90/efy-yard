// =====================================================================================
// Eemhaven Freight Yard – Yard Operations app (v1)
// ArcGIS Maps SDK for JavaScript 5.1 (CDN) + Calcite. Static files, hosted on GitHub Pages.
// =====================================================================================
const CONFIG = {
  portalUrl: "https://esri-cgs.maps.arcgis.com",
  appId: "dB7jc2tJORyj075F",                    // OAuth 2.0 client ID (user authentication)
  webmapId: "3cf49dce75704f12955f0ec7d6b84b9e", // "Rotterdam Yard web map"
  layers: {                                     // layer TITLES as they appear in the web map
    doors: "DockDoors",
    stalls: "TrailerStalls",
    locs: "RackLocations",
    facilities: "Facilities"
  },
  refreshSeconds: 30
};

const BUILDINGS = {
  "EFY.B1": "Warehouse A", "EFY.B2": "Warehouse B", "EFY.B3": "Warehouse C", "EFY.B4": "Warehouse D",
  "EFY.B5": "Warehouse E", "EFY.B6": "Cross-Dock F", "EFY.B7": "Yard Operations Center", "EFY.GH": "Main Gate"
};
const DOOR_STATUSES = ["Available", "Occupied - Loading", "Occupied - Unloading", "Out of Service"];
const STALL_COLORS = {
  "Empty": "#e6e8eb", "Empty Trailer": "#b9cfe6", "Loaded Trailer": "#6f97c7",
  "Reefer - Plugged In": "#7cc9bd", "Reserved": "#f2c879", "Trailer at Door": "#ee9f66"
};

const $ = (id) => document.getElementById(id);
const bname = (fid) => BUILDINGS[fid] || fid || "";
const chipClass = (s) => "chip st-" + String(s).replace(/ /g, "-");
const shortStatus = (s) => ({ "Occupied - Loading": "Loading", "Occupied - Unloading": "Unloading", "Out of Service": "Out of service" }[s] || s);

function showError(msg, err) {
  console.error(msg, err || "");
  $("errMsg").textContent = msg + (err && err.message ? " – " + err.message : "");
  $("errAlert").open = true;
}
function bootMsg(t) { $("bootMsg").textContent = t; }

// -------------------------------------------------------------------------------------
// 1. Sign in (OAuth, same-window redirect)
// -------------------------------------------------------------------------------------
const [esriConfig, OAuthInfo, esriId, Portal] = await $arcgis.import([
  "@arcgis/core/config.js",
  "@arcgis/core/identity/OAuthInfo.js",
  "@arcgis/core/identity/IdentityManager.js",
  "@arcgis/core/portal/Portal.js"
]);
const yardAction = document.querySelector('#actionBar [data-panel="yard"]');
if (yardAction && !yardAction.querySelector(".cargo-container-action-icon")) {
  yardAction.removeAttribute("icon");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "cargo-container-action-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M2 3.5h12v9H2zM5 4v8m3-8v8m3-8v8M3.5 2h9M4 14h8");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.35");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  icon.append(path);
  yardAction.append(icon);
}
const brandLogo = document.querySelector("calcite-navigation-logo");
if (brandLogo) brandLogo.setAttribute("thumbnail", "container-mark.svg?v=20261002-road-forklifts");
esriConfig.portalUrl = CONFIG.portalUrl;
const oauth = new OAuthInfo({ appId: CONFIG.appId, portalUrl: CONFIG.portalUrl, popup: false });
esriId.registerOAuthInfos([oauth]);
const sharingUrl = CONFIG.portalUrl + "/sharing";

try {
  await esriId.checkSignInStatus(sharingUrl);
} catch {
  bootMsg("Redirecting to ArcGIS sign-in…");
  await esriId.getCredential(sharingUrl);   // navigates away; page reloads signed in
}

let portal;
try {
  portal = new Portal({ url: CONFIG.portalUrl, authMode: "immediate" });
  await portal.load();
  $("userChip").fullName = portal.user?.fullName || portal.user?.username || "";
  $("userChip").username = portal.user?.username || "";
} catch (e) {
  showError("Signed in, but could not load your ArcGIS organization.", e);
}

$("signOutBtn").addEventListener("click", () => {
  esriId.destroyCredentials();
  window.location.reload();
});

// -------------------------------------------------------------------------------------
// 2. Map
// -------------------------------------------------------------------------------------
bootMsg("Loading the yard map…");
await customElements.whenDefined("arcgis-map");
const mapEl = $("map");
mapEl.itemId = CONFIG.webmapId;
try {
  await mapEl.viewOnReady();
} catch (e) {
  showError("The web map could not be loaded. Check that it is shared with you.", e);
}
const view = mapEl.view;
$("boot").classList.add("hide");

function findLayer(title) {
  const lyr = view.map.allLayers.find((l) => l.title === title);
  if (!lyr) console.warn(`Layer "${title}" not found in the web map. Update CONFIG.layers.`);
  return lyr;
}
const L = {
  doors: findLayer(CONFIG.layers.doors),
  stalls: findLayer(CONFIG.layers.stalls),
  locs: findLayer(CONFIG.layers.locs),
  facilities: findLayer(CONFIG.layers.facilities)
};
await Promise.all(Object.values(L).filter(Boolean).map((l) => l.load()));

const [GraphicsLayer, Graphic] = await $arcgis.import([
  "@arcgis/core/layers/GraphicsLayer.js",
  "@arcgis/core/Graphic.js"
]);
const trafficLayer = new GraphicsLayer({ title: "Multimodal Yard Traffic Telemetry (Simulated)" });
view.map.add(trafficLayer);

const canalRoute = [
  [4.4113111, 51.8785906], [4.4088365, 51.8814895], [4.4084111, 51.8819878],
  [4.4035964, 51.8876274], [4.4002698, 51.8915235], [4.3957054, 51.8968687]
];
const metersBetween = (a, b) => {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians, lat2 = b[1] * radians;
  const dLat = lat2 - lat1, dLon = (b[0] - a[0]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const destinationPoint = (origin, bearing, distance) => {
  const radians = Math.PI / 180;
  const angularDistance = distance / 6371000;
  const bearingRadians = bearing * radians;
  const latitude = origin[1] * radians;
  const longitude = origin[0] * radians;
  const endLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearingRadians));
  const endLongitude = longitude + Math.atan2(Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude), Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(endLatitude));
  return [endLongitude / radians, endLatitude / radians];
};
const routeDistances = [0];
for (let i = 1; i < canalRoute.length; i++) {
  routeDistances.push(routeDistances[i - 1] + metersBetween(canalRoute[i - 1], canalRoute[i]));
}
const routeLength = routeDistances.at(-1);
const pointOnRoute = (distance) => {
  const d = Math.max(0, Math.min(routeLength, distance));
  const segment = Math.max(0, routeDistances.findIndex((end) => end >= d) - 1);
  const start = canalRoute[segment], end = canalRoute[segment + 1];
  const fraction = (d - routeDistances[segment]) / (routeDistances[segment + 1] - routeDistances[segment]);
  const lat1 = start[1] * Math.PI / 180, lat2 = end[1] * Math.PI / 180;
  const dLon = (end[0] - start[0]) * Math.PI / 180;
  const bearing = (Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2)) * 180 / Math.PI + 360) % 360;
  return { coordinates: [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction], bearing };
};
const shipIcon = (color) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="60" viewBox="0 0 36 60"><path d="M18 2 29 15 27 43 22 55 18 59 14 55 9 43 7 15Z" fill="#102f36" stroke="#fffef8" stroke-width="2"/><path d="M11 19h14v17H11z" fill="${color}"/><path d="M13 22h4v5h-4zm6 0h4v5h-4zm-6 8h4v5h-4zm6 0h4v5h-4z" fill="#fffef8"/><path d="M12 40h12M14 45h8" stroke="#d9ed4d" stroke-width="2" stroke-linecap="round"/><path d="M15 12h6v5h-6z" fill="#fffef8"/></svg>`
);
const vessels = [
  { id: "NL-RTM-204", name: "MV Delta Trader", type: "Container feeder", destination: "Waalhaven", color: "#e65c3b", draft: 5.8, distance: routeLength * 0.18, direction: 1, baseSpeed: 8.6, phase: 0.8 },
  { id: "NL-RTM-118", name: "MT Noordzee", type: "Product tanker", destination: "Nieuwe Maas", color: "#d9ed4d", draft: 4.2, distance: routeLength * 0.52, direction: -1, baseSpeed: 6.9, phase: 3.1 },
  { id: "NL-RTM-076", name: "MV Rijn Trader", type: "Dry-bulk coaster", destination: "Eemhaven", color: "#58b9ad", draft: 3.6, distance: routeLength * 0.84, direction: 1, baseSpeed: 7.8, phase: 4.9 }
];
const simulatedSource = "Simulated telemetry; not live AIS or GPS.";
const telemetryGraphics = vessels.map((vessel) => {
  const position = pointOnRoute(vessel.distance);
  const geometry = { type: "point", longitude: position.coordinates[0], latitude: position.coordinates[1] };
  const ship = new Graphic({
    geometry,
    symbol: { type: "picture-marker", url: shipIcon(vessel.color), width: 24, height: 40, angle: position.bearing + (vessel.direction < 0 ? 180 : 0) },
    attributes: { vessel: vessel.name, vesselId: vessel.id, vesselType: vessel.type, destination: vessel.destination, draft: vessel.draft, source: simulatedSource },
    popupTemplate: {
      title: "{vessel}",
      content: "<b>Vessel ID:</b> {vesselId}<br><b>Type:</b> {vesselType}<br><b>Destination:</b> {destination}<br><b>Speed:</b> {speed} kn<br><b>Heading:</b> {heading}°<br><b>Draft:</b> {draft} m<br><b>Track:</b> {direction}<br><b>Navigation:</b> {navigation}<br><b>Source:</b> {source}"
    }
  });
  const label = new Graphic({
    geometry,
    symbol: { type: "text", text: "", color: "#18332e", haloColor: "#fffef8", haloSize: 2, yoffset: 23, font: { family: "IBM Plex Sans", size: 9, weight: "bold" } }
  });
  trafficLayer.addMany([ship, label]);
  return { vessel, ship, label };
});

const siteLayer = view.map.allLayers.find((layer) => layer.title === "Sites");
const gateLayer = view.map.allLayers.find((layer) => layer.title === "Gates") ||
  view.map.allLayers.find((layer) => layer.title === "GateLanes");
const roadwayLayer = view.map.allLayers.find((layer) => layer.title === "YardZones");
const wgs84 = { wkid: 4326 };
let truckSpatialReference = wgs84;
let yardCoordinate = null;
let gateCoordinate = null;
if (roadwayLayer) {
  try {
    await roadwayLayer.load();
    truckSpatialReference = roadwayLayer.spatialReference;
  } catch (e) { console.warn("Could not load yard road zones for truck routing.", e); }
}
if (siteLayer) {
  try {
    await siteLayer.load();
    const query = siteLayer.createQuery();
    query.where = "1=1";
    query.outSpatialReference = truckSpatialReference;
    const result = await siteLayer.queryExtent(query);
    if (result.extent) yardCoordinate = [result.extent.center.x, result.extent.center.y];
  } catch (e) { console.warn("Could not locate the yard site for truck telemetry.", e); }
}
if (gateLayer) {
  try {
    await gateLayer.load();
    const query = gateLayer.createQuery();
    query.where = "1=1";
    query.outFields = ["NAME", "LANE_DIR"];
    query.outSpatialReference = truckSpatialReference;
    query.returnGeometry = true;
    const result = await gateLayer.queryFeatures(query);
    const gate = result.features.find((feature) => /main gate/i.test(feature.attributes.NAME || "")) ||
      result.features.find((feature) => String(feature.attributes.LANE_DIR || "").toLowerCase() === "in") ||
      result.features[0];
    if (gate) {
      const point = gate.geometry.type === "point" ? gate.geometry : gate.geometry.extent.center;
      gateCoordinate = [point.x, point.y];
    }
  } catch (e) { console.warn("Could not locate the yard gate for truck telemetry.", e); }
}
let roadwayGeometries = [];
if (roadwayLayer && truckSpatialReference?.isGeographic === false) {
  try {
    const query = roadwayLayer.createQuery();
    query.where = "ZONE_TYPE = 'Roadway'";
    query.outFields = ["NAME", "ZONE_TYPE"];
    query.returnGeometry = true;
    const result = await roadwayLayer.queryFeatures(query);
    roadwayGeometries = result.features.map((feature) => feature.geometry).filter((geometry) => geometry?.rings?.length);
  } catch (e) { console.warn("Could not query roadway zones for truck routing.", e); }
}
const pointInRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const pointInRoad = (x, y) => roadwayGeometries.some((geometry) => {
  if (x < geometry.extent.xmin || x > geometry.extent.xmax || y < geometry.extent.ymin || y > geometry.extent.ymax) return false;
  let inside = false;
  for (const ring of geometry.rings) if (pointInRing(x, y, ring)) inside = !inside;
  return inside;
});
const buildRoadGrid = () => {
  if (!roadwayGeometries.length) return null;
  const extent = roadwayGeometries.reduce((bounds, geometry) => ({
    xmin: Math.min(bounds.xmin, geometry.extent.xmin), ymin: Math.min(bounds.ymin, geometry.extent.ymin),
    xmax: Math.max(bounds.xmax, geometry.extent.xmax), ymax: Math.max(bounds.ymax, geometry.extent.ymax)
  }), { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity });
  const cellSize = 3;
  const columns = Math.ceil((extent.xmax - extent.xmin) / cellSize) + 1;
  const rows = Math.ceil((extent.ymax - extent.ymin) / cellSize) + 1;
  if (columns * rows > 1200000) {
    console.warn("Roadway area is too large for the local truck path grid.");
    return null;
  }
  const walkable = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    const y = extent.ymin + row * cellSize + cellSize / 2;
    for (let column = 0; column < columns; column++) {
      const x = extent.xmin + column * cellSize + cellSize / 2;
      if (pointInRoad(x, y)) walkable[row * columns + column] = 1;
    }
  }
  return { ...extent, cellSize, columns, rows, walkable };
};
const truckRoadGrid = buildRoadGrid();
const findRoadCell = (coordinate) => {
  if (!truckRoadGrid || !coordinate) return -1;
  let nearest = -1, nearestDistance = Infinity;
  for (let index = 0; index < truckRoadGrid.walkable.length; index++) {
    if (!truckRoadGrid.walkable[index]) continue;
    const column = index % truckRoadGrid.columns;
    const row = Math.floor(index / truckRoadGrid.columns);
    const x = truckRoadGrid.xmin + column * truckRoadGrid.cellSize + truckRoadGrid.cellSize / 2;
    const y = truckRoadGrid.ymin + row * truckRoadGrid.cellSize + truckRoadGrid.cellSize / 2;
    const distance = (x - coordinate[0]) ** 2 + (y - coordinate[1]) ** 2;
    if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
  }
  return nearestDistance <= 180 ** 2 ? nearest : -1;
};
const findRoadRoute = (start, goal) => {
  if (!truckRoadGrid || start < 0 || goal < 0) return null;
  const { columns, rows, cellSize, walkable } = truckRoadGrid;
  const count = columns * rows;
  const cost = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const heap = [];
  const push = (index, score) => {
    let position = heap.length;
    heap.push({ index, score });
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (heap[parent].score <= score) break;
      heap[position] = heap[parent];
      position = parent;
    }
    heap[position] = { index, score };
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let position = 0;
      while (true) {
        const left = position * 2 + 1, right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].score < heap[left].score ? right : left;
        if (heap[child].score >= last.score) break;
        heap[position] = heap[child];
        position = child;
      }
      heap[position] = last;
    }
    return first;
  };
  const heuristic = (index) => {
    const dx = Math.abs(index % columns - goal % columns), dy = Math.abs(Math.floor(index / columns) - Math.floor(goal / columns));
    return cellSize * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  cost[start] = 0;
  push(start, heuristic(start));
  while (heap.length) {
    const current = pop().index;
    if (visited[current]) continue;
    if (current === goal) {
      const route = [];
      for (let index = goal; index !== -1; index = previous[index]) {
        const column = index % columns, row = Math.floor(index / columns);
        route.push([truckRoadGrid.xmin + column * cellSize + cellSize / 2, truckRoadGrid.ymin + row * cellSize + cellSize / 2]);
      }
      return route.reverse();
    }
    visited[current] = 1;
    const column = current % columns, row = Math.floor(current / columns);
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
      if (!rowOffset && !columnOffset) continue;
      const nextColumn = column + columnOffset, nextRow = row + rowOffset;
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const next = nextRow * columns + nextColumn;
      if (!walkable[next] || visited[next]) continue;
      if (rowOffset && columnOffset && (!walkable[row * columns + nextColumn] || !walkable[nextRow * columns + column])) continue;
      const nextCost = cost[current] + cellSize * (rowOffset && columnOffset ? Math.SQRT2 : 1);
      if (nextCost >= cost[next]) continue;
      cost[next] = nextCost;
      previous[next] = current;
      push(next, nextCost + heuristic(next));
    }
  }
  return null;
};
const roadStart = findRoadCell(gateCoordinate);
const roadEnd = findRoadCell(yardCoordinate);
const truckRoadRoute = findRoadRoute(roadStart, roadEnd);
if (!truckRoadRoute) console.warn("Truck traffic paused: no connected roadway route links the yard gate and site.");
const makeTruckPath = (coordinates) => {
  const distances = [0];
  for (let i = 1; i < coordinates.length; i++) {
    const dx = coordinates[i][0] - coordinates[i - 1][0], dy = coordinates[i][1] - coordinates[i - 1][1];
    distances.push(distances[i - 1] + Math.hypot(dx, dy));
  }
  return { coordinates, distances, length: distances.at(-1) };
};
const truckPosition = (path, distance) => {
  const d = Math.max(0, Math.min(path.length, distance));
  const endIndex = Math.min(path.coordinates.length - 1, Math.max(1, path.distances.findIndex((end) => end >= d)));
  const start = path.coordinates[endIndex - 1], end = path.coordinates[endIndex];
  const fraction = (d - path.distances[endIndex - 1]) / (path.distances[endIndex] - path.distances[endIndex - 1]);
  const bearing = (Math.atan2(end[0] - start[0], end[1] - start[1]) * 180 / Math.PI + 360) % 360;
  return { coordinates: [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction], bearing };
};
const truckStopMs = 120000;
const truckSpeedMps = 30 * 0.44704;
const forkliftIcon = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\"><path d=\"M9 9h13v15H9z\" fill=\"#d9ed4d\" stroke=\"#153a35\" stroke-width=\"2\"/><path d=\"M22 11h5v13h-5M25 7v19m0 0h6m-6-3h6\" fill=\"none\" stroke=\"#153a35\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M5 12v9m0 0h4m-4-7h4\" fill=\"none\" stroke=\"#ca4d32\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"25\" r=\"2\" fill=\"#153a35\"/><circle cx=\"20\" cy=\"25\" r=\"2\" fill=\"#153a35\"/></svg>"
);
const trucks = truckRoadRoute ? [
  { id: "EFY-TRK-01", name: "Yard truck 01", side: -1, phase: "inbound", distance: 0, stoppedMs: 0 },
  { id: "EFY-TRK-02", name: "Yard truck 02", side: 1, phase: "stopped", stoppedMs: 0 }
].map((truck) => {
  truck.path = makeTruckPath(truckRoadRoute);
  if (truck.phase === "stopped") truck.distance = truck.path.length;
  const position = truckPosition(truck.path, truck.distance);
  const graphic = new Graphic({
    geometry: { type: "point", x: position.coordinates[0], y: position.coordinates[1], spatialReference: truckSpatialReference },
    symbol: { type: "picture-marker", url: forkliftIcon, width: 22, height: 22, angle: (position.bearing + 270) % 360 },
    attributes: { vehicle: truck.name, vehicleId: truck.id, speed: truck.phase === "stopped" ? 0 : 30, status: truck.phase === "stopped" ? "Stopped at yard" : "Inbound to yard", destination: "Eemhaven Freight Yard", source: simulatedSource },
    popupTemplate: {
      title: "{vehicle}",
      content: "<b>Vehicle ID:</b> {vehicleId}<br><b>Destination:</b> {destination}<br><b>Speed:</b> {speed} mph<br><b>Status:</b> {status}<br><b>Last update:</b> {lastUpdate}<br><b>Source:</b> {source}"
    }
  });
  trafficLayer.add(graphic);
  return { ...truck, graphic };
}) : [];
const trafficCount = document.querySelector(".traffic-status > span:nth-child(2)");
if (trafficCount) trafficCount.textContent = `3 vessels · ${trucks.length} trucks`;
let previousTick = performance.now();
function animateTraffic(now) {
  requestAnimationFrame(animateTraffic);
  if (now - previousTick < 700) return;
  const elapsed = Math.min((now - previousTick) / 1000, 1.5);
  previousTick = now;

  let vesselStates = [];
  try {
    vesselStates = telemetryGraphics.map(({ vessel }) => {
      const speed = vessel.baseSpeed + Math.sin(now / 8500 + vessel.phase) * 0.35;
      vessel.distance += vessel.direction * speed * 0.514444 * elapsed * 5;
      if (vessel.distance >= routeLength || vessel.distance <= 0) {
        vessel.distance = Math.max(0, Math.min(routeLength, vessel.distance));
        vessel.direction *= -1;
      }
      const position = pointOnRoute(vessel.distance);
      const heading = Math.round((position.bearing + (vessel.direction < 0 ? 180 : 0)) % 360);
      return { vessel, speed, position, heading };
    });
    telemetryGraphics.forEach(({ ship, label }, index) => {
      const { vessel, speed, position, heading } = vesselStates[index];
      const nearestOncoming = vesselStates.reduce((nearest, other) => {
        if (other.vessel === vessel || other.vessel.direction === vessel.direction) return nearest;
        return Math.min(nearest, Math.abs(other.vessel.distance - vessel.distance));
      }, Infinity);
      const passingStrength = Math.max(0, Math.min(1, (520 - nearestOncoming) / 340));
      const passingOffset = passingStrength * 42;
      const coordinates = passingOffset
        ? destinationPoint(position.coordinates, (heading + 90) % 360, passingOffset)
        : position.coordinates;
      const geometry = { type: "point", longitude: coordinates[0], latitude: coordinates[1] };
      const direction = vessel.direction > 0 ? "Northwestbound" : "Southeastbound";
      ship.geometry = geometry;
      ship.symbol = { type: "picture-marker", url: shipIcon(vessel.color), width: 24, height: 40, angle: heading };
      Object.assign(ship.attributes, { speed: speed.toFixed(1), heading, direction, navigation: passingStrength > 0.15 ? "Passing" : "Following canal route", lastUpdate: new Date().toLocaleTimeString() });
      label.geometry = geometry;
      label.symbol = { type: "text", text: `${vessel.name}  ${speed.toFixed(1)} kn${passingStrength > 0.15 ? "  PASSING" : ""}`, color: "#18332e", haloColor: "#fffef8", haloSize: 2, yoffset: 23, font: { family: "IBM Plex Sans", size: 9, weight: "bold" } };
    });
  } catch (error) {
    console.error("Vessel telemetry update failed; continuing traffic animation.", error);
  }

  try {
    trucks.forEach((truck) => {
      if (truck.phase === "inbound") {
        truck.distance = Math.min(truck.path.length, truck.distance + truckSpeedMps * elapsed);
        if (truck.distance >= truck.path.length) { truck.phase = "stopped"; truck.stoppedMs = 0; }
      } else if (truck.phase === "stopped") {
        truck.stoppedMs += elapsed * 1000;
        if (truck.stoppedMs >= truckStopMs) truck.phase = "outbound";
      } else {
        truck.distance = Math.max(0, truck.distance - truckSpeedMps * elapsed);
        if (truck.distance <= 0) truck.phase = "inbound";
      }
      const position = truckPosition(truck.path, truck.distance);
      const status = truck.phase === "inbound" ? "Inbound to yard" : truck.phase === "stopped" ? "Stopped at yard" : "Outbound from yard";
      truck.graphic.geometry = { type: "point", x: position.coordinates[0], y: position.coordinates[1], spatialReference: truckSpatialReference };
      truck.graphic.symbol = { type: "picture-marker", url: forkliftIcon, width: 22, height: 22, angle: Math.round((position.bearing + 270 + (truck.phase === "outbound" ? 180 : 0)) % 360) };
      Object.assign(truck.graphic.attributes, {
        speed: truck.phase === "stopped" ? 0 : 30,
        heading: Math.round((position.bearing + (truck.phase === "outbound" ? 180 : 0)) % 360),
        status,
        lastUpdate: new Date().toLocaleTimeString()
      });
    });
  } catch (error) {
    console.error("Forklift telemetry update failed; continuing traffic animation.", error);
  }
}
requestAnimationFrame(animateTraffic);

// -------------------------------------------------------------------------------------
// 3. Panel switching (action bar)
// -------------------------------------------------------------------------------------
$("actionBar").addEventListener("click", (evt) => {
  const action = evt.target.closest("calcite-action");
  if (!action) return;
  const id = action.dataset.panel;
  document.querySelectorAll("#actionBar calcite-action").forEach((a) => (a.active = a === action));
  document.querySelectorAll("#leftPanel calcite-panel").forEach((p) => (p.hidden = p.dataset.panel !== id));
});

// -------------------------------------------------------------------------------------
// 4. Data
// -------------------------------------------------------------------------------------
const state = { doors: [], stalls: [], storage: {}, doorFilter: "all" };

async function queryAll(layer, fields, geometry = false) {
  if (!layer) return [];
  const q = layer.createQuery();
  q.where = "1=1"; q.outFields = fields; q.returnGeometry = geometry;
  const res = await layer.queryFeatures(q);
  return res.features;
}

async function loadData() {
  const [doors, stalls, storageRows] = await Promise.all([
    queryAll(L.doors, ["DOOR_ID", "FACILITY_ID", "DOOR_TYPE", "DEMO_STATUS", "LEVEL_ID"], true),
    queryAll(L.stalls, ["STALL_ID", "ZONE", "STALL_TYPE", "DEMO_STATUS"]),
    (async () => {
      if (!L.locs) return [];
      const q = L.locs.createQuery();
      q.where = "1=1";
      q.groupByFieldsForStatistics = ["FACILITY_ID"];
      q.outStatistics = [
        { statisticType: "sum", onStatisticField: "DEMO_QTY", outStatisticFieldName: "qty" },
        { statisticType: "sum", onStatisticField: "CAPACITY", outStatisticFieldName: "cap" }
      ];
      return (await L.locs.queryFeatures(q)).features;
    })()
  ]);
  state.doors = doors;
  state.stalls = stalls;
  state.storage = {};
  storageRows.forEach((f) => {
    const a = f.attributes;
    state.storage[a.FACILITY_ID ?? a.facility_id] = { qty: a.qty ?? a.QTY ?? 0, cap: a.cap ?? a.CAP ?? 0 };
  });
  $("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString();
}

// -------------------------------------------------------------------------------------
// 5. Render: Overview
// -------------------------------------------------------------------------------------
function kpi(value, label, sub, tone) {
  return `<div class="kpi ${tone}"><div class="v">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
}

function renderOverview() {
  const d = state.doors.map((f) => f.attributes);
  const freeDoors = d.filter((a) => a.DEMO_STATUS === "Available").length;
  const downDoors = d.filter((a) => a.DEMO_STATUS === "Out of Service").length;
  const s = state.stalls.map((f) => f.attributes);
  const park = s.filter((a) => a.STALL_TYPE !== "Dock Door Stall");
  const freeStalls = park.filter((a) => a.DEMO_STATUS === "Empty").length;
  const reefers = s.filter((a) => a.DEMO_STATUS === "Reefer - Plugged In").length;
  const tot = Object.values(state.storage).reduce((acc, r) => ({ q: acc.q + r.qty, c: acc.c + r.cap }), { q: 0, c: 0 });
  const util = tot.c ? Math.round((100 * tot.q) / tot.c) : 0;

  $("kpis").innerHTML =
    kpi(`${freeDoors}<span class="muted"> / ${d.length}</span>`, "Dock doors free", downDoors ? `${downDoors} out of service` : "", "green") +
    kpi(`${freeStalls}<span class="muted"> / ${park.length}</span>`, "Trailer stalls free", "parking & chassis", "blue") +
    kpi(`${util}%`, "Storage utilized", `${tot.q.toLocaleString()} of ${tot.c.toLocaleString()} pallets`, "peach") +
    kpi(reefers, "Reefers plugged in", "cold-chain trailers", "mint");

  // building list
  const list = $("buildingList");
  list.innerHTML = "";
  Object.entries(BUILDINGS).forEach(([fid, name]) => {
    const bd = d.filter((a) => a.FACILITY_ID === fid);
    const st = state.storage[fid];
    const pct = st && st.cap ? Math.round((100 * st.qty) / st.cap) : null;
    const item = document.createElement("calcite-list-item");
    item.label = name;
    item.description = [
      bd.length ? `${bd.filter((a) => a.DEMO_STATUS === "Available").length}/${bd.length} doors free` : null,
      pct !== null ? `${pct}% storage` : null
    ].filter(Boolean).join(" · ") || "Support building";
    if (pct !== null) {
      const col = pct >= 90 ? "#e07b39" : pct >= 70 ? "#5fae80" : "#8fb8de";
      const m = document.createElement("div");
      m.slot = "content-bottom";
      m.style.padding = "0 12px 8px";
      m.innerHTML = `<div class="meter"><div style="width:${pct}%;background:${col}"></div></div>`;
      item.appendChild(m);
    }
    item.addEventListener("click", () => zoomToFacility(fid));
    list.appendChild(item);
  });
}

// -------------------------------------------------------------------------------------
// 6. Render: Dock doors board
// -------------------------------------------------------------------------------------
function renderDoors() {
  const list = $("doorList");
  list.innerHTML = "";
  const f = state.doorFilter;
  const keep = (s) => f === "all" || (f === "busy" ? s.startsWith("Occupied") : s === f);
  const byB = {};
  state.doors.forEach((g) => {
    if (!keep(g.attributes.DEMO_STATUS)) return;
    (byB[g.attributes.FACILITY_ID] ||= []).push(g);
  });
  Object.keys(BUILDINGS).forEach((fid) => {
    const doors = (byB[fid] || []).sort((a, b) => a.attributes.DOOR_ID.localeCompare(b.attributes.DOOR_ID, undefined, { numeric: true }));
    if (!doors.length) return;
    const grp = document.createElement("calcite-list-item-group");
    grp.heading = `${bname(fid)} (${doors.length})`;
    doors.forEach((g) => {
      const a = g.attributes;
      const it = document.createElement("calcite-list-item");
      it.label = a.DOOR_ID;
      it.description = a.DOOR_TYPE;
      const chip = document.createElement("span");
      chip.slot = "content-end";
      chip.className = chipClass(a.DEMO_STATUS);
      chip.textContent = shortStatus(a.DEMO_STATUS);
      it.appendChild(chip);
      it.addEventListener("click", () => zoomToFeature(g, 20));
      grp.appendChild(it);
    });
    list.appendChild(grp);
  });
  if (!list.children.length) list.innerHTML = `<calcite-notice open kind="brand" width="full"><div slot="message">No doors match this filter.</div></calcite-notice>`;
}
$("doorFilter").addEventListener("calciteSegmentedControlChange", (e) => {
  state.doorFilter = e.target.value;
  renderDoors();
});

// -------------------------------------------------------------------------------------
// 7. Render: Trailer yard
// -------------------------------------------------------------------------------------
function renderYard() {
  const zones = {};
  state.stalls.forEach((g) => {
    const a = g.attributes;
    (zones[a.ZONE] ||= {})[a.DEMO_STATUS] = ((zones[a.ZONE] || {})[a.DEMO_STATUS] || 0) + 1;
  });
  const html = Object.entries(zones).sort().map(([z, counts]) => {
    const total = Object.values(counts).reduce((x, y) => x + y, 0);
    const used = total - (counts["Empty"] || 0);
    const segs = Object.entries(STALL_COLORS).filter(([k]) => counts[k])
      .map(([k, c]) => `<div title="${k}: ${counts[k]}" style="width:${(100 * counts[k]) / total}%;background:${c}"></div>`).join("");
    const leg = Object.entries(STALL_COLORS).filter(([k]) => counts[k])
      .map(([k, c]) => `<span><i style="background:${c}"></i>${k} ${counts[k]}</span>`).join("");
    return `<div class="zone" data-zone="${z}"><div class="h"><span>${z}</span><span>${Math.round((100 * used) / total)}%</span></div>
            <div class="muted">${used} of ${total} stalls in use</div><div class="stack">${segs}</div><div class="legend">${leg}</div></div>`;
  }).join("");
  $("yardContent").innerHTML = html || `<calcite-notice open kind="brand" width="full"><div slot="message">No stall data.</div></calcite-notice>`;
  document.querySelectorAll("#yardContent .zone").forEach((el) => el.addEventListener("click", () => zoomToZone(el.dataset.zone)));
}

// -------------------------------------------------------------------------------------
// 8. Map interactions
// -------------------------------------------------------------------------------------
async function zoomToFeature(graphic, zoom = 19) {
  try {
    await view.goTo({ target: graphic.geometry, zoom });
    view.openPopup({ features: [graphic], location: graphic.geometry });
  } catch (e) { console.warn(e); }
}
async function zoomToFacility(fid) {
  if (!L.facilities) return;
  const q = L.facilities.createQuery();
  q.where = `FACILITY_ID = '${fid}'`; q.returnGeometry = true; q.outFields = ["*"];
  const r = await L.facilities.queryFeatures(q);
  if (r.features.length) {
    await view.goTo({ target: r.features[0].geometry.extent.clone().expand(1.4) });
    view.openPopup({ features: [r.features[0]] });
  }
}
async function zoomToZone(zone) {
  if (!L.stalls) return;
  const q = L.stalls.createQuery();
  q.where = `ZONE = '${zone.replace(/'/g, "''")}'`;
  const ext = await L.stalls.queryExtent(q);
  if (ext.extent) await view.goTo(ext.extent.expand(1.3));
}

// -------------------------------------------------------------------------------------
// 9. Refresh loop
// -------------------------------------------------------------------------------------
async function refresh() {
  try {
    await loadData();
    renderOverview();
    renderDoors();
    renderYard();
  } catch (e) {
    showError("Could not load yard data.", e);
  }
}
$("refreshBtn").addEventListener("click", refresh);
await refresh();
setInterval(refresh, CONFIG.refreshSeconds * 1000);

// -------------------------------------------------------------------------------------
// 10. Quick views (views.js)
// -------------------------------------------------------------------------------------
try {
  const { initViews } = await import("./views.js");
  await initViews({
    view,
    floorFilterEl: document.querySelector("arcgis-floor-filter"),
    listEl: $("viewList"),
    notesEl: $("viewNotes")
  });
} catch (e) {
  showError("Quick views failed to load.", e);
}
