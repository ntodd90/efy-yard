import test from "node:test";
import assert from "node:assert/strict";
import { BERTH_VESSELS, vesselPoint, cargoDeliveryEvents, createBerthState, advanceBerth, berthSnapshot, cranePose } from "./shipping-model.js";

test("ships fill only when crane cargo is placed, not when a forklift arrives", () => {
  const vessel = { ...BERTH_VESSELS[0], initialStaged: 0, initialTeu: 10, capacityTeu: 12, cycleSeconds: 100 };
  const state = createBerthState(vessel);
  advanceBerth(state, 20);
  assert.equal(state.onboard, 10);
  advanceBerth(state, 64, [{ offsetSeconds: 0, units: 2 }]);
  assert.equal(state.onboard, 10);
  assert.equal(state.queue, 1);
  advanceBerth(state, 1);
  assert.equal(state.onboard, 11);
  assert.equal(berthSnapshot(state).percentFull, 11 / 12 * 100);
  advanceBerth(state, 300, [{ offsetSeconds: 200, units: 5 }]);
  assert.equal(state.onboard, 12);
  assert.equal(state.loadedThisCall, 2);
  assert.equal(berthSnapshot(state).percentFull, 100);
  assert.equal(state.queue, 5);
  assert.equal(berthSnapshot(state).phase, "Vessel at capacity");
});

test("crane loading is frame-rate independent and can process accelerated replay", () => {
  const vessel = { ...BERTH_VESSELS[1], initialStaged: 4 };
  const whole = createBerthState(vessel), stepped = createBerthState(vessel);
  advanceBerth(whole, 1000, [{ offsetSeconds: 250, units: 3 }]);
  for (let time = 0; time < 1000; time += 10) advanceBerth(stepped, 10, time === 250 ? [{ offsetSeconds: 0, units: 3 }] : []);
  assert.deepEqual(berthSnapshot(whole), berthSnapshot(stepped));
  assert.equal(whole.loadedThisCall, 7);
  const target = vesselPoint(vessel, -20, 0), pose = cranePose(vessel, { active: true, released: false, fraction: 0.55, phase: "Lowering" }, target);
  assert.ok(Math.hypot(pose.hook[0] - target[0], pose.hook[1] - target[1]) < 0.001);
  assert.equal(pose.carrying, true);
  assert.deepEqual(vesselPoint(vessel, 0, 0), vessel.center);
});

test("cargo arriving exactly on a frame boundary is neither lost nor loaded early", () => {
  const state = createBerthState({ ...BERTH_VESSELS[0], initialStaged: 0 });
  advanceBerth(state, 10, [{ offsetSeconds: 10, units: 1 }]);
  assert.equal(state.received, 1);
  assert.equal(state.queue, 1);
  assert.equal(state.loadedThisCall, 0);
  advanceBerth(state, 60);
  assert.equal(state.loadedThisCall, 1);
  assert.equal(state.received, 1);
});

test("forklift handoff completion feeds its assigned ship once, including replay loops", () => {
  const trip = (berth) => ({ slot: { dock: { id: berth, kind: "quay" } }, outbound: makePath([[0, 0], [100, 0]]), returnPath: makePath([[100, 0], [0, 0]]) });
  const timeline = createReplayTimeline([trip("QUAY-W"), trip("QUAY-E")]);
  assert.deepEqual(cargoDeliveryEvents(timeline, 0, 159), []);
  assert.deepEqual(cargoDeliveryEvents(timeline, 0, 160), [{ berth: "QUAY-W", atSeconds: 160, units: 1 }]);
  assert.deepEqual(cargoDeliveryEvents(timeline, 160, 320), [{ berth: "QUAY-E", atSeconds: 320, units: 1 }]);
  assert.equal(cargoDeliveryEvents(timeline, 0, 640).length, 4);
  assert.deepEqual(cargoDeliveryEvents(timeline, 160, 160), []);
});
import { buildScenarios, createRouter, lastWeek, replayTrip, makePath, positionOnPath, weeklyPaths, recentTrail, rollingBreadcrumbs, breadcrumbTimestamp, scheduleCongestion, ASSUMPTIONS, HISTORY_WINDOWS, HISTORY_PREROLL_SECONDS, createReplayTimeline, replayAtTime, movementHistory } from "./picking-model.js";

