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
class Queue {
  entries: { key: number; score: number }[] = [];
  push(key: number, score: number) {
    const entry = { key, score };
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent].score <= score) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }
  pop() {
    const first = this.entries[0],
      last = this.entries.pop();
    if (!this.entries.length || !last) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.entries.length &&
        this.entries[child + 1].score < this.entries[child].score
      )
        child++;
      if (this.entries[child].score >= last.score) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
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
export function routeCanvas(nodes: Rect[], edges: Edge[], width: number, height: number) {
  const nodeById = new Map<number, Rect>();
  for (const node of nodes) if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  const physicalKey = (id: number) => {
    const n = nodeById.get(id);
    return n ? `${n.x}:${n.y}:${n.width}:${n.height}` : undefined;
  };
  const occupiedLines = new Map<string, { min: number; max: number }[]>();
  const overlap = (a: Point, b: Point) => {
    const horizontal = a.y === b.y,
      key = horizontal ? `h:${a.y}` : `v:${a.x}`,
      min = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      max = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    return (occupiedLines.get(key) ?? []).reduce(
      (n, r) => n + Math.max(0, Math.min(max, r.max) - Math.max(min, r.min)),
      0
    );
  };
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
    const outgoing = edges.filter((e) => physicalKey(e.source) === physicalKey(a.id)),
      incoming = edges.filter((e) => physicalKey(e.target) === physicalKey(b.id)),
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
  return edges.flatMap((edge, index) => {
    const port = ports[index];
    if (!port) return [];
    const { a, b, from, to, start, end } = port;
    const findRoute = (margin: number) => {
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
        for (let y = 0; y < rows; y++) {
          if (ys[y] < n.y || ys[y] > n.bottom) continue;
          for (let x = 0; x < cols; x++)
            if (xs[x] >= n.x && xs[x] <= n.right) blocked[cell(x, y)] = 1;
        }
      // Prefer breathing room along parallel runs, without penalizing crossings or short port fans.
      const horizontalCrowding = new Float64Array(cols * rows),
        verticalCrowding = new Float64Array(cols * rows);
      const lowerBound = (values: number[], value: number) => {
        let low = 0,
          high = values.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (values[middle] < value) low = middle + 1;
          else high = middle;
        }
        return low;
      };
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
      const costs = new Float64Array(cols * rows * 3).fill(Infinity),
        previous = new Int32Array(costs.length).fill(-1),
        queue = new Queue(),
        initial = encode(sx, sy, 2);
      costs[initial] = 0;
      queue.push(initial, 0);
      let final = -1;
      while (queue.entries.length) {
        const current = queue.pop();
        if (!current) break;
        const at = Math.floor(current.key / 3),
          x = at % cols,
          y = Math.floor(at / cols),
          dir = current.key % 3;
        if (
          current.score >
          costs[current.key] + Math.abs(xs[x] - end.x) + Math.abs(ys[y] - end.y) + 1e-6
        )
          continue;
        if (x === ex && y === ey) {
          final = current.key;
          break;
        }
        for (const [dx, dy, d] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 1],
          [0, -1, 1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || blocked[cell(nx, ny)]) continue;
          const p = { x: xs[x], y: ys[y] },
            q = { x: xs[nx], y: ys[ny] };
          if (overlap(p, q) > 1e-6) continue;
          const next = encode(nx, ny, d),
            cost =
              costs[current.key] +
              Math.abs(p.x - q.x) +
              Math.abs(p.y - q.y) +
              (d !== dir ? 5 : 0) +
              (d === 0
                ? horizontalCrowding[cell(Math.min(x, nx), y)]
                : verticalCrowding[cell(x, Math.min(y, ny))]);
          if (cost >= costs[next]) continue;
          costs[next] = cost;
          previous[next] = current.key;
          queue.push(next, cost + Math.abs(q.x - end.x) + Math.abs(q.y - end.y));
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
    const grid = findRoute(256) ?? findRoute(768) ?? findRoute(Math.max(width, height));
    const points = grid ? tidy([from, ...grid, to]) : [from, to];
    for (let i = 1; i < points.length; i++) remember(points[i - 1], points[i]);
    return [
      {
        ...edge,
        key: `${edge.source}-${edge.target}`,
        label: index < 26 ? String.fromCharCode(65 + index) : String(index + 1),
        color: colors[index % colors.length],
        points,
        d: rounded(points),
        failed: !grid,
      },
    ];
  });
}
