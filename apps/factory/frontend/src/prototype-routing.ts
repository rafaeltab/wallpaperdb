// Throwaway canvas router: orthogonal paths around cards with exclusive lanes per connection.
export type RouteNode = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stacked?: boolean;
};
export type Connection = { source: number; target: number };
export type Point = { x: number; y: number };
export type RoutedConnection = Connection & {
  points: Point[];
  d: string;
  key: string;
  color: string;
  label: string;
};
type Rect = { x: number; y: number; width: number; height: number };
const step = 8;
const palette = [
  '#74d8c0',
  '#a6b8ff',
  '#ebbc7c',
  '#e29ac4',
  '#89c3f2',
  '#bfcf87',
  '#dca78b',
  '#bb9edb',
  '#91c1bb',
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
function simplify(points: Point[]) {
  const unique = points.filter(
    (p, index) => !index || p.x !== points[index - 1].x || p.y !== points[index - 1].y
  );
  return unique.filter((p, index) => {
    const a = unique[index - 1],
      b = unique[index + 1];
    return !a || !b || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}
function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest])
  );
}
export function routeSelection(
  nodes: RouteNode[],
  connections: Connection[],
  obstacles: Rect[],
  width: number,
  height: number
) {
  if (!connections.length) return { routes: [], failed: false };
  const cols = Math.ceil((width + 80) / step),
    rows = Math.ceil((height + 80) / step);
  const cell = (x: number, y: number) => y * cols + x;
  const blocked = new Uint8Array(cols * rows);
  for (const rect of [
    ...nodes.map((n) => ({ x: n.x - 6, y: n.y - 6, width: n.width + 12, height: n.height + 12 })),
    ...obstacles,
  ]) {
    for (
      let y = Math.max(0, Math.ceil(rect.y / step));
      y <= Math.min(rows - 1, Math.floor((rect.y + rect.height) / step));
      y++
    )
      for (
        let x = Math.max(0, Math.ceil(rect.x / step));
        x <= Math.min(cols - 1, Math.floor((rect.x + rect.width) / step));
        x++
      )
        blocked[cell(x, y)] = 1;
  }
  const ordered = [...connections].sort((a, b) => a.source - b.source || a.target - b.target);
  const specs = ordered.flatMap((edge, index) => {
    const a = nodes.find((n) => n.id === edge.source),
      b = nodes.find((n) => n.id === edge.target);
    if (!a || !b) return [];
    const outgoing = ordered.filter((e) => e.source === a.id),
      incoming = ordered.filter((e) => e.target === b.id);
    const left = !a.stacked && b.x + b.width / 2 <= a.x + a.width / 2;
    const from = {
      x: left ? a.x : a.x + a.width,
      y:
        a.y +
        (a.height * (outgoing.findIndex((e) => e.target === b.id) + 1)) / (outgoing.length + 1),
    };
    const to = {
      x:
        b.x +
        (b.width * (incoming.findIndex((e) => e.source === a.id) + 1)) / (incoming.length + 1),
      y: b.y + b.height,
    };
    return [
      {
        ...edge,
        from,
        to,
        start: {
          x: Math.round((from.x + (left ? -12 : a.stacked ? 24 : 12)) / step),
          y: Math.round(from.y / step),
        },
        end: { x: Math.round(to.x / step), y: Math.round((to.y + 16) / step) },
        color: palette[index % palette.length],
        label: String.fromCharCode(65 + index),
        mask: 1 << index,
      },
    ];
  });
  // Keep all other endpoints reachable before allocating any complete route.
  const mouths = new Uint32Array(cols * rows);
  for (const edge of specs) {
    for (const point of [edge.start, edge.end]) {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = point.x + dx,
            y = point.y + dy;
          if (x >= 0 && x < cols && y >= 0 && y < rows) mouths[cell(x, y)] |= edge.mask;
        }
    }
  }
  // Retry route orders when one lane leaves too little clearance for another.
  const orders =
    specs.length <= 4
      ? permutations(specs)
      : [
          ...specs.map((_, index) => [...specs.slice(index), ...specs.slice(0, index)]),
          ...specs.map((_, index) => [...specs.slice(index), ...specs.slice(0, index)].reverse()),
        ];
  for (const attempt of orders) {
    const occupied = blocked.slice();
    const routes: RoutedConnection[] = [];
    for (const edge of attempt) {
      const { start, end } = edge;
      const costs = new Float64Array(cols * rows * 3).fill(Infinity);
      const previous = new Int32Array(costs.length).fill(-1);
      const encode = (x: number, y: number, dir: number) => cell(x, y) * 3 + dir;
      const initial = encode(start.x, start.y, 2);
      const queue = new Queue();
      costs[initial] = 0;
      queue.push(initial, 0);
      let final = -1;
      if (occupied[cell(start.x, start.y)] || occupied[cell(end.x, end.y)]) break;
      while (queue.entries.length) {
        const current = queue.pop();
        if (!current) break;
        const at = Math.floor(current.key / 3),
          x = at % cols,
          y = Math.floor(at / cols),
          direction = current.key % 3;
        if (current.score > costs[current.key] + Math.abs(x - end.x) + Math.abs(y - end.y))
          continue;
        if (x === end.x && y === end.y) {
          final = current.key;
          break;
        }
        for (const [dx, dy, dir] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 1],
          [0, -1, 1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (
            nx < 0 ||
            nx >= cols ||
            ny < 0 ||
            ny >= rows ||
            occupied[cell(nx, ny)] ||
            mouths[cell(nx, ny)] & ~edge.mask
          )
            continue;
          const next = encode(nx, ny, dir),
            cost = costs[current.key] + 1 + (dir !== direction ? 0.35 : 0);
          if (cost >= costs[next]) continue;
          costs[next] = cost;
          previous[next] = current.key;
          queue.push(next, cost + Math.abs(nx - end.x) + Math.abs(ny - end.y));
        }
      }
      if (final < 0) break;
      const grid: Point[] = [];
      for (let at = final; at !== -1; at = previous[at]) {
        const index = Math.floor(at / 3);
        grid.push({ x: (index % cols) * step, y: Math.floor(index / cols) * step });
      }
      grid.reverse();
      const points = simplify([
        edge.from,
        { x: grid[0].x, y: edge.from.y },
        ...grid,
        { x: edge.to.x, y: grid[grid.length - 1].y },
        edge.to,
      ]);
      // Reserve the complete route, including endpoint stubs, with an 8px margin on both sides.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          count = Math.ceil((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / step);
        for (let at = 0; at <= count; at++) {
          const t = count ? at / count : 0,
            x = Math.round((a.x + (b.x - a.x) * t) / step),
            y = Math.round((a.y + (b.y - a.y) * t) / step);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows)
                occupied[cell(x + dx, y + dy)] = 1;
        }
      }
      routes.push({
        ...edge,
        key: `${edge.source}-${edge.target}`,
        points,
        d: points.map((p, index) => `${index ? 'L' : 'M'}${p.x},${p.y}`).join(' '),
      });
    }
    if (routes.length === specs.length)
      return { routes: routes.sort((a, b) => a.label.localeCompare(b.label)), failed: false };
  }
  return { routes: [], failed: true };
}
