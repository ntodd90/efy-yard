import { BERTH_VESSELS, vesselPoint, cargoDeliveryEvents, createBerthState, advanceBerth, berthSnapshot, cranePose } from "./shipping-model.js?v=20261110-shipping-v19";
import { HISTORY_PREROLL_SECONDS } from "./picking-model.js?v=20261110-loading-v15";

const spatialReference = { wkid: 28992 };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const rect = (x, y, length, width) => [[x - length / 2, y - width / 2], [x + length / 2, y - width / 2], [x + length / 2, y + width / 2], [x - length / 2, y + width / 2]];
const colors = ["#88a99a", "#ba765e", "#8cabbc", "#d2b76e", "#8d9f72", "#bac4c8"];

export function initShipping({ view, GraphicsLayer, Graphic }) {
  const ships = new GraphicsLayer({ title: "Cargo ships (Simulated)", visible: true });
  const cranes = new GraphicsLayer({ title: "Quayside cranes (Simulated)", visible: true });
  const states = new Map(), entities = [], popupBindings = new Set();
  const popupStyles = [...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules].filter((rule) => rule.selectorText?.includes(".ship-")).map((rule) => rule.cssText); }
    catch { return []; }
  }).join("\n");
  let active = "current", lastDraw = -Infinity;
  const polygon = (points) => ({ type: "polygon", rings: [[...points, points[0]]], spatialReference });
  const point = (coordinate) => ({ type: "point", x: coordinate[0], y: coordinate[1], spatialReference });
  const line = (paths) => ({ type: "polyline", paths, spatialReference });
  const scenarioState = (id) => {
    if (!states.has(id)) states.set(id, { clock: HISTORY_PREROLL_SECONDS, epoch: Date.now(), berths: BERTH_VESSELS.map(createBerthState) });
    return states.get(id);
  };
  const currentState = (index) => scenarioState(active || "current").berths[index];
  const shape = (layer, geometry, color, outline, attributes, popupTemplate) => {
    const graphic = new Graphic({ geometry, symbol: { type: "simple-fill", color, outline: { color: outline || "#354950", width: 0.6 } }, attributes, popupTemplate });
    layer.add(graphic);
    return graphic;
  };
  const stroke = (layer, paths, color, width = 0.7, popupTemplate = null, attributes = null) => {
    const graphic = new Graphic({ geometry: line(paths), symbol: { type: "simple-line", color, width }, attributes, popupTemplate });
    layer.add(graphic);
    return graphic;
  };
  function popupNode(index, crane = false) {
    const vessel = BERTH_VESSELS[index], node = document.createElement("div");
    node.className = "ship-loading-popup";
    node.innerHTML = `<h3 class="ship-popup-vessel">${escapeHtml(vessel.name)}</h3><div class="ship-popup-heading"><span>${escapeHtml(vessel.berthName)}</span><strong>SIMULATED</strong></div>
      <div class="ship-popup-fill"><strong data-value="percent"></strong><span>vessel capacity</span></div>
      <progress max="100" value="0" aria-label="Vessel loaded capacity"></progress>
      <div class="ship-popup-status" data-value="phase"></div>
      <dl>${[
        ["onboard", "Cargo onboard"], ["remaining", "Available capacity"], ["thisCall", "Loaded this call"], ["received", "Delivered to quay"], ["queue", "Quayside queue"],
        ["rate", "Achieved loading rate"], ["cargoMass", "Estimated cargo mass"], ["dimensions", "Length / beam"], ["draft", "Est. current draft"],
        ["deadweight", "Design deadweight"], ["crane", "Crane / nominal cycle"], ["reach", "Rated outreach / lift"], ["vesselType", "Vessel class"], ["flag", "Registry"], ["destination", "Service"], ["callSign", "Demo call sign"]
      ].map(([key, label]) => `<div><dt>${label}</dt><dd data-value="${key}"></dd></div>`).join("")}</dl>
      <p class="ship-popup-note">${crane ? "Cargo is credited only when the spreader places it on the ship. " : ""}One simulated lift = one 20-foot container (1 TEU), averaging ${vessel.containerTonnes} t. Two containers are initially staged at each handoff; subsequent cargo comes from completed forklift deliveries. Vessel dimensions, capacity, draft and operating metrics are illustrative, not AIS, surveyed CAD or an approved stowage plan.</p>`;
    const style = document.createElement("style");
    style.textContent = popupStyles;
    node.prepend(style);
    const binding = { index, node, created: performance.now() };
    popupBindings.add(binding);
    updatePopup(binding);
    return node;
  }
  function updatePopup({ index, node }) {
    const vessel = BERTH_VESSELS[index], snapshot = berthSnapshot(currentState(index));
    node.querySelector(".ship-popup-heading span").textContent = `${vessel.berthName} · ${active === "optimized" ? "Optimized" : "Current"} plan`;
    const values = {
      percent: `${snapshot.percentFull.toFixed(1)}%`, phase: snapshot.phase,
      onboard: `${snapshot.onboard.toLocaleString()} / ${snapshot.capacity} TEU`, remaining: `${snapshot.remaining} TEU`,
      thisCall: `${snapshot.loadedThisCall} containers`, received: `${snapshot.received} containers`, queue: `${snapshot.queue} containers`, rate: `${snapshot.liftsPerHour.toFixed(1)} lifts/h`,
      cargoMass: `${snapshot.cargoTonnes.toLocaleString()} t`, dimensions: `${vessel.length} / ${vessel.beam} m`, draft: `${snapshot.estimatedDraft.toFixed(1)} m (modeled)`,
      deadweight: `${vessel.deadweight.toLocaleString()} t`, crane: `${vessel.berth === "QUAY-W" ? "QC-01" : "QC-02"} / ${vessel.cycleSeconds} s`,
      reach: `${vessel.craneReach} m / ${vessel.craneCapacity} t`, vesselType: vessel.vesselType, flag: vessel.flag, destination: vessel.destination, callSign: vessel.callSign
    };
    Object.entries(values).forEach(([key, value]) => { node.querySelector(`[data-value="${key}"]`).textContent = value; });
    const progress = node.querySelector("progress");
    progress.value = snapshot.percentFull;
    progress.setAttribute("aria-valuetext", `${snapshot.percentFull.toFixed(1)} percent full`);
  }
  let extent = null;
  BERTH_VESSELS.forEach((vessel, index) => {
    const transform = (coordinates) => coordinates.map(([along, across]) => vesselPoint(vessel, along, across));
    const attributes = { shipId: vessel.id, vessel: vessel.name, berth: vessel.berth, source: "Schematic simulated coastal cargo vessel" };
    const popupTemplate = { title: vessel.name, content: () => popupNode(index) };
    const craneTemplate = { title: `QC-0${index + 1} · ${vessel.berthName}`, content: () => popupNode(index, true) };
    const halfLength = vessel.length / 2, halfBeam = vessel.beam / 2;
    const hullRing = transform([[-halfLength, -halfBeam * 0.65], [-halfLength + 3, -halfBeam], [halfLength - 17, -halfBeam], [halfLength - 6, -halfBeam * 0.65],
      [halfLength, -halfBeam * 0.16], [halfLength, halfBeam * 0.16], [halfLength - 6, halfBeam * 0.65], [halfLength - 17, halfBeam], [-halfLength + 3, halfBeam], [-halfLength, halfBeam * 0.65]]);
    const hull = shape(ships, polygon(hullRing), vessel.hullColor, "#172b32", attributes, popupTemplate);
    extent = extent ? extent.union(hull.geometry.extent) : hull.geometry.extent.clone();
    const deck = transform([[-halfLength + 4, -halfBeam + 1.2], [halfLength - 18, -halfBeam + 1.2], [halfLength - 5, 0], [halfLength - 18, halfBeam - 1.2], [-halfLength + 4, halfBeam - 1.2]]);
    shape(ships, polygon(deck), "#b7c3c6", "#edf1ee", attributes, popupTemplate);
    stroke(ships, [hullRing.map(([x, y]) => [vessel.center[0] + (x - vessel.center[0]) * 0.965, vessel.center[1] + (y - vessel.center[1]) * 0.965])], "#e7eae5", 0.5);
    for (let hold = 0; hold < 3; hold++) shape(ships, polygon(transform(rect(-vessel.length * 0.17 + hold * vessel.length * 0.18, 0, vessel.length * 0.17, vessel.beam * 0.7))), "#879b9e", "#4e656a", attributes, popupTemplate);
    shape(ships, polygon(transform(rect(-vessel.length * 0.35, 0, 15, vessel.beam * 0.75))), "#e8ece8", "#788e94", attributes, popupTemplate);
    shape(ships, polygon(transform(rect(-vessel.length * 0.37, 0, 7, vessel.beam * 0.62))), "#f6f7ee", "#788e94", attributes, popupTemplate);
    for (let window = -2; window <= 2; window++) shape(ships, polygon(transform(rect(-vessel.length * 0.345, window * 2.2, 1.2, 1.5))), "#477184", "#477184", attributes, popupTemplate);
    shape(ships, polygon(transform(rect(-vessel.length * 0.42, 0, 4, 3))), "#cf7250", "#2d434c", attributes, popupTemplate);
    for (const side of [-1, 1]) {
      shape(ships, polygon(transform(rect(-vessel.length * 0.35, side * vessel.beam * 0.43, 6, 1.7))), "#d89055", "#354950", attributes, popupTemplate);
      const attachment = vesselPoint(vessel, side * vessel.length * 0.34, halfBeam * 0.85), shore = vesselPoint(vessel, side * vessel.length * 0.36, halfBeam + 29);
      stroke(ships, [[attachment, shore]], "#a6a99b", 0.65);
    }
    for (const along of [-vessel.length * 0.44, vessel.length * 0.35]) {
      const winch = new Graphic({ geometry: point(vesselPoint(vessel, along, 0)), symbol: { type: "simple-marker", style: "circle", size: 3, color: "#dfe5df", outline: { color: "#506970", width: 0.5 } }, attributes, popupTemplate });
      ships.add(winch);
    }
    const cells = [];
    const bayCount = Math.floor(vessel.length * 0.56 / 6.4);
    for (let bay = 0; bay < bayCount; bay++) for (let row = 0; row < 5; row++) {
      const along = -vessel.length * 0.255 + bay * 6.4, across = (row - 2) * 2.55;
      const coordinate = vesselPoint(vessel, along, across);
      const graphic = shape(ships, polygon(transform(rect(along, across, 6.05, 2.28))), "#9baeb0", "#d9e3df", attributes, popupTemplate);
      stroke(ships, [transform([[along, across - 0.95], [along, across + 0.95]])], "#d3dfdc", 0.25);
      cells.push({ coordinate, graphic, color: colors[(bay * 3 + row) % colors.length] });
    }
    const targets = cells.filter((cell) => Math.hypot(cell.coordinate[0] - vessel.craneBase[0], cell.coordinate[1] - vessel.craneBase[1]) <= vessel.craneReach - 2);
    if (!targets.length) throw new Error(`No reachable loading positions on ${vessel.name}.`);
    const label = new Graphic({ geometry: point(vessel.center), symbol: { type: "text", text: vessel.name, color: "#f6f7ee", haloColor: "#18332e", haloSize: 1.2, yoffset: -25, font: { family: "IBM Plex Sans", size: 9, weight: "bold" } } });
    ships.add(label);
    const baseFrame = { ...vessel, center: vessel.craneBase };
    shape(cranes, polygon(rect(-3, 0, 11, 8).map(([along, across]) => vesselPoint(baseFrame, along, across))), "#c9963f", "#283d43", attributes, craneTemplate);
    for (const side of [-1, 1]) for (const along of [-6, 2]) shape(cranes, polygon(rect(along, side * 4, 3, 1.5).map(([x, y]) => vesselPoint(baseFrame, x, y))), "#253c43", "#253c43", attributes, craneTemplate);
    shape(cranes, polygon(rect(-5, 0, 5, 6).map(([along, across]) => vesselPoint(baseFrame, along, across))), "#6e858b", "#283d43", attributes, craneTemplate);
    const armOutline = stroke(cranes, [[vessel.craneBase, vessel.handoff]], "#334a50", 5.5, craneTemplate, attributes);
    const arm = stroke(cranes, [[vessel.craneBase, vessel.handoff]], "#e9b64d", 2.4, craneTemplate, attributes);
    const lattice = stroke(cranes, [[vessel.craneBase, vessel.handoff]], "#fff0ac", 0.6, craneTemplate, attributes);
    const hook = new Graphic({ geometry: point(vessel.handoff), symbol: { type: "simple-marker", style: "square", size: 4, color: "#1c343c", outline: { color: "#edf2e8", width: 0.5 } }, attributes, popupTemplate: craneTemplate });
    cranes.add(hook);
    const cargo = shape(cranes, polygon(rect(vessel.handoff[0], vessel.handoff[1], 6.05, 2.44)), "#cc8d56", "#523f35", attributes, craneTemplate);
    const staging = shape(cranes, polygon(rect(vessel.handoff[0] + 3, vessel.handoff[1] + 4, 6.05, 2.44)), "#9ab59f", "#425a50", attributes, craneTemplate);
    entities.push({ vessel, hull, cells, targets, label, arm, armOutline, lattice, hook, cargo, staging, attributes, lastOnboard: -1 });
  });
  view.map.addMany([ships, cranes]);

  function render(now = performance.now(), force = false) {
    if (!force && now - lastDraw < 100) return;
    lastDraw = now;
    entities.forEach((entity, index) => {
      const { vessel } = entity, state = currentState(index), snapshot = berthSnapshot(state);
      const target = entity.targets[state.completedCycles % entity.targets.length].coordinate;
      const pose = cranePose(vessel, snapshot, target);
      if (entity.lastOnboard !== snapshot.onboard) {
        entity.lastOnboard = snapshot.onboard;
        entity.cells.forEach((cell, cellIndex) => {
          const filled = cellIndex / entity.cells.length < snapshot.percentFull / 100;
          cell.graphic.symbol = { type: "simple-fill", color: filled ? cell.color : "#9baeb0", outline: { color: "#d9e3df", width: 0.45 } };
        });
        const labelSymbol = entity.label.symbol.clone();
        labelSymbol.text = `${vessel.name} · ${snapshot.percentFull.toFixed(1)}%`;
        entity.label.symbol = labelSymbol;
      }
      const attributes = { ...entity.attributes, percentFull: Number(snapshot.percentFull.toFixed(2)), onboardTeu: snapshot.onboard, capacityTeu: vessel.capacityTeu,
        loadedThisCall: snapshot.loadedThisCall, received: snapshot.received, queue: snapshot.queue, status: snapshot.phase, scenario: active || "current", source: "Simulated vessel and cargo data; not AIS or surveyed CAD" };
      if (entity.hull.attributes.percentFull !== attributes.percentFull || entity.hull.attributes.status !== attributes.status || entity.hull.attributes.queue !== attributes.queue
        || entity.hull.attributes.received !== attributes.received || entity.hull.attributes.scenario !== attributes.scenario) {
        entity.hull.attributes = attributes;
        entity.arm.attributes = attributes;
      }
      const tip = pose.hook, base = vessel.craneBase;
      entity.arm.geometry = line([[base, tip]]); entity.armOutline.geometry = line([[base, tip]]);
      const length = Math.hypot(tip[0] - base[0], tip[1] - base[1]), normal = [-Math.sin(pose.angle), Math.cos(pose.angle)];
      const zigzag = [];
      for (let step = 0; step <= 8; step++) zigzag.push([base[0] + Math.cos(pose.angle) * length * step / 8 + normal[0] * (step % 2 ? 0.6 : -0.6), base[1] + Math.sin(pose.angle) * length * step / 8 + normal[1] * (step % 2 ? 0.6 : -0.6)]);
      entity.lattice.geometry = line([zigzag]);
      entity.hook.geometry = point(tip);
      const cargoFrame = { ...vessel, center: tip };
      entity.cargo.geometry = polygon(rect(0, 0, 6.05, 2.44).map(([along, across]) => vesselPoint(cargoFrame, along, across)));
      entity.cargo.visible = pose.carrying;
      entity.staging.visible = snapshot.queue > 0;
    });
    popupBindings.forEach((binding) => {
      if (binding.node.isConnected || now - binding.created < 2000) updatePopup(binding); else popupBindings.delete(binding);
    });
  }
  render(performance.now(), true);
  return {
    layers: [ships, cranes], extent,
    setActive(id) { active = id || active; render(performance.now(), true); },
    reset(id) { states.delete(id); scenarioState(id); if (id === active) render(performance.now(), true); },
    advance(id, fromSeconds, toSeconds, vehicles) {
      const scenario = scenarioState(id);
      const from = Math.max(fromSeconds, scenario.clock);
      if (toSeconds <= from) return;
      const events = vehicles.flatMap((vehicle) => cargoDeliveryEvents(vehicle.timeline, from, toSeconds));
      scenario.berths.forEach((berth) => advanceBerth(berth, toSeconds - from, events.filter((event) => event.berth === berth.vessel.berth).map((event) => ({ offsetSeconds: event.atSeconds - from, units: event.units }))));
      scenario.clock = toSeconds;
      if (id === active) render();
    }
  };
}