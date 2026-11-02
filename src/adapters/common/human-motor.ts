/**
 * Human motor simulation: cubic Bézier curves, Fitts's Law velocity dynamics,
 * randomized hitbox targeting, and developer deliberation pauses.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BezierOptions {
  readonly steps?: number;
  readonly deviation?: number;
}

/**
 * Calculates a point on a cubic Bézier curve at parameter t in [0, 1].
 */
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
  const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * S-curve smoothstep easing modeling Fitts's Law (acceleration then deceleration).
 */
function smoothstep(s: number): number {
  return s * s * (3 - 2 * s);
}

/**
 * Generates an array of points along a cubic Bézier curve from start to target.
 */
export function generateBezierPath(start: Point, target: Point, options: BezierOptions = {}): Point[] {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  const steps = options.steps ?? Math.max(12, Math.min(35, Math.floor(distance / 25)));
  const deviation = options.deviation ?? Math.min(60, Math.max(15, distance * 0.15));

  // Orthogonal vector normalized
  const nx = distance === 0 ? 0 : -dy / distance;
  const ny = distance === 0 ? 0 : dx / distance;

  // Control points with perpendicular offsets
  const sign = Math.random() > 0.5 ? 1 : -1;
  const p1: Point = {
    x: start.x + dx * 0.25 + nx * deviation * sign,
    y: start.y + dy * 0.25 + ny * deviation * sign,
  };
  const p2: Point = {
    x: start.x + dx * 0.75 + nx * deviation * (sign * 0.6),
    y: start.y + dy * 0.75 + ny * deviation * (sign * 0.6),
  };

  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const t = smoothstep(s);
    points.push(cubicBezier(start, p1, p2, target, t));
  }

  // Ensure exact start and end coordinates
  points[0] = { x: start.x, y: start.y };
  points[points.length - 1] = { x: target.x, y: target.y };

  return points;
}

/**
 * Computes randomized target coordinates strictly within the central 35%-65% of an element.
 */
export function computeTargetCoordinates(box: BoundingBox, randomFn = Math.random): Point {
  const xRatio = 0.35 + 0.3 * randomFn();
  const yRatio = 0.35 + 0.3 * randomFn();
  return {
    x: Math.round(box.left + box.width * xRatio),
    y: Math.round(box.top + box.height * yRatio),
  };
}

/**
 * Calculates per-keystroke delays with Gaussian jitter and punctuation pauses.
 */
export function calculateKeystrokeDelays(text: string, randomFn = Math.random): number[] {
  const delays: number[] = [];
  const punctuation = new Set([".", ",", "!", "?", ";", ":", "\n"]);

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    // Base delay: 35ms - 75ms
    let delay = Math.round(35 + 40 * randomFn());
    if (punctuation.has(char)) {
      // Additional hesitation on punctuation: 120ms - 260ms
      delay += Math.round(120 + 140 * randomFn());
    }
    delays.push(delay);
  }
  return delays;
}

/**
 * Returns deliberation pause (400ms - 900ms) simulating prompt review before sending.
 */
export function getDeliberationPause(randomFn = Math.random): number {
  return Math.round(400 + 500 * randomFn());
}

/**
 * Returns hand transition pause (150ms - 300ms) from mouse click to keyboard paste.
 */
export function getHandTransitionPause(randomFn = Math.random): number {
  return Math.round(150 + 150 * randomFn());
}
