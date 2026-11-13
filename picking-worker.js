import { buildScenarios } from "./picking-model.js?v=20261110-loading-v15";
import { createGridRouter, createCorridorRouter, CENTRAL_CORRIDOR } from "./picking-routing.js?v=20261110-loading-v15";

self.onmessage = async ({ data }) => {
  try {
    let lastProgress = "";
    const report = (phase, fraction) => {
      const key = `${phase}:${Math.floor(fraction * 100)}`;
      if (key !== lastProgress) { lastProgress = key; self.postMessage({ progress: { phase, completed: fraction, total: 1 } }); }
    };
    const [polygonModule, pointModule, containsOperator, engine] = await Promise.all([
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/Polygon.js"),
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/Point.js"),
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/operators/containsOperator.js"),
      import("https://esm.sh/pathfinding@0.4.18")
    ]);
    const Polygon = polygonModule.default, Point = pointModule.default;
    const polygonFrom = ({ extent, ...geometry }) => new Polygon(geometry);
    const PathFinding = engine.default || engine;
    const point = new Point({ spatialReference: { wkid: 28992 } });
    report("navigation", 0);
    const navigation = {
      ...data.navigation,
      land: data.navigation.land.map(polygonFrom),
      areas: data.navigation.areas.map(polygonFrom),
      facilities: data.navigation.facilities.map(polygonFrom),
      obstacles: data.navigation.obstacles.map(polygonFrom),
      contains(polygon, coordinate) { point.x = coordinate[0]; point.y = coordinate[1]; return containsOperator.execute(polygon, point); }
    };
    const makePlanner = (options = {}) => {
      const finder = new PathFinding.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
      let grid;
      const touched = new Set();
      return createGridRouter({ ...navigation, ...options,
      findPath(matrix, start, end) {
        if (!grid) {
          grid = new PathFinding.Grid(matrix);
          const getNodeAt = grid.getNodeAt.bind(grid), getNeighbors = grid.getNeighbors.bind(grid);
          grid.getNodeAt = (...args) => { const node = getNodeAt(...args); touched.add(node); return node; };
          grid.getNeighbors = (...args) => { const nodes = getNeighbors(...args); nodes.forEach((node) => touched.add(node)); return nodes; };
        }
        try { return finder.findPath(...start, ...end, grid); }
        finally {
          touched.forEach((node) => { node.g = 0; node.h = undefined; node.f = 0; node.opened = false; node.closed = false; node.parent = null; });
          touched.clear();
        }
      } });
    };
    const openRoute = makePlanner({ onProgress: (completed, total) => report("navigation", 0.5 * completed / total) });
    const currentRoute = makePlanner({ preparedMatrix: openRoute.matrix, blockedPaths: [CENTRAL_CORRIDOR], blockedRadius: 18, blockedOutsideFacilities: true,
      onProgress: (completed, total) => report("navigation", 0.5 + 0.5 * completed / total) });
    const optimizedRoute = createCorridorRouter(openRoute, currentRoute);
    const scenarios = buildScenarios(data.storage, data.loading, currentRoute, new Date(), { optimizedUplift: 0.05, optimizedRoute, fixedQuayAssignments: true, centralPickingFacilities: ["EFY.B5"], onProgress: (fraction) => report("planning", fraction) });
    scenarios.current.routePolicy = "Shared outer-road dispatch";
    scenarios.optimized.routePolicy = "Central corridor + zoned dispatch";
    self.postMessage({ scenarios });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};