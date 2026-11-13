import { makePath } from "./picking-model.js?v=20261110-loading-v15";

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point[0] - start[0] - fraction * dx, point[1] - start[1] - fraction * dy);
}

function spatialIndex(items, size = 24) {
  const buckets = new Map();
  for (const item of items) {
    const bounds = item.extent;
    for (let column = Math.floor((bounds.xmin - 1) / size); column <= Math.floor((bounds.xmax + 1) / size); column++) {
      for (let row = Math.floor((bounds.ymin - 1) / size); row <= Math.floor((bounds.ymax + 1) / size); row++) {
        const key = `${column},${row}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
    }
  }
  return (point) => buckets.get(`${Math.floor(point[0] / size)},${Math.floor(point[1] / size)}`) || [];
}

export const CENTRAL_CORRIDOR = [[88145, 433121], [88240, 433087], [88335, 433052]];

export function createGridRouter({ land, areas, obstacles, walls, facilities = [], portals = [], contains, findPath, cellSize = 1.25, preparedMatrix = null, blockedPaths = [], blockedRadius = 6, blockedOutsideFacilities = false, onProgress = () => {} }) {
  if (!land.length || !areas.length) throw new Error("Mapped land and forklift-accessible areas are required for routing.");
  const bounds = land.reduce((extent, polygon) => ({
    xmin: Math.min(extent.xmin, polygon.extent.xmin), ymin: Math.min(extent.ymin, polygon.extent.ymin),
    xmax: Math.max(extent.xmax, polygon.extent.xmax), ymax: Math.max(extent.ymax, polygon.extent.ymax)
  }), { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity });
  const columns = Math.ceil((bounds.xmax - bounds.xmin) / cellSize), rows = Math.ceil((bounds.ymax - bounds.ymin) / cellSize);
  if (columns * rows > 700000) throw new Error("Mapped yard is too large for the forklift navigation grid.");
  const areasAt = spatialIndex(areas), obstaclesAt = spatialIndex(obstacles), wallsAt = spatialIndex(walls), facilitiesAt = spatialIndex(facilities);
  const blockedAt = (point) => (!blockedOutsideFacilities || !facilitiesAt(point).some((polygon) => contains(polygon, point)))
    && blockedPaths.some((path) => path.slice(1).some((end, index) => distanceToSegment(point, path[index], end) <= blockedRadius));
  const walkable = (point) => !blockedAt(point) && land.some((polygon) => contains(polygon, point))
    && (areasAt(point).some((polygon) => contains(polygon, point)) || (facilities.length && !facilitiesAt(point).some((polygon) => contains(polygon, point))))
    && !obstaclesAt(point).some((polygon) => contains(polygon, point) || polygon.rings?.some((ring) => ring.slice(1).some((end, index) => distanceToSegment(point, ring[index], end) < 0.65)))
    && (!wallsAt(point).some((wall) => wall.paths.some((path) => path.slice(1).some((end, index) => distanceToSegment(point, path[index], end) < 1.15)))
      || portals.some((portal) => Math.hypot(point[0] - portal[0], point[1] - portal[1]) < 3.5));
  const pointFor = (column, row) => [bounds.xmin + (column + 0.5) * cellSize, bounds.ymin + (row + 0.5) * cellSize];
  if (preparedMatrix && (preparedMatrix.length !== rows || preparedMatrix.some((row) => row.length !== columns))) throw new Error("Navigation matrix does not match the yard bounds.");
  const blockedRegions = blockedPaths.map((path) => ({
    minColumn: Math.max(0, Math.floor((Math.min(...path.map((point) => point[0])) - blockedRadius - bounds.xmin) / cellSize)),
    maxColumn: Math.min(columns - 1, Math.ceil((Math.max(...path.map((point) => point[0])) + blockedRadius - bounds.xmin) / cellSize)),
    minRow: Math.max(0, Math.floor((Math.min(...path.map((point) => point[1])) - blockedRadius - bounds.ymin) / cellSize)),
    maxRow: Math.min(rows - 1, Math.ceil((Math.max(...path.map((point) => point[1])) + blockedRadius - bounds.ymin) / cellSize))
  }));
  const totalRows = rows + blockedRegions.reduce((total, region) => total + Math.max(0, region.maxRow - region.minRow + 1), 0);
  let completedRows = 0;
  const rowComplete = () => { completedRows++; if (completedRows % 16 === 0 && completedRows < totalRows) onProgress(completedRows, totalRows); };
  onProgress(0, totalRows);
  const matrix = Array.from({ length: rows }, (_, row) => {
    const result = preparedMatrix ? preparedMatrix[row].slice() : Array.from({ length: columns }, (_, column) => {
      const point = pointFor(column, row);
      return walkable(point) && [-0.5, 0.5].every((dx) => [-0.5, 0.5].every((dy) => land.some((polygon) => contains(polygon, [point[0] + dx * cellSize, point[1] + dy * cellSize])))) ? 0 : 1;
    });
    rowComplete();
    return result;
  });
  blockedRegions.forEach(({ minRow, maxRow, minColumn, maxColumn }) => {
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) if (blockedAt(pointFor(column, row))) matrix[row][column] = 1;
      rowComplete();
    }
  });
  onProgress(completedRows, totalRows);
  const snapCache = new Map(), routeCache = new Map();
  const snap = (point) => {
    const key = point.join(",");
    if (snapCache.has(key)) return snapCache.get(key);
    const centerColumn = Math.floor((point[0] - bounds.xmin) / cellSize), centerRow = Math.floor((point[1] - bounds.ymin) / cellSize);
    let selected = null, best = 8;
    const radius = Math.ceil(8 / cellSize);
    for (let row = Math.max(0, centerRow - radius); row <= Math.min(rows - 1, centerRow + radius); row++) {
      for (let column = Math.max(0, centerColumn - radius); column <= Math.min(columns - 1, centerColumn + radius); column++) {
        if (matrix[row][column]) continue;
        const coordinate = pointFor(column, row), distance = Math.hypot(point[0] - coordinate[0], point[1] - coordinate[1]);
        if (distance < best) { best = distance; selected = [column, row]; }
      }
    }
    snapCache.set(key, selected);
    return selected;
  };
  const validSegment = (start, end) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.5));
    for (let step = 0; step <= steps; step++) {
      const column = Math.floor((start[0] + (end[0] - start[0]) * step / steps - bounds.xmin) / cellSize);
      const row = Math.floor((start[1] + (end[1] - start[1]) * step / steps - bounds.ymin) / cellSize);
      if (row < 0 || row >= rows || column < 0 || column >= columns || matrix[row][column]) return false;
    }
    return true;
  };
  const calculate = (start, end) => {
    const first = snap(start), last = snap(end);
    if (!first || !last) return null;
    const cells = findPath(matrix, first, last);
    if (cells.length < 2) return null;
    const points = cells.map(([column, row]) => pointFor(column, row));
    if (points.slice(1).some((point, index) => !validSegment(points[index], point))) return null;
    const simplified = [points[0]];
    for (let index = 0; index < points.length - 1;) {
      let next = Math.min(points.length - 1, index + 30);
      while (next > index + 1 && !validSegment(points[index], points[next])) next--;
      simplified.push(points[next]);
      index = next;
    }
    return { ...makePath(simplified), schematic: false };
  };
  const route = (start, end) => {
    const key = `${start.join(",")}:${end.join(",")}`;
    if (!routeCache.has(key)) routeCache.set(key, calculate(start, end));
    return routeCache.get(key);
  };
  route.walkable = walkable;
  route.matrix = matrix;
  route.pointFor = pointFor;
  return route;
}

export function createCorridorRouter(openRoute, outerRoute, corridor = CENTRAL_CORRIDOR) {
  const nearest = (point) => corridor.reduce((best, candidate, index) => Math.hypot(point[0] - candidate[0], point[1] - candidate[1])
    < Math.hypot(point[0] - corridor[best][0], point[1] - corridor[best][1]) ? index : best, 0);
  const cache = new Map();
  return (start, end) => {
    const key = `${start.join(",")}:${end.join(",")}`;
    if (cache.has(key)) return cache.get(key);
    const first = nearest(start), last = nearest(end);
    let result = null;
    if (first !== last) {
      const step = first < last ? 1 : -1;
      const waypoints = [start];
      for (let index = first; index !== last + step; index += step) waypoints.push(corridor[index]);
      waypoints.push(end);
      const legs = waypoints.slice(1).map((point, index) => openRoute(waypoints[index], point));
      if (legs.every(Boolean)) {
        const path = makePath(legs.flatMap((leg, index) => index ? leg.points.slice(1) : leg.points));
        const outer = outerRoute(start, end);
        if (outer && path.length <= outer.length * 1.05) result = { ...path, schematic: false, usesCentralCorridor: true };
      }
    }
    if (!result) result = openRoute(start, end);
    cache.set(key, result);
    return result;
  };
}