import { buildScenarios } from "./picking-model.js?v=20261110-quayside-v10";
import { createGridRouter } from "./picking-routing.js?v=20261110-quayside-v10";

self.onmessage = async ({ data }) => {
  try {
    const [polygonModule, pointModule, containsOperator, engine] = await Promise.all([
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/Polygon.js"),
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/Point.js"),
      import("https://js.arcgis.com/5.1/@arcgis/core/geometry/operators/containsOperator.js"),
      import("https://esm.sh/pathfinding@0.4.18")
    ]);
    const Polygon = polygonModule.default, Point = pointModule.default;
    const polygonFrom = ({ extent, ...geometry }) => new Polygon(geometry);
    const PathFinding = engine.default || engine;
    const finder = new PathFinding.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
    const point = new Point({ spatialReference: { wkid: 28992 } });
    let grid;
    const touched = new Set();
    self.postMessage({ progress: "Building land and aisle navigation..." });
    const route = createGridRouter({
      ...data.navigation,
      land: data.navigation.land.map(polygonFrom),
      areas: data.navigation.areas.map(polygonFrom),
      facilities: data.navigation.facilities.map(polygonFrom),
      obstacles: data.navigation.obstacles.map(polygonFrom),
      contains(polygon, coordinate) { point.x = coordinate[0]; point.y = coordinate[1]; return containsOperator.execute(polygon, point); },
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
      }
    });
    self.postMessage({ progress: "Calculating current and optimized trips..." });
    self.postMessage({ scenarios: buildScenarios(data.storage, data.loading, route, new Date(), { optimizedUplift: 0.05 }) });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
};