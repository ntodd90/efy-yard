export const FORKLIFTS = [
  { id: "FL-01", color: "#007f86", trailStyle: "solid", battery: 96 },
  { id: "FL-02", color: "#d45132", trailStyle: "dash", battery: 92 },
  { id: "FL-03", color: "#3868bd", trailStyle: "dot", battery: 94 },
  { id: "FL-04", color: "#ad3680", trailStyle: "dash-dot", battery: 90 }
];
export const FREQUENCIES = {
  High: { daily: 8, color: "#f5c84c" },
  Medium: { daily: 3, color: "#85b9aa" },
  Low: { daily: 1, color: "#344e60" }
};
export const ASSUMPTIONS = { speed: 2, pickSeconds: 35, unloadSeconds: 25, kwhPerKm: 0.45, batteryKwh: 24 };

export function lastWeek(now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: end - 7 * 86400000, end };
}

export function makePath(coordinates) {
  const points = coordinates.filter((point, index) => !index || Math.hypot(point[0] - coordinates[index - 1][0], point[1] - coordinates[index - 1][1]) > 0.001);
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  }
  return { points, distances, length: distances.at(-1) };
}

export function weeklyPaths(trips) {
  const segments = new Map();
  for (const trip of trips) {
    for (const path of [trip.outbound, trip.returnPath]) {
      for (let index = 1; index < path.points.length; index++) {
        const start = path.points[index - 1], end = path.points[index];
        const key = [JSON.stringify(start), JSON.stringify(end)].sort().join(":");
        if (!segments.has(key)) segments.set(key, [start, end]);
      }
    }
  }
  return [...segments.values()];
}

export function positionOnPath(path, distance) {
  if (path.points.length < 2) return { point: path.points[0], bearing: 0 };
  const bounded = Math.max(0, Math.min(path.length, distance));
  let end = path.distances.findIndex((value, index) => index > 0 && value >= bounded);
  if (end < 0) end = path.points.length - 1;
  const startPoint = path.points[end - 1], endPoint = path.points[end];
  const fraction = (bounded - path.distances[end - 1]) / (path.distances[end] - path.distances[end - 1]);
  return {
    point: [startPoint[0] + (endPoint[0] - startPoint[0]) * fraction, startPoint[1] + (endPoint[1] - startPoint[1]) * fraction],
    bearing: (Math.atan2(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]) * 180 / Math.PI + 360) % 360
  };
}

export function recentTrail(trips, tripIndex, traveled, limit = 200) {
  const completed = [];
  for (let offset = Math.min(2, tripIndex); offset > 0; offset--) {
    const trip = trips[tripIndex - offset];
    completed.push(...trip.outbound.points, ...trip.returnPath.points.slice(1));
  }
  const trip = trips[tripIndex];
  const current = makePath([...trip.outbound.points, ...trip.returnPath.points.slice(1)]);
  current.points.forEach((point, index) => { if (current.distances[index] < traveled) completed.push(point); });
  completed.push(positionOnPath(current, traveled).point);
  const path = makePath(completed);
  if (path.length <= limit) return path.points.length > 1 ? [path.points] : [];
  const startDistance = path.length - limit;
  return [[positionOnPath(path, startDistance).point, ...path.points.filter((point, index) => path.distances[index] > startDistance)]];
}

