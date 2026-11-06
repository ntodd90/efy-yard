import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarios, createRouter, lastWeek, replayTrip, makePath, positionOnPath, weeklyPaths, recentTrail, rollingBreadcrumbs, ASSUMPTIONS } from "./picking-model.js";
import { isLoadingDock, FORKLIFT_SIZE, REPLAY_SPEEDS } from "./picking.js";

test("replay speeds include the 400x race option", () => {
  assert.deepEqual(REPLAY_SPEEDS, [1, 6, 20, 400]);
});

test("forklift symbols are half their previous 34-unit size", () => {
  assert.equal(FORKLIFT_SIZE, 34 * 0.5);
});
import { createGridRouter } from "./picking-routing.js";

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
  assert.equal(optimized.total.travelSeconds, optimized.total.distance / ASSUMPTIONS.speed);
  assert.equal(current.total.handlingSeconds, optimized.total.handlingSeconds);
  assert.deepEqual(current.fleet.map((forklift) => forklift.picks), optimized.fleet.map((forklift) => forklift.picks));
  assert.equal(current.total.picks, current.placements.reduce((total, slot) => total + slot.weekly, 0));
  current.fleet.forEach((forklift) => forklift.trips.forEach((trip) => {
    assert.ok(trip.timestamp >= current.week.start && trip.timestamp < current.week.end);
  }));
  const sorted = [...optimized.placements].sort((first, second) => first.path.length - second.path.length);
  sorted.forEach((slot, index) => { if (index) assert.ok(slot.daily <= sorted[index - 1].daily); });
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
  assert.deepEqual(current.fleet.map((forklift) => forklift.picks), optimized.fleet.map((forklift) => forklift.picks));
  assert.equal(current.placements.find((slot) => slot.id === storage.at(-1).id).path, null);
});

test("optimized productivity scenario includes 5% extra real simulated trips", () => {
  const { current, optimized } = buildScenarios(storage, docks, route, new Date("2026-11-06T13:00:00Z"), { optimizedUplift: 0.05 });
  assert.equal(optimized.total.picks, current.total.picks + Math.round(current.total.picks * 0.05));
  assert.equal(optimized.total.picks, optimized.fleet.reduce((total, forklift) => total + forklift.trips.length, 0));
  assert.equal(optimized.total.picks, optimized.placements.reduce((total, slot) => total + slot.weekly, 0));
  assert.equal(optimized.total.handlingSeconds, optimized.total.picks * (ASSUMPTIONS.pickSeconds + ASSUMPTIONS.unloadSeconds));
  assert.equal(optimized.total.travelSeconds, optimized.total.distance / ASSUMPTIONS.speed);
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
        assert.equal(trip.distance, trip.outbound.length + trip.returnPath.length);
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