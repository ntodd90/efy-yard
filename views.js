// =====================================================================================
// Quick views ("bookmarks with brains") for O&M / campus-operations demos.
// Each view sets: layer visibility, utility filters, floor, camera, highlight, popup,
// and shows presenter talking points. Keys 1–9 jump to the first nine views.
// =====================================================================================

// Layer categories. Utility layers are detected by their fields, so renaming them in
// the web map doesn't break anything. Everything else is matched by title.
const BY_TITLE = {
  DockDoors: "doors", RackLocations: "slots", Gates: "gates", Racks: "racks", Units: "units",
  Levels: "levels", Facilities: "facilities", Details: "details", TrailerStalls: "stalls",
  YardZones: "zones", GateLanes: "lanes", RailTracks: "rails", Sites: "sites",
  Pathways: "routing", Transitions: "routing"
};
const INDOOR = ["facilities", "levels", "units", "details"];
const BASE = ["sites", "zones", "rails"];

export const VIEWS = [
  {
    id: "campus", title: "Campus overview", icon: "globe",
    desc: "Every building, floor and asset on one live map",
    layers: "default", target: { site: true },
    notes: ["One authoritative map for 7 buildings, 11 floors and the yard",
            "Building outlines come from the national register (BAG)",
            "The tiles on the left update live from the same data"]
  },
  {
    id: "utilities", title: "Utilities: full stack", icon: "layers",
    desc: "Everything underground and in the ceilings",
    layers: [...BASE, "facilities", "utilLine", "utilPoint"], target: { site: true }, floor: null,
    notes: ["Fiber, water, sewer, fire and power on one map, in 3D (Z-aware)",
            "Click any line for size, depth below the yard and length",
            "Site mains connect through laterals to each building's service room"]
  },
  {
    id: "fire", title: "Fire & life safety", icon: "exclamation-mark-triangle",
    desc: "Hydrants, risers, FDCs and sprinkler mains",
    layers: [...BASE, "facilities", "utilLine", "utilPoint"], filter: "SYSTEM = 'Fire Protection'",
    target: { site: true }, floor: null,
    notes: ["Every hydrant on a 90 m spacing along the DN250 fire main",
            "Each building: riser room, fire-brigade connection, ESFR cross-mains",
            "Use it for inspection routes and fire-brigade pre-plans"]
  },
  {
    id: "it", title: "IT & network", icon: "link",
    desc: "MDF, IDFs, fiber backbone, Wi-Fi, cameras",
    layers: [...BASE, "facilities", "utilLine", "utilPoint", "gates"], filter: "SYSTEM = 'Telecom'",
    target: { site: true }, floor: null,
    notes: ["Main fiber room (MDF) in the Yard Operations Center feeds an IDF in every building",
            "Wireless access points and dock-door sensors hang off the warehouse cable trays",
            "Question to ask: which doors lose sensors if IDF B2 goes down?"]
  },
  {
    id: "power", title: "Electrical power", icon: "flash",
    desc: "10 kV ring, substation and switchboards",
    layers: [...BASE, "facilities", "utilLine", "utilPoint"], filter: "SYSTEM = 'Electrical'",
    target: { site: true }, floor: null,
    notes: ["A 10 kV ring along the main yard road, fed from the site substation",
            "Each building is fed to its main switchboard (MSB) in the electrical room",
            "Good lead-in to outage planning and EV/reefer charging capacity"]
  },
  {
    id: "water", title: "Water & sewer", icon: "drop",
    desc: "Gravity sewer with invert elevations",
    layers: [...BASE, "facilities", "utilLine", "utilPoint"], filter: "SYSTEM IN ('Plumbing', 'Sewer')",
    target: { site: true }, floor: null,
    notes: ["The sanitary main falls 0.25% to the lift station: click a segment for its inverts",
            "Building laterals fall at 2% with drop manholes, all Z-aware",
            "Water enters each building through a meter and backflow preventer"]
  },
  {
    id: "office", title: "Office & workplace", icon: "organization",
    desc: "Yard Operations Center, Level 2",
    layers: "default", target: { units: "NAME = 'Yard Control Room'", expand: 3.2 },
    floor: { facility: "EFY.B7", level: "EFY.B7.L2" },
    highlight: { cat: "units", where: "NAME = 'Yard Control Room'" }, popup: true,
    notes: ["A 3-floor office wing: lobby and MDF on L1, control room on L2, admin and IT on L3",
            "The floor filter switches levels; stairs and elevator line up on every floor",
            "Lead-in to space planning, hoteling and work orders by room"]
  },
  {
    id: "maint", title: "Maintenance shop", icon: "wrench",
    desc: "Cross-Dock F annex: forklift bays and charging",
    layers: "default", target: { units: "NAME LIKE 'Forklift Maintenance%'", expand: 2.5 },
    floor: { facility: "EFY.B6", level: "EFY.B6.L1" },
    highlight: { cat: "units", where: "NAME LIKE 'Forklift Maintenance%' OR NAME = 'Battery Charging'" },
    notes: ["Forklift bays, tire and parts store, lube room and battery charging",
            "Offices and training sit above on Level 2",
            "Pair with asset and work-order data for a preventive maintenance story"]
  },
  {
    id: "cold", title: "Cold chain", icon: "certificate",
    desc: "Warehouse D: freezer, chiller and pharma rooms",
    layers: "default", target: { facility: "EFY.B4", expand: 1.3 },
    floor: { facility: "EFY.B4", level: "EFY.B4.L1" },
    highlight: { cat: "units", where: "USE_TYPE = 'Cold Storage'" },
    notes: ["Freezer (−25 °C), chiller (+2 °C) and pharma (15–25 °C) rooms, each racked",
            "The refrigeration plant room sits next to the dock",
            "Click a room for live pallet utilization"]
  },
  {
    id: "docks", title: "Dock & yard operations", icon: "car",
    desc: "Warehouse A dock face and trailer parks",
    layers: "default", target: { facility: "EFY.B1", expand: 1.6 }, floor: null,
    highlight: { cat: "doors", where: "DEMO_STATUS = 'Out of Service'" },
    notes: ["66 dock doors, each with live status and its own trailer stall",
            "Highlighted: doors out of service, a natural link to a maintenance work order",
            "The Dock Doors panel lists every door, filterable by status"]
  },
  {
    id: "security", title: "Security & access", icon: "lock",
    desc: "Main gate, lanes and license-plate cameras",
    layers: [...BASE, "facilities", "levels", "units", "gates", "lanes", "utilPoint", "stalls"],
    filter: "ASSET_TYPE = 'Camera / LPR'", filterCats: ["utilPoint"],
    target: { facility: "EFY.GH", expand: 6 }, floor: null,
    notes: ["2 inbound and 2 outbound truck lanes with license-plate (LPR) cameras",
            "Check-in booths in the gatehouse; yard cameras across the site",
            "Lead-in to gate appointments and dwell-time analytics"]
  }
];