test("heat history windows add nested movement samples from the same replay clock", () => {
  const trips = [{ outbound: makePath([[0, 0], [4000, 0]]), returnPath: makePath([[4000, 0], [0, 0]]) }];
  const timeline = createReplayTimeline(trips);
  const clock = HISTORY_PREROLL_SECONDS + 47.25;
  const windows = HISTORY_WINDOWS.map(({ seconds }) => movementHistory(timeline, clock, seconds));
  assert.deepEqual(HISTORY_WINDOWS.map((window) => window.seconds), [1800, 3600, 7200, 43200]);
  assert.deepEqual(windows.map((samples) => samples.length), [61, 121, 241, 1441]);
  windows.forEach((samples, index) => {
    assert.deepEqual(samples[0].point, replayAtTime(timeline, clock).point);
    samples.forEach((sample) => assert.deepEqual(sample.point, replayAtTime(timeline, clock - sample.ageSeconds).point));
    if (index) assert.deepEqual(samples.slice(0, windows[index - 1].length), windows[index - 1]);
  });
  assert.equal(movementHistory(timeline, 0, 43200).length, 1);
  assert.equal(movementHistory(timeline, 45, 43200).length, 2);
});

test("movement heat follows congestion stops and reversing on the vehicle timeline", () => {
  const trip = { outbound: makePath([[0, 0], [100, 0]]), returnPath: makePath([[100, 0], [0, 0]]),
    congestionSeconds: 36, traffic: { atSeconds: 40, maneuverSeconds: 6, waitSeconds: 30, backup: 1.5, blockingForklift: "FL-02" } };
  const timeline = createReplayTimeline([trip]);
  const history = movementHistory(timeline, 60, 60, 5);
  assert.match(history[0].status, /Waiting for FL-02/);
  history.forEach((sample) => assert.deepEqual(sample.point, replayTrip(trip, 60 - sample.ageSeconds).point));
  const reverse = replayAtTime(timeline, 41.5);
  assert.ok(reverse.point[0] < replayAtTime(timeline, 40).point[0]);
  assert.deepEqual(movementHistory(timeline, 41.5, 0)[0].point, reverse.point);
});

test("ArcGIS date fields receive integer timestamps despite fractional replay time", () => {
  const epoch = 1793991153319.7;
  assert.equal(breadcrumbTimestamp(epoch, 0), 1793991153320);
  assert.ok(Number.isInteger(breadcrumbTimestamp(epoch, 30)));
  assert.equal(breadcrumbTimestamp(epoch, 0) - breadcrumbTimestamp(epoch, 1800), 1800000);
});
import { isLoadingDock, FORKLIFT_SIZE, REPLAY_SPEEDS, DEFAULT_REPLAY_SPEED, DEFAULT_HEAT_VISIBLE, TRAVEL_HEAT_RENDERER, QUAY_HANDOFFS, PICKING_LOADING_MESSAGE, loadingPercent } from "./picking.js";

test("loading percentage cannot reach 100 before explicit readiness", () => {
  assert.equal(PICKING_LOADING_MESSAGE, "Querying telemitry data and generating optimized routes");
  const values = [loadingPercent("data", 0, 8), loadingPercent("data", 8, 8), loadingPercent("navigation", 1, 1), loadingPercent("planning", 1, 1), loadingPercent("layers", 1, 1)];
  assert.ok(values.every((value, index) => value < 100 && (!index || value >= values[index - 1])));
  assert.equal(loadingPercent("layers", 999, 1), 99);
  assert.equal(loadingPercent("ready", 1, 1), 99);
  assert.equal(loadingPercent("ready", 1, 1, true), 100);
  assert.equal(loadingPercent("data", 0, 0), 0);
});

