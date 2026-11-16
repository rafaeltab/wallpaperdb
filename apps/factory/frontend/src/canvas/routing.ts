// Prototype router: shortest independent paths. Crossings are allowed; cards are obstacles.
export type Rect = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stacked?: boolean;
  header?: boolean;
  bottomPort?: { x: number; width: number };
};
export type Point = { x: number; y: number };
export type Edge = { source: number; target: number };
export type CanvasRoute = Edge & {
  key: string;
  label: string;
  color: string;
  points: Point[];
  d: string;
  failed: boolean;
};
const colors = [
  '#78cbb7',
  '#aab7eb',
  '#d8b17c',
  '#d694b4',
  '#87b8de',
  '#b9c78d',
  '#c9a18c',
  '#a99bd0',
  '#82bab8',
  '#c9a0cc',
  '#c0b293',
];
function lowerBound(values: number[], value: number) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
class Queue {
  length = 0;
  score = 0;
  private keys: Int32Array | Float64Array;
  private scores = new Float64Array(1024);
  constructor(maximumKey: number) {
    this.keys = maximumKey <= 2_147_483_647 ? new Int32Array(1024) : new Float64Array(1024);
  }
  push(key: number, score: number) {
    if (this.length === this.keys.length) {
      const keys =
          this.keys instanceof Int32Array
            ? new Int32Array(this.length * 2)
            : new Float64Array(this.length * 2),
        scores = new Float64Array(this.length * 2);
      keys.set(this.keys);
      scores.set(this.scores);
      this.keys = keys;
      this.scores = scores;
    }
    let index = this.length++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.scores[parent] <= score) break;
      this.keys[index] = this.keys[parent];
      this.scores[index] = this.scores[parent];
      index = parent;
    }
    this.keys[index] = key;
    this.scores[index] = score;
  }
  pop() {
    if (!this.length) return undefined;
    const first = this.keys[0];
    this.score = this.scores[0];
    const last = --this.length,
      key = this.keys[last],
      score = this.scores[last];
    if (!this.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.length && this.scores[child + 1] < this.scores[child]) child++;
      if (this.scores[child] >= score) break;
      this.keys[index] = this.keys[child];
      this.scores[index] = this.scores[child];
      index = child;
    }
    this.keys[index] = key;
    this.scores[index] = score;
    return first;
  }
}