export function createRouter(paths, findPath) {
  const graph = {}, nodes = new Map();
  const keyFor = (point) => `${Math.round(point[0] * 2)},${Math.round(point[1] * 2)}`;
  for (const path of paths) {
    for (let index = 0; index < path.length; index++) {
      const key = keyFor(path[index]);
      if (!nodes.has(key)) nodes.set(key, path[index].slice(0, 2));
      graph[key] ||= {};
      if (index) {
        const previous = keyFor(path[index - 1]);
        if (previous === key) continue;
        const distance = Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
        graph[key][previous] = distance;
        graph[previous][key] = distance;
      }
    }
  }
  const nearest = (point) => {
    let selected = null, best = 40;
    nodes.forEach((coordinate, key) => {
      const distance = Math.hypot(point[0] - coordinate[0], point[1] - coordinate[1]);
      if (distance < best) { best = distance; selected = key; }
    });
    return selected;
  };
  const cache = new Map();
  const calculate = (start, end) => {
    const first = nearest(start), last = nearest(end);
    if (first && last && findPath) {
      try {
        const keys = findPath(graph, first, last);
        if (keys.length > 1) return { ...makePath([start, ...keys.map((key) => nodes.get(key)), end]), schematic: false };
      } catch {}
    }
    return null;
  };
  return (start, end) => {
    const key = `${start[0]},${start[1]}:${end[0]},${end[1]}`;
    if (!cache.has(key)) cache.set(key, calculate(start, end));
    return cache.get(key);
  };
}