test("the yard has exactly two explicit land-side ship-loading destinations", () => {
  assert.deepEqual(QUAY_HANDOFFS.map((handoff) => handoff.id), ["QUAY-W", "QUAY-E"]);
  assert.ok(QUAY_HANDOFFS.every((handoff) => handoff.kind === "quay" && handoff.point.every(Number.isFinite)));
});

test("travel heat is hidden and replay starts at 1x by default", () => {
  assert.equal(DEFAULT_HEAT_VISIBLE, false);
  assert.equal(DEFAULT_REPLAY_SPEED, 1);
  assert.equal(TRAVEL_HEAT_RENDERER.type, "heatmap");
  assert.equal(TRAVEL_HEAT_RENDERER.colorStops[0].color[3], 0);
  assert.ok(TRAVEL_HEAT_RENDERER.radius > 0);
  assert.ok(TRAVEL_HEAT_RENDERER.maxDensity > TRAVEL_HEAT_RENDERER.minDensity);
});

test("replay speeds include the 400x race option", () => {
  assert.deepEqual(REPLAY_SPEEDS, [1, 6, 20, 400]);
});

test("forklift symbols are half their previous 34-unit size", () => {
  assert.equal(FORKLIFT_SIZE, 34 * 0.5);
});
import { createGridRouter, createCorridorRouter } from "./picking-routing.js";

test("live Dock Door values and legacy Dock values are accepted", () => {
  const feature = (type, status = "Available", level = "EFY.B1.L1") => ({ attributes: { DOOR_TYPE: type, DEMO_STATUS: status, LEVEL_ID: level } });
  assert.equal(isLoadingDock(feature("Dock Door")), true);
  assert.equal(isLoadingDock(feature("Dock")), true);
  assert.equal(isLoadingDock(feature("Dock Door", "Occupied - Loading")), true);
  assert.equal(isLoadingDock(feature("Dock Door", "Out of Service")), false);
  assert.equal(isLoadingDock(feature("Rail")), false);
  assert.equal(isLoadingDock(feature("Dock Door", "Available", "EFY.B1.L2")), false);
});

test("weekly breadcrumb geometry draws repeated segments only once", () => {
  const outbound = makePath([[0, 0], [100, 0], [100, 100]]);
  const returnPath = makePath([...outbound.points].reverse());
  const trips = Array.from({ length: 10 }, () => ({ outbound, returnPath, distance: 400 }));
  assert.deepEqual(weeklyPaths(trips), [[[0, 0], [100, 0]], [[100, 0], [100, 100]]]);
  assert.equal(trips.reduce((total, trip) => total + trip.distance, 0), 4000);
  trips.push({ outbound: makePath([[0, 0], [0, 100]]), returnPath: makePath([[0, 100], [0, 0]]) });
  assert.equal(weeklyPaths(trips).length, 3);
});

test("recent trails stop at the forklift and retain at most 200 meters", () => {
  const trip = { outbound: makePath([[0, 0], [500, 0]]), returnPath: makePath([[500, 0], [0, 0]]) };
  const paths = recentTrail([trip], 0, 300);
  assert.deepEqual(paths, [[[100, 0], [300, 0]]]);
  assert.equal(makePath(paths[0]).length, 200);
  assert.deepEqual(recentTrail([trip], 0, 0), []);
});

test("point breadcrumbs cover a rolling 30 minutes and follow route positions", () => {
  const trip = { outbound: makePath([[0, 0], [4000, 0]]), returnPath: makePath([[4000, 0], [0, 0]]) };
  const samples = rollingBreadcrumbs([trip], 0, 1900);
  assert.equal(samples.length, 61);
  assert.equal(samples[0].ageSeconds, 0);
  assert.equal(samples.at(-1).ageSeconds, 1800);
  assert.deepEqual(samples[0].point, [3800, 0]);
  assert.deepEqual(samples.at(-1).point, [200, 0]);
  assert.ok(samples.every((sample) => sample.ageSeconds >= 0 && sample.ageSeconds <= 1800));
  const later = rollingBreadcrumbs([trip], 0, 1930);
  assert.deepEqual(later.at(-1).point, [260, 0]);
  assert.deepEqual(rollingBreadcrumbs([], 0, 0), []);
});

