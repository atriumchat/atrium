/**
 * Geometry for the line drawings (Illustrations.tsx), in the landing's technique: 2:1 isometric, so a step along
 * the ground's x axis moves the pen (1, ½) on screen, a step along y moves it (−1, ½), and z goes straight up.
 * A circle on the ground is then an upright ellipse r·√2 wide and r/√2 tall, which makes every arc on the ground
 * a plain SVG arc. Everything is computed rather than drawn by hand, so angles and ellipses come out exact.
 */

/** A point on the ground plane, and one in space. */
export type Ground = readonly [number, number];
export type Point = readonly [number, number, number];

/**
 * One path of a drawing. `plate` fills it with the surface colour, so it hides whatever is behind it; `ink` fills
 * it with the line colour instead of stroking; `even` cuts its inner rings out as holes.
 */
export type Mark = { d: string; plate?: boolean; ink?: boolean; even?: boolean; o?: number; dash?: string; w?: number; cls?: string };

/** A finished drawing: its paths, back to front, and the box they fit in. */
export type Drawing = { marks: Mark[]; box: [number, number, number, number] };

type Style = Omit<Mark, 'd'>;

const R2 = Math.SQRT2;
const RAD = Math.PI / 180;
const num = (v: number) => String(Math.round(v * 10) / 10 || 0);

/** Builds a drawing back to front: whatever is added later covers what is behind it. */
export class Sketch {
  readonly marks: Mark[] = [];
  private bounds = [Infinity, Infinity, -Infinity, -Infinity];
  /** Applied to everything added inside `float` (the subtle up-and-down of the landing's drawings). */
  private cls?: string;

  /** Where a point in space lands on screen. */
  at(x: number, y: number, z = 0): [number, number] {
    const p: [number, number] = [x - y, (x + y) / 2 - z];
    const b = this.bounds;
    b[0] = Math.min(b[0], p[0]);
    b[1] = Math.min(b[1], p[1]);
    b[2] = Math.max(b[2], p[0]);
    b[3] = Math.max(b[3], p[1]);
    return p;
  }

  private xy(x: number, y: number, z: number) {
    const [sx, sy] = this.at(x, y, z);
    return `${num(sx)} ${num(sy)}`;
  }

  private add(d: string, style: Style = {}) {
    this.marks.push({ d, ...(this.cls ? { cls: this.cls } : {}), ...style });
  }

  /** Everything drawn in `draw` floats together. */
  float(draw: () => void) {
    this.cls = 'art-float';
    draw();
    this.cls = undefined;
  }

  /** A straight line through points in space; `closed` joins the last to the first. */
  line(points: Point[], style?: Style, closed = false) {
    this.add(points.map(([x, y, z], i) => `${i ? 'L' : 'M'}${this.xy(x, y, z)}`).join('') + (closed ? 'Z' : ''), style);
  }

  /** A flat polygon in space, filled with the surface colour unless the style says otherwise. */
  face(points: Point[], style?: Style) {
    this.line(points, { plate: true, ...style }, true);
  }

  /** A circle on the ground plane at height z. */
  circle(cx: number, cy: number, z: number, r: number, style?: Style) {
    this.add(this.ellipse(cx, cy, z, r), style);
  }

  /** Part of a circle on the ground, from one angle to another (degrees, from +x towards +y). */
  arc(cx: number, cy: number, z: number, r: number, from: number, to: number, style?: Style) {
    const a = this.xy(cx + r * Math.cos(from * RAD), cy + r * Math.sin(from * RAD), z);
    const b = this.xy(cx + r * Math.cos(to * RAD), cy + r * Math.sin(to * RAD), z);
    this.add(`M${a}A${num(r * R2)} ${num(r / R2)} 0 ${to - from > 180 ? 1 : 0} 1 ${b}`, style);
  }

  private ellipse(cx: number, cy: number, z: number, r: number) {
    const [sx, sy] = this.at(cx, cy, z);
    const rx = r * R2;
    this.at(cx - r / R2, cy + r / R2, z);
    this.at(cx + r / R2, cy - r / R2, z);
    this.at(cx - r / R2, cy - r / R2, z);
    this.at(cx + r / R2, cy + r / R2, z);
    const arc = `A${num(rx)} ${num(r / R2)} 0 1 1`;
    return `M${num(sx - rx)} ${num(sy)}${arc} ${num(sx + rx)} ${num(sy)}${arc} ${num(sx - rx)} ${num(sy)}Z`;
  }