function shuffle(items) {
  let seed = 48117;
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const other = seed % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function scheduleCongestion(fleet) {
  const reservations = new Map(), cursors = fleet.map(() => 0), available = fleet.map(() => 0);
  fleet.forEach((forklift) => { forklift.congestionSeconds = 0; forklift.waitSeconds = 0; forklift.conflicts = 0; });
  const count = fleet.reduce((total, forklift) => total + forklift.trips.length, 0);
  for (let completed = 0; completed < count; completed++) {
    let selected = -1, arrival = Infinity;
    fleet.forEach((forklift, index) => {
      const trip = forklift.trips[cursors[index]];
      if (!trip) return;
      const candidate = available[index] + Math.max(0, trip.outbound.length - Math.min(8, trip.outbound.length / 4)) / ASSUMPTIONS.speed;
      if (candidate < arrival) { arrival = candidate; selected = index; }
    });
    const forklift = fleet[selected], trip = forklift.trips[cursors[selected]];
    const slot = trip.slot;
    const area = slot.aisle ? `${slot.zone || ""}:${slot.aisle}` : `${Math.floor(slot.point[0] / 20)}:${Math.floor(slot.point[1] / 20)}`;
    const key = `${slot.facility || "yard"}:${slot.level || "ground"}:${area}`;
    const occupied = reservations.get(key);
    const waiting = Math.max(0, (occupied?.until || 0) - arrival);
    const approach = Math.min(8, trip.outbound.length / 4);
    trip.startSeconds = available[selected];
    trip.congestionSeconds = 0;
    if (waiting > 0) {
      const backup = Math.min(1.5, trip.outbound.length - approach);
      trip.traffic = { atSeconds: (trip.outbound.length - approach) / ASSUMPTIONS.speed, waitSeconds: waiting,
        maneuverSeconds: 6, backup, blockingForklift: occupied.forklift };
      trip.congestionSeconds = waiting + trip.traffic.maneuverSeconds;
      trip.distance += backup * 2;
      forklift.distance += backup * 2;
      forklift.congestionSeconds += trip.congestionSeconds;
      forklift.waitSeconds += waiting;
      forklift.conflicts++;
    }
    reservations.set(key, { until: arrival + trip.congestionSeconds + approach * 2 / ASSUMPTIONS.speed + ASSUMPTIONS.pickSeconds, forklift: forklift.id });
    available[selected] += trip.travelSeconds + ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds + trip.congestionSeconds;
    cursors[selected]++;
  }
}

export function buildScenarios(storage, docks, route, now = new Date(), { optimizedUplift = 0, optimizedRoute = null, fixedQuayAssignments = false, centralPickingFacilities = [], onProgress = () => {} } = {}) {
  if (!Number.isFinite(optimizedUplift) || optimizedUplift < 0 || optimizedUplift > 1) throw new Error("Optimized workload uplift must be between 0 and 1.");
  if (!storage.length || !docks.length) throw new Error("Picking requires storage locations and operational loading docks.");
  onProgress(0);
  const slots = storage.map((slot, index) => {
    const candidates = docks.filter((dock) => dock.kind === "quay" || slot.kind === "container" || (dock.facility === slot.facility && dock.level === slot.level))
      .sort((first, second) => Math.hypot(first.point[0] - slot.point[0], first.point[1] - slot.point[1]) - Math.hypot(second.point[0] - slot.point[0], second.point[1] - slot.point[1])).slice(0, 3);
    const routePlans = candidates.map((dock) => {
      const currentPath = route(dock.point, slot.point), optimizedPath = optimizedRoute ? optimizedRoute(dock.point, slot.point) : currentPath;
      return { dock, path: currentPath, optimizedPath };
    }).filter((plan) => plan.path?.length > 0 && plan.optimizedPath?.length > 0);
    const current = [...routePlans].sort((first, second) => first.path.length - second.path.length)[0];
    const optimized = [...routePlans].sort((first, second) => first.optimizedPath.length - second.optimizedPath.length)[0];
    const common = current && optimized && (!fixedQuayAssignments || routePlans.length === docks.length);
    onProgress(0.6 * (index + 1) / storage.length);
    return { ...slot, dock: common ? current.dock : null, path: common ? current.path : null,
      routePlans, optimizedDock: common ? optimized.dock : null, optimizedPath: common ? optimized.optimizedPath : null };
  }).sort((first, second) => first.id.localeCompare(second.id));
  if (slots.filter((slot) => slot.path).length < 4) throw new Error("At least four ground-floor storage positions with matching docks are required.");
  const week = lastWeek(now);
  const demand = new Map();
  shuffle(slots).forEach((slot, index) => {
    const frequency = index < Math.ceil(slots.length * 0.2) ? "High" : index < Math.ceil(slots.length * 0.5) ? "Medium" : "Low";
    demand.set(slot.id, { sku: `BEER-${String(index + 1).padStart(4, "0")}`, frequency, daily: FREQUENCIES[frequency].daily,
      quayId: fixedQuayAssignments ? docks[index % docks.length].id : null });
  });
  const optimizedDemand = new Map();
  let allocated = 0;
  const centralFacilities = new Set(centralPickingFacilities);
  const optimizedLength = (slot, product = null) => product?.quayId
    ? slot.routePlans.find((plan) => plan.dock.id === product.quayId)?.optimizedPath.length ?? Infinity
    : slot.optimizedPath?.length ?? Infinity;
  const sectorFor = (slot) => `${slot.facility || "yard"}:${slot.level || "ground"}:${Math.floor(slot.point[0] / 60)}:${Math.floor(slot.point[1] / 60)}`;
  for (const group of new Set(slots.map((slot) => `${slot.kind}:${Boolean(slot.path)}`))) {
    const compatible = slots.filter((slot) => `${slot.kind}:${Boolean(slot.path)}` === group).sort((first, second) => optimizedLength(first) - optimizedLength(second) || first.id.localeCompare(second.id));
    const products = compatible.map((slot) => demand.get(slot.id)).sort((first, second) => second.daily - first.daily || first.sku.localeCompare(second.sku));
    const remaining = [...compatible], busySlots = [], sectorLoads = new Map(), aisleLoads = new Map();
    let centralReservations = fixedQuayAssignments && compatible[0]?.path
      ? Math.min(compatible.filter((slot) => centralFacilities.has(slot.facility)).length,
        Math.ceil(products.filter((product) => product.frequency === "High" && product.quayId === docks[0].id).length / 2)) : 0;
    for (const product of products) {
      let selected = 0;
      if ((product.frequency === "High" || fixedQuayAssignments) && compatible[0]?.path) {
        let bestScore = Infinity;
        const centralPick = centralReservations > 0 && product.frequency === "High" && product.quayId === docks[0].id;
        const remainingCentral = remaining.filter((slot) => centralFacilities.has(slot.facility)).length;
        remaining.forEach((slot, index) => {
          if (centralPick && !centralFacilities.has(slot.facility)) return;
          if (!centralPick && centralReservations && remainingCentral <= centralReservations && centralFacilities.has(slot.facility)) return;
          const separation = busySlots.reduce((nearest, busy) => Math.min(nearest, Math.hypot(slot.point[0] - busy.point[0], slot.point[1] - busy.point[1])), Infinity);
          const aisle = slot.aisle ? `${slot.facility}:${slot.zone}:${slot.aisle}` : slot.id;
          const crowding = product.frequency === "High" ? (sectorLoads.get(sectorFor(slot)) || 0) * 300 + (aisleLoads.get(aisle) || 0) * 600 + Math.max(0, 45 - separation) * 12 : 0;
          const score = optimizedLength(slot, product) + crowding;
          if (score < bestScore) { bestScore = score; selected = index; }
        });
      }
      const [slot] = remaining.splice(selected, 1);
      optimizedDemand.set(slot.id, product);
      allocated++;
      onProgress(0.6 + 0.1 * allocated / slots.length);
      if (product.frequency === "High") {
        if (centralReservations && product.quayId === docks[0].id && centralFacilities.has(slot.facility)) centralReservations--;
        busySlots.push(slot);
        sectorLoads.set(sectorFor(slot), (sectorLoads.get(sectorFor(slot)) || 0) + 1);
        const aisle = slot.aisle ? `${slot.facility}:${slot.zone}:${slot.aisle}` : slot.id;
        aisleLoads.set(aisle, (aisleLoads.get(aisle) || 0) + 1);
      }
    }
  }
  const reachable = slots.filter((slot) => slot.path);
  const racks = reachable.filter((slot) => slot.kind === "rack");
  const outsideCentral = (racks.length >= 4 ? racks : reachable).filter((slot) => !centralFacilities.has(slot.facility));
  const rackSlots = (outsideCentral.length >= 4 ? outsideCentral : racks.length >= 4 ? racks : reachable).sort((first, second) => optimizedLength(first, optimizedDemand.get(first.id)) - optimizedLength(second, optimizedDemand.get(second.id)) || first.id.localeCompare(second.id));
  const remoteSlots = new Set(rackSlots.slice(Math.floor(rackSlots.length * 0.75)).map((slot) => slot.id));
  const nearSlots = slots.filter((slot) => slot.path && !remoteSlots.has(slot.id));
  const centralDispatch = nearSlots.some((slot) => centralFacilities.has(slot.facility));
  const nearbyFleetSize = centralDispatch ? 2 : 3;
  const dispatchAreaFor = (slot) => slot.aisle ? `${slot.facility}:${slot.level}:${slot.zone}:${slot.aisle}` : sectorFor(slot);
  const sectorOwners = new Map();
  [...new Set(nearSlots.filter((slot) => !centralDispatch || !centralFacilities.has(slot.facility)).map(dispatchAreaFor))].sort().forEach((sector, index) => sectorOwners.set(sector, index % nearbyFleetSize));
  const nearOwners = new Map(nearSlots.map((slot, index) => [slot.id, centralDispatch && centralFacilities.has(slot.facility) ? 2
    : sectorOwners.size >= nearbyFleetSize ? sectorOwners.get(dispatchAreaFor(slot)) : index % nearbyFleetSize]));
  const transfers = new Map();
  const scenario = (id, allocation) => {
    const planner = id === "optimized" && optimizedRoute ? optimizedRoute : route;
    const fleet = FORKLIFTS.map((forklift, index) => ({ ...forklift, role: id === "optimized" ? index === 3 ? "Deep-storage picking" : centralDispatch && index === 2 ? "Central-corridor picking" : "Zoned picking" : "Shared-aisle picking", trips: [], distance: 0, picks: 0, travelSeconds: 0, handlingSeconds: 0 }));
    const placements = slots.map((slot) => {
      const product = allocation.get(slot.id), plan = product.quayId ? slot.routePlans.find((candidate) => candidate.dock.id === product.quayId) : null;
      return { ...slot, path: !slot.path ? null : plan ? id === "optimized" ? plan.optimizedPath : plan.path : id === "optimized" ? slot.optimizedPath : slot.path,
        dock: !slot.path ? null : plan?.dock || (id === "optimized" ? slot.optimizedDock : slot.dock), ...product, weekly: product.daily * 7 };
    });
    for (let day = 0; day < 7; day++) {
      placements.forEach((slot) => {
        if (!slot.path) return;
        for (let pick = 0; pick < slot.daily; pick++) {
          const owner = remoteSlots.has(slot.id) ? 3 : nearOwners.get(slot.id) ?? 0;
          const forklift = fleet[id === "optimized" ? owner : (Number(slot.sku.slice(5)) + pick + day) % fleet.length];
          const trip = {
            slot, day, timestamp: week.start + day * 86400000 + (8 * 3600 + (Number(slot.sku.slice(5)) * 97 + pick * 331) % (8 * 3600)) * 1000,
          };
          forklift.trips.push(trip);
          forklift.picks++;
          forklift.handlingSeconds += ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds;
        }
      });
    }
    if (id === "optimized" && optimizedUplift) {
      const originalTrips = fleet.flatMap((forklift) => forklift.trips.map((trip) => ({ forklift, trip })));
      const additionalPicks = Math.round(originalTrips.length * optimizedUplift);
      for (let index = 0; index < additionalPicks; index++) {
        const { forklift, trip } = originalTrips[Math.floor(index * originalTrips.length / additionalPicks)];
        forklift.trips.push({ ...trip, timestamp: trip.timestamp + index + 1 });
        forklift.picks++;
        forklift.handlingSeconds += ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds;
        trip.slot.weekly++;
      }
    }
    fleet.forEach((forklift, forkliftIndex) => {
      const frequencyOrder = { High: 0, Medium: 1, Low: 2 };
      forklift.trips.sort((first, second) => first.day - second.day
        || (id === "current" ? frequencyOrder[first.slot.frequency] - frequencyOrder[second.slot.frequency]
          : dispatchAreaFor(first.slot).localeCompare(dispatchAreaFor(second.slot)))
        || first.slot.id.localeCompare(second.slot.id)
        || first.timestamp - second.timestamp);
      forklift.trips.forEach((trip, index) => {
        const previous = forklift.trips[(index + forklift.trips.length - 1) % forklift.trips.length];
        if (trip.slot.dock.kind === "quay") {
          trip.outbound = planner(previous.slot.dock.point, trip.slot.point);
          if (!trip.outbound) throw new Error("No land route connects the quayside handoff to the warehouse pickup.");
        } else if (previous.slot.dock.id === trip.slot.dock.id) trip.outbound = trip.slot.path;
        else {
          const key = `${previous.slot.dock.id}:${trip.slot.dock.id}`;
          const policyKey = `${optimizedRoute ? id : "shared"}:${key}`;
          if (!transfers.has(policyKey)) transfers.set(policyKey, planner(previous.slot.dock.point, trip.slot.dock.point));
          const transfer = transfers.get(policyKey);
          if (!transfer) throw new Error("Forklift dispatch docks are disconnected in the mapped navigation areas.");
          trip.outbound = { ...makePath([...transfer.points, ...trip.slot.path.points.slice(1)]), schematic: transfer.schematic || trip.slot.path.schematic };
        }
        trip.returnPath = { ...trip.slot.path, ...makePath([...trip.slot.path.points].reverse()) };
        trip.distance = trip.outbound.length + trip.returnPath.length;
        trip.travelSeconds = trip.distance / ASSUMPTIONS.speed;
        forklift.distance += trip.distance;
        forklift.travelSeconds += trip.travelSeconds;
      });
      onProgress(0.7 + (id === "optimized" ? 0.15 : 0) + 0.14 * (forkliftIndex + 1) / fleet.length);
    });
    scheduleCongestion(fleet);
    fleet.forEach((forklift) => { forklift.energy = forklift.distance / 1000 * ASSUMPTIONS.kwhPerKm; });
    const total = fleet.reduce((sum, forklift) => ({
      distance: sum.distance + forklift.distance, travelSeconds: sum.travelSeconds + forklift.travelSeconds,
      handlingSeconds: sum.handlingSeconds + forklift.handlingSeconds, picks: sum.picks + forklift.picks, energy: sum.energy + forklift.energy,
      congestionSeconds: sum.congestionSeconds + forklift.congestionSeconds, waitSeconds: sum.waitSeconds + forklift.waitSeconds, conflicts: sum.conflicts + forklift.conflicts
    }), { distance: 0, travelSeconds: 0, handlingSeconds: 0, picks: 0, energy: 0, congestionSeconds: 0, waitSeconds: 0, conflicts: 0 });
    const centralCorridorTrips = fleet.reduce((count, forklift) => count + forklift.trips.filter((trip) => trip.outbound.usesCentralCorridor || trip.returnPath.usesCentralCorridor).length, 0);
    onProgress(id === "optimized" ? 1 : 0.85);
    return { id, fleet, placements, total, week, centralCorridorTrips, fixedQuayAssignments, workloadUplift: id === "optimized" ? optimizedUplift : 0, excluded: slots.filter((slot) => !slot.path).length,
      schematic: fleet.reduce((count, forklift) => count + forklift.trips.filter((trip) => trip.outbound.schematic || trip.returnPath.schematic).length, 0) };
  };
  return { current: scenario("current", demand), optimized: scenario("optimized", optimizedDemand) };
}

export function replayTrip(trip, elapsed) {
  const outboundPath = trip.outbound || trip.slot.path;
  const returnPath = trip.returnPath || makePath([...trip.slot.path.points].reverse());
  const outbound = outboundPath.length / ASSUMPTIONS.speed;
  const travel = outbound + returnPath.length / ASSUMPTIONS.speed;
  const duration = travel + ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds + (trip.congestionSeconds || 0);
  let time = Math.max(0, Math.min(duration, elapsed));
  let maneuverDistance = 0;
  if (trip.traffic && time >= trip.traffic.atSeconds) {
    const traffic = trip.traffic, local = time - traffic.atSeconds;
    const maneuverHalf = traffic.maneuverSeconds / 2;
    if (local < trip.congestionSeconds) {
      const reverse = local < maneuverHalf ? traffic.backup * local / maneuverHalf
        : local < maneuverHalf + traffic.waitSeconds ? traffic.backup
        : traffic.backup * (1 - (local - maneuverHalf - traffic.waitSeconds) / maneuverHalf);
      const position = positionOnPath(outboundPath, traffic.atSeconds * ASSUMPTIONS.speed - reverse);
      const maneuvering = local < maneuverHalf || local >= maneuverHalf + traffic.waitSeconds;
      const traveled = traffic.atSeconds * ASSUMPTIONS.speed + (local < maneuverHalf ? reverse : traffic.backup * 2 - reverse);
      return { ...position, status: `${maneuvering ? "Maneuvering to yield to" : "Waiting for"} ${traffic.blockingForklift}`, loaded: false, duration, traveled, congested: true };
    }
    time -= trip.congestionSeconds;
    maneuverDistance = traffic.backup * 2;
  }
  let distance, status, loaded = false;
  if (time < outbound) { distance = time * ASSUMPTIONS.speed; status = trip.slot?.dock?.kind === "quay" ? "Returning empty to warehouse" : "Driving to pallet"; }
  else if (time < outbound + ASSUMPTIONS.pickSeconds) { distance = outboundPath.length; status = trip.slot?.dock?.kind === "quay" ? "Collecting warehouse container" : "Picking pallet"; }
  else if (time < travel + ASSUMPTIONS.pickSeconds) {
    distance = (time - outbound - ASSUMPTIONS.pickSeconds) * ASSUMPTIONS.speed;
    status = trip.slot?.dock?.kind === "quay" ? "Delivering container to quay" : "Delivering to dock"; loaded = true;
  } else { distance = returnPath.length; status = trip.slot?.dock?.kind === "quay" ? "Quayside handoff - awaiting crane" : "Unloading at dock"; loaded = true; }
  const position = positionOnPath(loaded ? returnPath : outboundPath, distance);
  return { ...position, status, loaded, duration, traveled: (loaded ? outboundPath.length + distance : distance) + maneuverDistance, congested: false };
}

export function breadcrumbTimestamp(epoch, ageSeconds) {
  return Math.round(epoch - ageSeconds * 1000);
}

export const HISTORY_WINDOWS = [
  { seconds: 1800, label: "30 min" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 7200, label: "2 hour" },
  { seconds: 43200, label: "12 hour" }
];
export const HEAT_SAMPLE_SECONDS = 30;
export const HISTORY_PREROLL_SECONDS = 43200;

export function createReplayTimeline(trips) {
  const seconds = [0], distances = [0];
  trips.forEach((trip) => {
    const state = replayTrip(trip, Infinity);
    seconds.push(seconds.at(-1) + state.duration);
    distances.push(distances.at(-1) + state.traveled);
  });
  return { trips, seconds, distances, duration: seconds.at(-1), distance: distances.at(-1) };
}

export function replayAtTime(timeline, timeSeconds) {
  if (!timeline.trips.length) return null;
  const bounded = Math.max(0, timeSeconds), cycles = Math.floor(bounded / timeline.duration);
  const cycleTime = bounded % timeline.duration;
  let low = 0, high = timeline.trips.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline.seconds[middle + 1] <= cycleTime) low = middle + 1;
    else high = middle;
  }
  const elapsed = cycleTime - timeline.seconds[low];
  const state = replayTrip(timeline.trips[low], elapsed);
  return { ...state, tripIndex: low, elapsed, totalDistance: cycles * timeline.distance + timeline.distances[low] + state.traveled };
}