test("rolling points cross trip boundaries without interpolating across water", () => {
  const trips = [
    { outbound: makePath([[0, 0], [100, 0], [100, 100]]), returnPath: makePath([[100, 100], [100, 0], [0, 0]]) },
    { outbound: makePath([[0, 0], [0, 100], [100, 100]]), returnPath: makePath([[100, 100], [0, 100], [0, 0]]) }
  ];
  const samples = rollingBreadcrumbs(trips, 1, 25);
  assert.deepEqual(samples[0].point, [0, 50]);
  assert.ok(samples.every(({ point: [x, y] }) => x === 0 || x === 100 || y === 0 || y === 100));
  assert.ok(samples.length <= 61);
});

const docks = [{ id: "D1", facility: "A", level: "A.L1", point: [0, 0] }];
const storage = Array.from({ length: 20 }, (_, index) => ({ id: `R${index}`, kind: "rack", facility: "A", level: "A.L1", point: [10 + index * 20, 10] }));
const route = (start, end) => ({ ...makePath([start, [start[0], end[1]], end]), schematic: false });

test("scenario progress reports completed work monotonically without changing results", () => {
  const values = [], now = new Date("2026-11-10T12:00:00Z");
  const reported = buildScenarios(storage, docks, route, now, { onProgress: (value) => values.push(value) });
  assert.deepEqual(reported, buildScenarios(storage, docks, route, now));
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 1);
  assert.ok(values.every((value, index) => value >= 0 && value <= 1 && (!index || value >= values[index - 1])));
  assert.ok(values.some((value) => value > 0 && value < 0.6));
});

test("same weekly SKU demand and four forklifts, lower optimized travel", () => {
  const scenarios = buildScenarios(storage, docks, route, new Date("2026-11-06T13:00:00Z"));
  const { current, optimized } = scenarios;
  assert.equal(current.fleet.length, 4);
  assert.equal(optimized.fleet.length, 4);
  assert.equal(new Set(current.fleet.map((forklift) => forklift.trailStyle)).size, 4);
  assert.equal(current.total.picks, optimized.total.picks);
  const demand = (scenario) => scenario.placements.map((slot) => [slot.sku, slot.weekly]).sort();
  assert.deepEqual(demand(current), demand(optimized));
  assert.ok(optimized.total.distance < current.total.distance);
  assert.equal(optimized.total.travelSeconds, optimized.fleet.reduce((total, forklift) => total + forklift.trips.reduce((sum, trip) => sum + (trip.outbound.length + trip.returnPath.length) / ASSUMPTIONS.speed, 0), 0));
  assert.equal(current.total.handlingSeconds, optimized.total.handlingSeconds);
  assert.ok(optimized.fleet.every((forklift) => forklift.picks > 0));
  assert.equal(current.total.picks, current.placements.reduce((total, slot) => total + slot.weekly, 0));
  current.fleet.forEach((forklift) => forklift.trips.forEach((trip) => {
    assert.ok(trip.timestamp >= current.week.start && trip.timestamp < current.week.end);
  }));
  const busy = optimized.placements.filter((slot) => slot.frequency === "High").sort((first, second) => first.point[0] - second.point[0]);
  assert.ok(busy.at(-1).point[0] - busy[0].point[0] >= 180);
  const remote = optimized.fleet[3];
  assert.equal(remote.role, "Deep-storage picking");
  assert.ok(remote.trips.every((trip) => trip.slot.path.length >= 310));
  assert.ok(remote.trips[0].slot.path.length >= 310);
  assert.deepEqual(buildScenarios(storage, docks, route, new Date("2026-11-06T13:00:00Z")), scenarios);
});