// -------------------------------------------------------------------------------------
export async function initViews({ view, floorFilterEl, listEl, notesEl }) {
  // collect + classify layers
  const flayers = view.map.allLayers.filter((l) => l.type === "feature").toArray();
  await Promise.allSettled(flayers.map((l) => l.load()));
  const cat = new Map();
  flayers.forEach((l) => {
    const f = (l.fields || []).map((x) => x.name.toUpperCase());
    if (f.includes("ASSET_TYPE") && f.includes("SYSTEM")) cat.set(l, "utilPoint");
    else if (f.includes("SUBTYPE") && f.includes("SYSTEM")) cat.set(l, "utilLine");
    else cat.set(l, BY_TITLE[l.title] || "other");
  });
  // snapshot of the web map's own state, so "default" can restore it
  const snap = new Map(flayers.map((l) => [l, { visible: l.visible, def: l.definitionExpression || "" }]));
  const layersOf = (c) => flayers.filter((l) => cat.get(l) === c);
  console.info("[views] layer categories:", flayers.map((l) => `${l.title} → ${cat.get(l)}`).join(" | "));

  const setVisible = (l, v) => {
    l.visible = v;
    if (v) { let p = l.parent; while (p && p.type === "group") { p.visible = true; p = p.parent; } }
  };

  let hl = null;
  let activeId = null;

  async function apply(v) {
    activeId = v.id;
    hl?.remove(); hl = null;
    view.closePopup?.();

    // 1. layers + filters
    flayers.forEach((l) => {
      const s = snap.get(l);
      const c = cat.get(l);
      const vis = v.layers === "default" ? s.visible : v.layers.includes(c);
      setVisible(l, vis);
      const applies = v.filter && (v.filterCats ? v.filterCats.includes(c) : (c === "utilLine" || c === "utilPoint"));
      l.definitionExpression = applies ? (s.def ? `(${s.def}) AND (${v.filter})` : v.filter) : s.def;
    });

    // 2. floor
    try {
      if (v.floor) {
        if (floorFilterEl) { floorFilterEl.facility = v.floor.facility; floorFilterEl.level = v.floor.level; }
        if (view.floors) { view.floors.removeAll(); view.floors.add(v.floor.level); }
      } else {
        if (floorFilterEl) { floorFilterEl.level = null; floorFilterEl.facility = null; }
        view.floors?.removeAll();
      }
    } catch (e) { console.warn("[views] floor", e); }

    // 3. camera
    try {
      const t = v.target || {};
      let ext = null, feat = null;
      if (t.site) {
        const sites = layersOf("sites")[0];
        if (sites) ext = (await sites.queryExtent()).extent;
      } else if (t.facility) {
        const fac = layersOf("facilities")[0];
        if (fac) ext = (await fac.queryExtent({ where: `FACILITY_ID = '${t.facility}'` })).extent;
      } else if (t.units) {
        const u = layersOf("units")[0];
        if (u) {
          const r = await u.queryFeatures({ where: t.units, outFields: ["*"], returnGeometry: true });
          if (r.features.length) { feat = r.features[0]; ext = r.features.reduce((e, f) => (e ? e.union(f.geometry.extent) : f.geometry.extent.clone()), null); }
        }
      }
      if (ext) await view.goTo(ext.clone().expand(t.expand || 1.15), { duration: 1200 });
      if (v.popup && feat) view.openPopup({ features: [feat] });
    } catch (e) { console.warn("[views] camera", e); }

    // 4. highlight
    try {
      if (v.highlight) {
        const lyr = layersOf(v.highlight.cat)[0];
        if (lyr) {
          const lv = await view.whenLayerView(lyr);
          const r = await lyr.queryObjectIds({ where: v.highlight.where });
          if (r.length) hl = lv.highlight(r);
        }
      }
    } catch (e) { console.warn("[views] highlight", e); }

    renderList();
    notesEl.innerHTML = `<div class="notes-title">${v.title}</div><ul>${v.notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
  }

  function renderList() {
    listEl.innerHTML = "";
    VIEWS.forEach((v, i) => {
      const it = document.createElement("calcite-list-item");
      it.label = (i < 9 ? `${i + 1}  ·  ` : "") + v.title;
      it.description = v.desc;
      it.active = v.id === activeId;
      it.selected = v.id === activeId;
      const ic = document.createElement("calcite-icon");
      ic.slot = "content-start"; ic.icon = v.icon; ic.scale = "m";
      it.appendChild(ic);
      it.addEventListener("click", () => apply(v));
      listEl.appendChild(it);
    });
  }

  // keyboard shortcuts 1–9 (ignored while typing)
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, calcite-input, [contenteditable]")) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && VIEWS[n - 1]) apply(VIEWS[n - 1]);
  });

  renderList();
  notesEl.innerHTML = `<div class="muted">Pick a view, or press 1–9. Talking points appear here.</div>`;
  return { apply, VIEWS };
}