export function movementHistory(timeline, timeSeconds, windowSeconds, sampleSeconds = HEAT_SAMPLE_SECONDS) {
  if (!timeline.trips.length) return [];
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0 || !Number.isFinite(sampleSeconds) || sampleSeconds <= 0) throw new Error("History window and sampling interval must be valid.");
  const samples = [], available = Math.min(windowSeconds, Math.max(0, timeSeconds));
  for (let ageSeconds = 0; ageSeconds <= available; ageSeconds += sampleSeconds) {
    const state = replayAtTime(timeline, timeSeconds - ageSeconds);
    samples.push({ point: state.point, ageSeconds, status: state.status });
  }
  return samples;
}

export function rollingBreadcrumbs(trips, tripIndex, elapsed, windowSeconds = 1800, sampleSeconds = 30) {
  if (!trips.length) return [];
  if (windowSeconds < 0 || sampleSeconds <= 0) throw new Error("Breadcrumb time window and sample interval must be valid.");
  const samples = [];
  let index = tripIndex, tripTime = elapsed, previousAge = 0;
  for (let ageSeconds = 0; ageSeconds <= windowSeconds; ageSeconds += sampleSeconds) {
    tripTime -= ageSeconds - previousAge;
    previousAge = ageSeconds;
    while (tripTime < 0) {
      index = (index + trips.length - 1) % trips.length;
      tripTime += replayTrip(trips[index], Infinity).duration;
    }
    const state = replayTrip(trips[index], tripTime);
    const previous = samples.at(-1);
    if (!previous || Math.hypot(previous.point[0] - state.point[0], previous.point[1] - state.point[1]) > 0.01) {
      samples.push({ point: state.point, ageSeconds, status: state.status });
    }
  }
  return samples;
}