test("unreachable storage retains colors without changing served demand between scenarios", () => {
  const blockedPoint = storage.at(-1).point;
  const constrainedRoute = (start, end) => end === blockedPoint ? null : route(start, end);
  const { current, optimized } = buildScenarios(storage, docks, constrainedRoute);
  assert.equal(current.placements.length, storage.length);
  assert.equal(optimized.placements.length, storage.length);
  assert.equal(current.excluded, 1);
  assert.equal(current.total.picks, optimized.total.picks);
  assert.equal(optimized.total.picks, optimized.fleet.reduce((total, forklift) => total + forklift.picks, 0));
  assert.equal(current.placements.find((slot) => slot.id === storage.at(-1).id).path, null);
});

test("optimized productivity scenario includes 5% extra real simulated trips", () => {
  const { current, optimized } = buildScenarios(storage, docks, route, new Date("2026-11-06T13:00:00Z"), { optimizedUplift: 0.05 });
  assert.equal(optimized.total.picks, current.total.picks + Math.round(current.total.picks * 0.05));
  assert.equal(optimized.total.picks, optimized.fleet.reduce((total, forklift) => total + forklift.trips.length, 0));
  assert.equal(optimized.total.picks, optimized.placements.reduce((total, slot) => total + slot.weekly, 0));
  assert.equal(optimized.total.handlingSeconds, optimized.total.picks * (ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds));
  assert.equal(optimized.total.travelSeconds, optimized.fleet.reduce((total, forklift) => total + forklift.travelSeconds, 0));
  assert.ok(optimized.total.travelSeconds + optimized.total.handlingSeconds < current.total.travelSeconds + current.total.handlingSeconds);
  assert.equal(optimized.workloadUplift, 0.05);
  assert.equal(current.workloadUplift, 0);
  assert.throws(() => buildScenarios(storage, docks, route, new Date(), { optimizedUplift: -0.05 }), /uplift/);
});

test("replay travels to pallet, stops, returns loaded, and unloads", () => {
  const trip = { slot: { path: makePath([[0, 0], [100, 0]]) } };
  assert.equal(replayTrip(trip, 25).point[0], 50);
  assert.equal(replayTrip(trip, 55).status, "Picking pallet");
  assert.equal(replayTrip(trip, 110).point[0], 50);
  assert.equal(replayTrip(trip, 110).loaded, true);
  assert.equal(replayTrip(trip, 150).status, "Unloading at dock");
  assert.deepEqual(replayTrip(trip, 150).point, [0, 0]);
  assert.deepEqual(positionOnPath(makePath([[0, 0], [0, 0]]), 10).point, [0, 0]);
});

test("UTC week excludes today and invalid inputs fail visibly", () => {
  const week = lastWeek(new Date("2026-11-06T23:59:59Z"));
  assert.equal(new Date(week.start).toISOString(), "2026-10-30T00:00:00.000Z");
  assert.equal(new Date(week.end).toISOString(), "2026-11-06T00:00:00.000Z");
  assert.throws(() => buildScenarios([], docks, route), /requires storage/);
  assert.throws(() => buildScenarios(storage, [], route), /requires storage/);
  assert.throws(() => buildScenarios(storage.map((slot) => ({ ...slot, level: "A.L2" })), docks, route), /four ground-floor/);
});

test("disconnected network routing never invents a fallback shortcut", () => {
  const router = createRouter([[[0, 0], [0, 100], [100, 100]]], (graph, start, end) => {
    assert.ok(graph[start]); assert.ok(graph[end]);
    return [start, "0,200", end];
  });
  const path = router([0, 0], [100, 100]);
  assert.equal(path.schematic, false);
  assert.equal(path.length, 200);
  assert.equal(router([1000, 1000], [1100, 1100]), null);
});