function tidy(input: Point[]) {
  const points = input.filter((p, i) => !i || p.x !== input[i - 1].x || p.y !== input[i - 1].y);
  return points.filter(
    (p, i) =>
      !points[i - 1] ||
      !points[i + 1] ||
      !(
        (points[i - 1].x === p.x && points[i + 1].x === p.x) ||
        (points[i - 1].y === p.y && points[i + 1].y === p.y)
      )
  );
}
function rounded(points: Point[]) {
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      ab = Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
      bc = Math.abs(c.x - b.x) + Math.abs(c.y - b.y),
      r = Math.min(6, ab / 2, bc / 2);
    const p = { x: b.x + ((a.x - b.x) * r) / ab, y: b.y + ((a.y - b.y) * r) / ab },
      q = { x: b.x + ((c.x - b.x) * r) / bc, y: b.y + ((c.y - b.y) * r) / bc };
    d += ` L${p.x},${p.y} Q${b.x},${b.y} ${q.x},${q.y}`;
  }
  const last = points[points.length - 1];
  return d + ` L${last.x},${last.y}`;
}
/** A session retains only the preceding completed scene's validated search footprints. */
export function createCanvasRouter() {
  type Cached = { signatures: string[]; link: CanvasRoute };
  let previous = new Map<string, Cached>();
  return function* (
    nodes: Rect[],
    edges: Edge[],
    width: number,
    height: number
  ): Generator<CanvasRoute> {
    const nodeById = new Map<number, Rect>();
    for (const node of nodes) if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    const physicalKeys = new Map(
      [...nodeById].map(([id, node]) => [id, `${node.x}:${node.y}:${node.width}:${node.height}`])
    );
    const outgoingByPosition = new Map<string, Edge[]>(),
      incomingByPosition = new Map<string, Edge[]>();
    for (const edge of edges) {
      for (const [id, positions] of [
        [edge.source, outgoingByPosition],
        [edge.target, incomingByPosition],
      ] as const) {
        const key = physicalKeys.get(id);
        if (key === undefined) continue;
        const group = positions.get(key);
        if (group) group.push(edge);
        else positions.set(key, [edge]);
      }
    }
    const occupiedLines = new Map<string, { min: number; max: number }[]>();
    const remember = (a: Point, b: Point) => {
      const h = a.y === b.y,
        key = h ? `h:${a.y}` : `v:${a.x}`,
        ranges = occupiedLines.get(key) ?? [];
      ranges.push({
        min: Math.min(h ? a.x : a.y, h ? b.x : b.y),
        max: Math.max(h ? a.x : a.y, h ? b.x : b.y),
      });
      occupiedLines.set(key, ranges);
    };
    const ports = edges.map((edge) => {
      const a = nodeById.get(edge.source),
        b = nodeById.get(edge.target);
      if (!a || !b) return undefined;
      // A collapsed header can represent both a parent and its hidden children.
      const outgoing = outgoingByPosition.get(physicalKeys.get(a.id) ?? '') ?? [],
        incoming = incomingByPosition.get(physicalKeys.get(b.id) ?? '') ?? [],
        left = !a.stacked && b.x + b.width / 2 <= a.x + a.width / 2;
      const from = {
        x: left ? a.x : a.x + a.width,
        y: a.y + (a.height * (outgoing.indexOf(edge) + 1)) / (outgoing.length + 1),
      };
      const right = a.x + a.width / 2 > b.x + b.width / 2;
      const to = b.header
        ? {
            x: right ? b.x + b.width : b.x,
            y: b.y + (b.height * (incoming.indexOf(edge) + 1)) / (incoming.length + 1),
          }
        : {
            x:
              (b.bottomPort?.x ?? b.x) +
              ((b.bottomPort?.width ?? b.width) * (incoming.indexOf(edge) + 1)) /
                (incoming.length + 1),
            y: b.y + b.height,
          };
      const start = { x: from.x + (left ? -20 : 20), y: from.y },
        end = b.header ? { x: to.x + (right ? 20 : -20), y: to.y } : { x: to.x, y: to.y + 20 };
      return { a, b, from, to, start, end };
    });
    // Reserve every terminal before routing, so later ports cannot land on an earlier run.
    for (const port of ports)
      if (port) {
        remember(port.from, port.start);
        remember(port.end, port.to);
      }
    const nextCache = new Map<string, Cached>();
    for (const [index, edge] of edges.entries()) {
      const port = ports[index];
      if (!port) continue;
      const { a, b, from, to, start, end } = port;
      const prepareSearch = (margin: number) => {
        const ox = Math.max(0, Math.min(a.x, b.x) - margin),
          oy = Math.max(0, Math.min(a.y, b.y) - margin),
          rx = Math.min(width + 64, Math.max(a.x + a.width, b.x + b.width) + margin),
          by = Math.min(height + 64, Math.max(a.y + a.height, b.y + b.height) + margin);
        const obstacles = nodes
          .filter(
            (n) =>
              n.x + n.width + 16 >= ox &&
              n.x - 16 <= rx &&
              n.y + n.height + 16 >= oy &&
              n.y - 16 <= by
          )
          .map((n) => ({
            x: n.x - 12,
            y: n.y - 12,
            right: n.x + n.width + 12,
            bottom: n.y + n.height + 12,
          }));
        // Leave turning room at other routes' entry/exit points, including future routes.
        for (const [otherIndex, other] of ports.entries()) {
          if (otherIndex === index || !other) continue;
          for (const p of [other.start, other.end]) {
            if (
              p.x < ox ||
              p.x > rx ||
              p.y < oy ||
              p.y > by ||
              Math.hypot(p.x - start.x, p.y - start.y) < 3 ||
              Math.hypot(p.x - end.x, p.y - end.y) < 3
            )
              continue;
            obstacles.push({ x: p.x - 2, y: p.y - 2, right: p.x + 2, bottom: p.y + 2 });
          }
        }
        return { ox, oy, rx, by, obstacles };
      };
      const signature = ({ ox, oy, rx, by, obstacles }: ReturnType<typeof prepareSearch>) => {
        // Ports can lie outside a clipped search window. Include their axes too,
        // because the grid always contains the start and end coordinates.
        const minX = Math.min(ox, rx, start.x, end.x),
          maxX = Math.max(ox, rx, start.x, end.x),
          minY = Math.min(oy, by, start.y, end.y),
          maxY = Math.max(oy, by, start.y, end.y);
        const occupied = [...occupiedLines].flatMap(([key, ranges]) => {
          const horizontal = key.startsWith('h:'),
            axis = Number(key.slice(2)),
            low = horizontal ? minY : minX,
            high = horizontal ? maxY : maxX,
            alongLow = horizontal ? minX : minY,
            alongHigh = horizontal ? maxX : maxY;
          if (axis < low - 14 || axis > high + 14) return [];
          const relevant = ranges.filter(
            (range) => range.max >= alongLow && range.min <= alongHigh
          );
          if (!relevant.length) return [];
          // A distant long run on this same axis changes the parallel lanes.
          return [[key, relevant, ranges.some((range) => range.max - range.min >= 48)]];
        });
        return JSON.stringify([from, to, start, end, ox, oy, rx, by, obstacles, occupied]);
      };
      const margins = [256, 768, Math.max(width, height)];
      const cacheKey = `${index}:${edge.source}-${edge.target}`;
      const cached = previous.get(cacheKey);
      if (
        cached?.signatures.every(
          (value, attempt) => value === signature(prepareSearch(margins[attempt]))
        )
      ) {
        nextCache.set(cacheKey, cached);
        for (let i = 1; i < cached.link.points.length; i++)
          remember(cached.link.points[i - 1], cached.link.points[i]);
        yield cached.link;
        continue;
      }
      const signatures: string[] = [];
      const findRoute = (margin: number) => {
        const prepared = prepareSearch(margin),
          { ox, oy, rx, by, obstacles } = prepared;
        signatures.push(signature(prepared));
        // Compress empty distances into one step. Cost still uses real pixels, so long detours remain expensive.
        const xx = new Set([ox, rx, start.x, end.x]),
          yy = new Set([oy, by, start.y, end.y]);
        for (const n of obstacles) {
          for (const x of [n.x - 4, n.x, n.right, n.right + 4]) if (x >= ox && x <= rx) xx.add(x);
          for (const y of [n.y - 4, n.y, n.bottom, n.bottom + 4]) if (y >= oy && y <= by) yy.add(y);
        }
        // Give each used axis nearby parallel lanes. Perpendicular crossings remain available.
        for (const [key, ranges] of occupiedLines) {
          const horizontal = key.startsWith('h:'),
            axis = Number(key.slice(2));
          const low = horizontal ? oy : ox,
            high = horizontal ? by : rx;
          if (
            axis < low - 8 ||
            axis > high + 8 ||
            !ranges.some((r) => r.max >= (horizontal ? ox : oy) && r.min <= (horizontal ? rx : by))
          )
            continue;
          const longRun = ranges.some((r) => r.max - r.min >= 48);
          for (const lane of longRun
            ? [axis - 14, axis - 8, axis + 8, axis + 14]
            : [axis - 8, axis + 8])
            if (lane >= low && lane <= high) (horizontal ? yy : xx).add(lane);
        }
        // Compact gaps need a middle lane when their outer lanes are already occupied.
        for (const axes of [xx, yy]) {
          const values = [...axes].sort((a, b) => a - b);
          for (let i = 1; i < values.length; i++) {
            const gap = values[i] - values[i - 1];
            if (gap >= 8 && gap <= 160) axes.add((values[i] + values[i - 1]) / 2);
          }
        }
        const xs = [...xx].sort((a, b) => a - b),
          ys = [...yy].sort((a, b) => a - b),
          cols = xs.length,
          rows = ys.length,
          cell = (x: number, y: number) => y * cols + x;
        const blocked = new Uint8Array(cols * rows);
        for (const n of obstacles)
          for (let y = lowerBound(ys, n.y); y < rows && ys[y] <= n.bottom; y++) {
            const first = lowerBound(xs, n.x),
              last = lowerBound(xs, n.right);
            // The original obstacle test includes both boundaries.
            const until = last < cols && xs[last] === n.right ? last + 1 : last;
            blocked.fill(1, cell(first, y), cell(until, y));
          }
        // Prefer breathing room along parallel runs, without penalizing crossings or short port fans.
        const horizontalCrowding = new Float64Array(cols * rows),
          verticalCrowding = new Float64Array(cols * rows);
        for (const [key, ranges] of occupiedLines) {
          const horizontal = key.startsWith('h:'),
            axis = Number(key.slice(2));
          const across = horizontal ? ys : xs,
            along = horizontal ? xs : ys,
            crowding = horizontal ? horizontalCrowding : verticalCrowding;
          for (
            let i = lowerBound(across, axis - 14);
            i < across.length && across[i] < axis + 14;
            i++
          ) {
            const distance = Math.abs(across[i] - axis);
            if (distance < 1e-6) continue;
            const strength = 3 * (1 - distance / 14) ** 2;
            for (const range of ranges) {
              const length = range.max - range.min;
              if (length < 48) continue;
              // A capped cost encourages using nearby space before considering a long detour.
              const weight = (strength * Math.min(80, length)) / length;
              for (
                let j = Math.max(0, lowerBound(along, range.min) - 1);
                j < along.length - 1 && along[j] < range.max;
                j++
              ) {
                const shared = Math.max(
                  0,
                  Math.min(along[j + 1], range.max) - Math.max(along[j], range.min)
                );
                crowding[horizontal ? cell(j, i) : cell(i, j)] += shared * weight;
              }
            }
          }
        }
        const sx = xs.indexOf(start.x),
          sy = ys.indexOf(start.y),
          ex = xs.indexOf(end.x),
          ey = ys.indexOf(end.y),
          encode = (x: number, y: number, d: number) => cell(x, y) * 3 + d;
        // Occupied runs stay fixed throughout this search. Only segments on an
        // occupied axis can overlap. Sum ranges in their original order before
        // applying the same tolerance as the point-wise overlap calculation.
        const horizontalOverlap = new Uint8Array(cols * rows),
          verticalOverlap = new Uint8Array(cols * rows),
          segmentOverlap = new Float64Array(Math.max(cols, rows));
        for (const [key, ranges] of occupiedLines) {
          const horizontal = key.startsWith('h:'),
            axis = Number(key.slice(2)),
            across = horizontal ? ys : xs,
            along = horizontal ? xs : ys,
            i = lowerBound(across, axis);
          if (across[i] !== axis) continue;
          segmentOverlap.fill(0, 0, along.length - 1);
          for (const range of ranges)
            for (
              let j = Math.max(0, lowerBound(along, range.min) - 1);
              j < along.length - 1 && along[j] < range.max;
              j++
            )
              segmentOverlap[j] += Math.max(
                0,
                Math.min(along[j + 1], range.max) - Math.max(along[j], range.min)
              );
          const overlap = horizontal ? horizontalOverlap : verticalOverlap;
          for (let j = 0; j < along.length - 1; j++)
            if (segmentOverlap[j] > 1e-6) overlap[horizontal ? cell(j, i) : cell(i, j)] = 1;
        }
        const costs = new Float64Array(cols * rows * 3).fill(Infinity),
          previous = new Int32Array(costs.length).fill(-1),
          queue = new Queue(costs.length - 1),
          initial = encode(sx, sy, 2);
        costs[initial] = 0;
        queue.push(initial, 0);
        let final = -1;
        while (queue.length) {
          const current = queue.pop();
          if (current === undefined) break;
          const at = Math.floor(current / 3),
            x = at % cols,
            y = Math.floor(at / cols),
            dir = current % 3,
            baseCost = costs[current];
          if (queue.score > baseCost + Math.abs(xs[x] - end.x) + Math.abs(ys[y] - end.y) + 1e-6)
            continue;
          if (x === ex && y === ey) {
            final = current;
            break;
          }
          // Keep the established +x, -x, +y, -y order without tuple iterators.
          for (let move = 0; move < 4; move++) {
            const horizontal = move < 2,
              forward = move % 2 === 0,
              step = forward ? 1 : -1,
              nx = horizontal ? x + step : x,
              ny = horizontal ? y : y + step,
              nextCell = at + (horizontal ? step : step * cols),
              d = horizontal ? 0 : 1;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || blocked[nextCell]) continue;
            const next = nextCell * 3 + d;
            // Every step adds nonnegative distance, turn and crowding costs.
            if (baseCost >= costs[next]) continue;
            const px = xs[x],
              py = ys[y],
              qx = xs[nx],
              qy = ys[ny];
            const overlapCache = horizontal ? horizontalOverlap : verticalOverlap,
              segment = forward ? at : nextCell;
            if (overlapCache[segment]) continue;
            const cost =
              baseCost +
              Math.abs(px - qx) +
              Math.abs(py - qy) +
              (d !== dir ? 5 : 0) +
              (horizontal ? horizontalCrowding[segment] : verticalCrowding[segment]);
            if (cost >= costs[next]) continue;
            costs[next] = cost;
            previous[next] = current;
            queue.push(next, cost + Math.abs(qx - end.x) + Math.abs(qy - end.y));
          }
        }
        const grid: Point[] = [];
        for (let at = final; at !== -1; at = previous[at]) {
          const p = Math.floor(at / 3);
          grid.push({ x: xs[p % cols], y: ys[Math.floor(p / cols)] });
        }
        grid.reverse();
        return final < 0 ? undefined : grid;
      };
      const grid = findRoute(margins[0]) ?? findRoute(margins[1]) ?? findRoute(margins[2]);
      const points = grid ? tidy([from, ...grid, to]) : [from, to];
      for (let i = 1; i < points.length; i++) remember(points[i - 1], points[i]);
      const link = {
        ...edge,
        key: `${edge.source}-${edge.target}`,
        label: index < 26 ? String.fromCharCode(65 + index) : String(index + 1),
        color: colors[index % colors.length],
        points,
        d: rounded(points),
        failed: !grid,
      };
      nextCache.set(cacheKey, { signatures, link });
      yield link;
    }
    previous = nextCache;
  };
}

export function routeCanvas(nodes: Rect[], edges: Edge[], width: number, height: number) {
  return [...createCanvasRouter()(nodes, edges, width, height)];
}
