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
const vesselLayer = new GraphicsLayer({ title: "Commercial Vessel Traffic (Simulated)" });
view.map.add(vesselLayer);

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
const simulatedSource = "Simulated telemetry; not live AIS. Track follows OpenStreetMap's Eemhaven canal centerline.";
const telemetryGraphics = vessels.map((vessel) => {
  const position = pointOnRoute(vessel.distance);
  const geometry = { type: "point", longitude: position.coordinates[0], latitude: position.coordinates[1] };
  const ship = new Graphic({
    geometry,
    symbol: { type: "picture-marker", url: shipIcon(vessel.color), width: 24, height: 40, angle: position.bearing + (vessel.direction < 0 ? 180 : 0) },
    attributes: { vessel: vessel.name, vesselId: vessel.id, vesselType: vessel.type, destination: vessel.destination, draft: vessel.draft, source: simulatedSource },
    popupTemplate: {
      title: "{vessel}",
      content: "<b>Vessel ID:</b> {vesselId}<br><b>Type:</b> {vesselType}<br><b>Destination:</b> {destination}<br><b>Speed:</b> {speed} kn<br><b>Heading:</b> {heading}°<br><b>Draft:</b> {draft} m<br><b>Track:</b> {direction}<br><b>Source:</b> {source}"
    }
  });
  const label = new Graphic({
    geometry,
    symbol: { type: "text", text: "", color: "#18332e", haloColor: "#fffef8", haloSize: 2, yoffset: 23, font: { family: "IBM Plex Sans", size: 9, weight: "bold" } }
  });
  vesselLayer.addMany([ship, label]);
  return { vessel, ship, label };
});
let previousTick = performance.now();
function animateVessels(now) {
  if (now - previousTick >= 700) {
    const elapsed = Math.min((now - previousTick) / 1000, 1.5);
    previousTick = now;
    telemetryGraphics.forEach(({ vessel, ship, label }) => {
      const speed = vessel.baseSpeed + Math.sin(now / 8500 + vessel.phase) * 0.35;
      vessel.distance += vessel.direction * speed * 0.514444 * elapsed * 5;
      if (vessel.distance >= routeLength || vessel.distance <= 0) {
        vessel.distance = Math.max(0, Math.min(routeLength, vessel.distance));
        vessel.direction *= -1;
      }
      const position = pointOnRoute(vessel.distance);
      const heading = Math.round((position.bearing + (vessel.direction < 0 ? 180 : 0)) % 360);
      const geometry = { type: "point", longitude: position.coordinates[0], latitude: position.coordinates[1] };
      const direction = vessel.direction > 0 ? "Northwestbound" : "Southeastbound";
      ship.geometry = geometry;
      ship.symbol = { type: "picture-marker", url: shipIcon(vessel.color), width: 24, height: 40, angle: heading };
      Object.assign(ship.attributes, { speed: speed.toFixed(1), heading, direction, lastUpdate: new Date().toLocaleTimeString() });
      label.geometry = geometry;
      label.symbol = { type: "text", text: `${vessel.name}  ${speed.toFixed(1)} kn`, color: "#18332e", haloColor: "#fffef8", haloSize: 2, yoffset: 23, font: { family: "IBM Plex Sans", size: 9, weight: "bold" } };
    });
  }
  requestAnimationFrame(animateVessels);
}
requestAnimationFrame(animateVessels);

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