test("grid blocks water, storage obstacles and walls, and rejects unsafe shortcuts", () => {
  const rectangle = (xmin, ymin, xmax, ymax) => ({ extent: { xmin, ymin, xmax, ymax } });
  const land = rectangle(0, 0, 40, 20), obstacle = rectangle(10, 0, 14, 12);
  const wall = { extent: { xmin: 20, ymin: 0, xmax: 20, ymax: 12 }, paths: [[[20, 0], [20, 12]]] };
  const router = createGridRouter({ land: [land], areas: [land], obstacles: [obstacle], walls: [wall],
    contains: (polygon, [x, y]) => x >= polygon.extent.xmin && x <= polygon.extent.xmax && y >= polygon.extent.ymin && y <= polygon.extent.ymax,
    findPath: (matrix, first, last) => [first, last]
  });
  assert.equal(router.walkable([5, 5]), true);
  assert.equal(router.walkable([5, 25]), false);
  assert.equal(router.walkable([12, 5]), false);
  assert.equal(router.walkable([20, 5]), false);
  assert.equal(router([5, 5], [30, 5]), null);
  const safe = router([5, 15], [30, 15]);
  assert.ok(safe && safe.points.every(router.walkable));
  assert.equal(router([500, 500], [5, 5]), null);
});

test("dock openings allow wall passage without overriding land or storage obstacles", () => {
  const rectangle = (xmin, ymin, xmax, ymax) => ({ extent: { xmin, ymin, xmax, ymax } });
  const land = rectangle(0, 0, 40, 20);
  const router = createGridRouter({ land: [land], facilities: [rectangle(10, 2, 30, 18)], areas: [rectangle(12, 4, 28, 16)],
    obstacles: [rectangle(20, 8, 24, 12)], walls: [{ extent: { xmin: 12, ymin: 0, xmax: 12, ymax: 20 }, paths: [[[12, 0], [12, 20]]] }],
    portals: [[12, 10], [41, 10]], contains: (polygon, [x, y]) => x >= polygon.extent.xmin && x <= polygon.extent.xmax && y >= polygon.extent.ymin && y <= polygon.extent.ymax,
    findPath: () => []
  });
  assert.equal(router.walkable([12, 10]), true);
  assert.equal(router.walkable([5, 10]), true);
  assert.equal(router.walkable([11, 3]), false);
  assert.equal(router.walkable([22, 10]), false);
  assert.equal(router.walkable([41, 10]), false);
});

test("scenario-specific corridor rules reuse safe land cells without opening obstacles", () => {
  const land = { extent: { xmin: 0, ymin: 0, xmax: 40, ymax: 20 } };
  const settings = { land: [land], areas: [land], obstacles: [], walls: [],
    contains: (polygon, [x, y]) => x >= polygon.extent.xmin && x <= polygon.extent.xmax && y >= polygon.extent.ymin && y <= polygon.extent.ymax,
    findPath: (matrix, first, last) => [first, last] };
  const optimized = createGridRouter(settings);
  const progress = [];
  const current = createGridRouter({ ...settings, preparedMatrix: optimized.matrix, blockedPaths: [[[20, 0], [20, 20]]], blockedRadius: 2, onProgress: (completed, total) => progress.push({ completed, total }) });
  assert.equal(optimized.walkable([20, 10]), true);
  assert.equal(current.walkable([20, 10]), false);
  assert.equal(current([5, 10], [35, 10]), null);
  assert.ok(optimized([5, 10], [35, 10]));
  assert.equal(optimized.walkable([45, 10]), false);
  assert.equal(current.matrix[8][16], 1);
  assert.equal(optimized.matrix[8][16], 0);
  assert.equal(progress[0].completed, 0);
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  assert.ok(progress.every((step, index) => step.completed <= step.total && (!index || step.completed >= progress[index - 1].completed)));
});

test("optimized corridor routing joins only validated legs and retains route-derived distance", () => {
  const open = (start, end) => ({ ...makePath([start, end]), schematic: false });
  const outer = (start, end) => ({ ...makePath([start, [start[0], 50], [end[0], 50], end]), schematic: false });
  const optimized = createCorridorRouter(open, outer, [[10, 0], [20, 0], [30, 0]]);
  const path = optimized([0, 0], [40, 0]);
  assert.equal(path.usesCentralCorridor, true);
  assert.equal(path.length, 40);
  assert.ok(path.length < outer([0, 0], [40, 0]).length);
  const unavailable = createCorridorRouter((start, end) => end[0] === 20 ? null : open(start, end), outer, [[10, 0], [20, 0], [30, 0]]);
  assert.equal(unavailable([0, 0], [40, 0]).usesCentralCorridor, undefined);
});