  /**
   * A block with rounded corners lying on the ground: [x, x+w] × [y, y+d], from z up by h, corner radius r.
   * r = 0 is a plain box, r = w/2 = d/2 a cylinder. Drawn as the landing draws its boxes: the outline of the
   * sides, then the top over it.
   */
  slab(x: number, y: number, z: number, w: number, d: number, h: number, r = 0, top?: Style) {
    // The four corner centres, by quarter of the circle: front, left, back, right.
    const cx = [x + w - r, x + r, x + r, x + w - r];
    const cy = [y + d - r, y + d - r, y + r, y + r];
    const pt = (q: number, deg: number, zz: number) => this.xy(cx[q] + r * Math.cos(deg * RAD), cy[q] + r * Math.sin(deg * RAD), zz);
    const corner = `A${num(r * R2)} ${num(r / R2)} 0 0 1 `;
    // Along the outline from one angle to another, turning the way the angles grow (clockwise on screen).
    const trace = (from: number, to: number, zz: number) => {
      let path = '';
      for (let t = from; t < to - 1e-6; ) {
        const quarter = Math.floor(t / 90 + 1e-6);
        const edge = (quarter + 1) * 90;
        const end = Math.min(edge, to);
        if (r > 0) path += corner + pt(quarter % 4, end, zz);
        if (end === edge && end < to - 1e-6) path += `L${pt((quarter + 1) % 4, edge, zz)}`;
        t = end;
      }
      return path;
    };
    // Highest and lowest points of the outline, for the box the drawing fits in.
    this.at(cx[2] - r / R2, cy[2] - r / R2, z + h);
    this.at(cx[0] + r / R2, cy[0] + r / R2, z);
    if (h > 0) {
      // The sides seen from the front: the top's back half, down the right, the bottom's front half, up the left.
      this.add(`M${pt(1, 135, z + h)}${trace(135, 315, z + h)}L${pt(3, 315, z)}${trace(315, 495, z)}Z`, { plate: true, ...(top?.cls ? { cls: top.cls } : {}) });
      if (r === 0) this.line([[x + w, y + d, z], [x + w, y + d, z + h]], top?.cls ? { cls: top.cls } : undefined);
    }
    this.add(`M${pt(0, 0, z + h)}${trace(0, 360, z + h)}Z`, { plate: true, ...top });
  }

  /** An upright cylinder standing on the ground at (cx, cy). */
  cylinder(cx: number, cy: number, z: number, r: number, h: number, top?: Style) {
    this.slab(cx - r, cy - r, z, 2 * r, 2 * r, h, r, top);
  }

  /**
   * A cylinder with a hole straight through (a ring, a lens rim). What shows through the hole is the overlap of
   * its top and bottom openings; the inner wall's lower edge is the arc that bounds it.
   */
  tube(cx: number, cy: number, z: number, r: number, inner: number, h: number) {
    const [sx, sy] = this.at(cx, cy, z + h);
    const a = inner * R2;
    const b = inner / R2;
    const half = h / 2;
    const x0 = a * Math.sqrt(Math.max(0, 1 - (half / b) ** 2));
    const see = `M${num(sx - x0)} ${num(sy + half)}A${num(a)} ${num(b)} 0 0 1 ${num(sx + x0)} ${num(sy + half)}A${num(a)} ${num(b)} 0 0 1 ${num(sx - x0)} ${num(sy + half)}Z`;
    const before = this.marks.length;
    this.cylinder(cx, cy, z, r, h);
    // Cut the see-through part out of the sides, and the opening out of the top.
    const [sides, top] = this.marks.slice(before);
    sides.d += see;
    sides.even = true;
    top.d += this.ellipse(cx, cy, z + h, inner);
    top.even = true;
  }

  /**
   * A flat shape with straight edges (holes allowed) raised by h: the walls that face the viewer, back to
   * front, then the top. `rings` are closed outlines on the ground; the first is the outside.
   */
  prism(rings: Ground[][], z: number, h: number, style?: Style) {
    const inside = (px: number, py: number) => {
      let odd = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
        }
      }
      return odd;
    };
    const walls: { depth: number; points: Point[] }[] = [];
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        let nx = q[1] - p[1];
        let ny = p[0] - q[0];
        const len = Math.hypot(nx, ny);
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        if (inside(mx + (nx / len) * 0.01, my + (ny / len) * 0.01)) [nx, ny] = [-nx, -ny];
        // Seen from the front only when its outside faces the viewer, towards +x and +y.
        if (nx + ny > 1e-6) walls.push({ depth: mx + my, points: [[p[0], p[1], z], [q[0], q[1], z], [q[0], q[1], z + h], [p[0], p[1], z + h]] });
      });
    }
    const keep = style?.cls ? { cls: style.cls } : {};
    for (const wall of walls.sort((a, b) => a.depth - b.depth)) this.face(wall.points, keep);
    this.add(rings.map((ring) => ring.map(([px, py], i) => `${i ? 'L' : 'M'}${this.xy(px, py, z + h)}`).join('') + 'Z').join(''), { plate: true, even: true, ...style });
  }

  /** The drawing, with room around it for the line width and the float. */
  done(pad = 3): Drawing {
    const [x0, y0, x1, y1] = this.bounds;
    return { marks: this.marks, box: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad] };
  }
}

/** A drawing built once, when the module loads. */
export function sketch(draw: (s: Sketch) => void): Drawing {
  const s = new Sketch();
  draw(s);
  return s.done();
}
