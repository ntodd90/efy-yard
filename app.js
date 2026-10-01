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