test("scenario route planners change actual trips, not just displayed metrics", () => {
  const quays = [{ id: "QW", kind: "quay", point: [0, 0] }, { id: "QE", kind: "quay", point: [500, 0] }];
  const outer = (start, end) => ({ ...makePath([start, [start[0], 100], [end[0], 100], end]), schematic: false });
  const { current, optimized } = buildScenarios(storage, quays, outer, new Date(), { optimizedRoute: route });
  assert.equal(current.total.picks, optimized.total.picks);
  assert.ok(optimized.total.distance < current.total.distance * 0.8);
  assert.ok(optimized.fleet.every((forklift) => forklift.trips.every((trip) => trip.returnPath.points.every((point) => point[1] !== 100))));
  assert.ok(current.fleet.some((forklift) => forklift.trips.some((trip) => trip.returnPath.points.some((point) => point[1] === 100))));
});

test("cargo keeps its assigned quay when optimized storage is relocated", () => {
  const quays = [{ id: "QW", kind: "quay", point: [0, 0] }, { id: "QE", kind: "quay", point: [500, 0] }];
  const { current, optimized } = buildScenarios(storage, quays, route, new Date(), { fixedQuayAssignments: true });
  const manifest = (scenario) => scenario.placements.map((slot) => [slot.sku, slot.quayId, slot.weekly]).sort();
  assert.deepEqual(manifest(current), manifest(optimized));
  for (const scenario of [current, optimized]) for (const forklift of scenario.fleet) for (const trip of forklift.trips) {
    assert.equal(trip.slot.dock.id, trip.slot.quayId);
    assert.deepEqual(trip.returnPath.points.at(-1), quays.find((quay) => quay.id === trip.slot.quayId).point);
  }
  assert.ok(optimized.total.distance < current.total.distance * 0.8);
});

test("optimized central picking cell spreads west-bound fast movers into a dedicated corridor zone", () => {
  const slots = Array.from({ length: 60 }, (_, index) => ({ id: `R${index}`, kind: "rack", facility: index >= 20 && index < 40 ? "CENTRAL" : "OTHER", level: "L1", point: [10 + index * 6, 10] }));
  const quays = [{ id: "QW", kind: "quay", point: [0, 0] }, { id: "QE", kind: "quay", point: [500, 0] }];
  const { current, optimized } = buildScenarios(slots, quays, route, new Date(), { fixedQuayAssignments: true, centralPickingFacilities: ["CENTRAL"] });
  const centralHigh = optimized.placements.filter((slot) => slot.facility === "CENTRAL" && slot.frequency === "High" && slot.quayId === "QW");
  assert.ok(centralHigh.length > 0);
  assert.equal(optimized.fleet[2].role, "Central-corridor picking");
  assert.ok(optimized.fleet[2].trips.every((trip) => trip.slot.facility === "CENTRAL"));
  assert.ok(centralHigh.every((slot) => optimized.fleet[2].trips.some((trip) => trip.slot.id === slot.id)));
  assert.ok(optimized.fleet[3].trips.every((trip) => trip.slot.facility !== "CENTRAL"));
  assert.ok(optimized.fleet[3].trips.length > 0);
  assert.equal(current.total.picks, optimized.total.picks);
});

test("successive trips and the replay loop join at docks without teleporting", () => {
  const mixed = storage.map((slot, index) => ({ ...slot, facility: index % 2 ? "B" : "A", level: index % 2 ? "B.L1" : "A.L1" }));
  const loading = [...docks, { id: "D2", facility: "B", level: "B.L1", point: [500, 0] }];
  const scenarios = buildScenarios(mixed, loading, route);
  for (const scenario of Object.values(scenarios)) {
    for (const forklift of scenario.fleet) {
      forklift.trips.forEach((trip, index) => {
        const previous = forklift.trips[(index + forklift.trips.length - 1) % forklift.trips.length];
        assert.deepEqual(trip.outbound.points[0], previous.returnPath.points.at(-1));
        assert.deepEqual(trip.outbound.points.at(-1), trip.returnPath.points[0]);
        assert.equal(trip.distance, trip.outbound.length + trip.returnPath.length + (trip.traffic?.backup || 0) * 2);
      });
    }
  }
});

test("weekly trips reuse storage routes and cache dock transfers across scenarios", () => {
  const mixed = storage.map((slot, index) => ({ ...slot, facility: index % 2 ? "B" : "A", level: index % 2 ? "B.L1" : "A.L1" }));
  const loading = [...docks, { id: "D2", facility: "B", level: "B.L1", point: [500, 0] }];
  const calls = [];
  buildScenarios(mixed, loading, (start, end) => { calls.push({ start, end }); return route(start, end); });
  assert.equal(calls.filter((call) => mixed.some((slot) => slot.point === call.end)).length, storage.length);
  assert.ok(calls.length <= storage.length + 2);
});

test("warehouse containers go directly to one of two quayside handoffs, never to warehouse doors", () => {
  const quays = [{ id: "QUAY-W", kind: "quay", point: [0, 0] }, { id: "QUAY-E", kind: "quay", point: [500, 0] }];
  const scenarios = buildScenarios(storage, quays, route);
  for (const scenario of Object.values(scenarios)) {
    assert.deepEqual(new Set(scenario.placements.filter((slot) => slot.path).map((slot) => slot.dock.id)), new Set(["QUAY-W", "QUAY-E"]));
    for (const forklift of scenario.fleet) {
      forklift.trips.forEach((trip, index) => {
        const previous = forklift.trips[(index + forklift.trips.length - 1) % forklift.trips.length];
        assert.deepEqual(trip.outbound.points[0], previous.slot.dock.point);
        assert.deepEqual(trip.outbound.points.at(-1), trip.slot.point);
        assert.deepEqual(trip.returnPath.points[0], trip.slot.point);
        assert.deepEqual(trip.returnPath.points.at(-1), trip.slot.dock.point);
        assert.equal(replayTrip(trip, Infinity).status, "Quayside handoff - awaiting crane");
      });
    }
  }
});

test("shared rack approaches create real queue stops and on-route reversing", () => {
  const outbound = makePath([[0, 0], [100, 0]]), returnPath = makePath([[100, 0], [0, 0]]);
  const fleet = ["FL-01", "FL-02"].map((id) => ({ id, distance: 200, trips: [{ slot: { point: [100, 0], facility: "A", level: "A.L1", aisle: "01" }, outbound, returnPath, distance: 200, travelSeconds: 100 }] }));
  scheduleCongestion(fleet);
  const trip = fleet[1].trips[0];
  assert.ok(trip.congestionSeconds > 0);
  assert.equal(trip.traffic.blockingForklift, "FL-01");
  const start = replayTrip(trip, trip.traffic.atSeconds), reversing = replayTrip(trip, trip.traffic.atSeconds + 1.5);
  assert.ok(reversing.point[0] < start.point[0]);
  assert.match(reversing.status, /Maneuvering/);
  const waiting = replayTrip(trip, trip.traffic.atSeconds + 4);
  assert.match(waiting.status, /Waiting for FL-01/);
  assert.equal(waiting.point[1], 0);
  assert.equal(replayTrip(trip, Infinity).duration, 160 + trip.congestionSeconds);
  assert.equal(replayTrip(trip, Infinity).traveled, 200 + trip.traffic.backup * 2);
  assert.ok(fleet[1].waitSeconds > 0);
});

test("zoned optimized picking reduces shared-aisle delays and retains four active forklifts", () => {
  const { current, optimized } = buildScenarios(storage, docks, route);
  assert.ok(current.total.conflicts > 0);
  assert.ok(optimized.total.congestionSeconds < current.total.congestionSeconds);
  assert.ok(optimized.fleet.every((forklift) => forklift.trips.length));
  assert.equal(current.total.congestionSeconds, current.fleet.reduce((total, forklift) => total + forklift.congestionSeconds, 0));
});