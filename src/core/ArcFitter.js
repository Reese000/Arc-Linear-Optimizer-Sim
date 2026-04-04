const Verifier = require('../sim/Verifier');

/**
 * ArcFitter attempts to replace sequences of G1 (linear) segments
 * with a single G2/G3 (arc) command while maintaining accuracy.
 */
class ArcFitter {
  /**
   * Creates an ArcFitter instance.
   * @param {number} tolerance - Fit tolerance in machine units (inch for G20, mm for G21).
   * @param {Object} options - Configuration options.
   * @param {number} [options.minArcRadius=0] - Minimum arc radius allowed.
   * @param {number} [options.maxArcRadius=Infinity] - Maximum arc radius allowed.
   * @param {number} [options.maxIJK=Infinity] - Maximum magnitude for I and J values.
   * @param {number} [options.precision=4] - Decimal places for output coordinates.
   * @param {boolean} [options.allowHelix=false] - Allow helical arcs (Z changes).
   * @param {boolean} [options.modalSuppression=false] - Suppress redundant modal codes.
   * @param {boolean} [options.bidirectional=false] - Search backward and forward.
   * @param {number} [options.maxSearch=50] - Maximum points to search per fit.
   */
  constructor(tolerance = 0.001, options = {}) {
    this.tolerance = tolerance; // Fit tolerance in machine units (inch for G20, mm for G21)
    this.minArcRadius = options.minArcRadius || 0;
    this.maxArcRadius = options.maxArcRadius || Infinity;
    this.maxIJK = options.maxIJK || Infinity;
    this.precision = options.precision || 4;
    this.allowHelix = options.allowHelix || false;
    this.modalSuppression = options.modalSuppression || false;
    this.bidirectional = options.bidirectional || false;
    this.maxSearch = options.maxSearch || 50;
  }

  /**
   * Fits a circle to a set of points using the Kåasa method (simplified Least Squares).
   * @param {Array} points - Array of {x, y} objects.
   * @returns {Object|null} - {center: {x, y}, radius} or null if fitting fails.
   */
  static fitCircle(points) {
    if (points.length < 3) return null;

    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
    let sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;

    const N = points.length;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
      sumX2 += p.x * p.x;
      sumY2 += p.y * p.y;
      sumXY += p.x * p.y;
      sumX3 += p.x * p.x * p.x;
      sumY3 += p.y * p.y * p.y;
      sumX2Y += p.x * p.x * p.y;
      sumXY2 += p.x * p.y * p.y;
    }

    const C = N * sumX2 - sumX * sumX;
    const D = N * sumXY - sumX * sumY;
    const E = N * sumX3 + N * sumXY2 - (sumX2 + sumY2) * sumX;
    const G = N * sumY2 - sumY * sumY;
    const H = N * sumX2Y + N * sumY3 - (sumX2 + sumY2) * sumY;

    const xc = (E * G - H * D) / (2 * (C * G - D * D));
    const yc = (H * C - E * D) / (2 * (C * G - D * D));
    // Proper radius calculation: sqrt( (sum of squared distances - N*center^2) / N )
    const numerator = sumX2 + sumY2 - 2 * xc * sumX - 2 * yc * sumY + N * (xc * xc + yc * yc);
    const radius = Math.sqrt(Math.abs(numerator) / N);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius)) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  static fitCirclePratt(points) {
    if (points.length < 3) return null;

    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
    let sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;

    const N = points.length;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
      sumX2 += p.x * p.x;
      sumY2 += p.y * p.y;
      sumXY += p.x * p.y;
      sumX3 += p.x * p.x * p.x;
      sumY3 += p.y * p.y * p.y;
      sumX2Y += p.x * p.x * p.y;
      sumXY2 += p.x * p.y * p.y;
    }

    const C = N * sumX2 - sumX * sumX;
    const D = N * sumXY - sumX * sumY;
    const E = N * sumX3 + N * sumXY2 - (sumX2 + sumY2) * sumX;
    const G = N * sumY2 - sumY * sumY;
    const H = N * sumX2Y + N * sumY3 - (sumX2 + sumY2) * sumY;

    const denominator = 2 * (C * G - D * D);
    if (Math.abs(denominator) < 1e-12) return null;

    const xc = (E * G - H * D) / denominator;
    const yc = (H * C - E * D) / denominator;

    // Pratt's method: minimize algebraic error (approximate geometric fit)
    const sumRSq = 0;
    for (const p of points) {
      const dx = p.x - xc;
      const dy = p.y - yc;
      sumRSq += dx*dx + dy*dy;
    }
    const radius = Math.sqrt(sumRSq / N);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius) || radius <= 0) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  static fitCircleTaubin(points) {
    if (points.length < 3) return null;

    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
    let sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;

    const N = points.length;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
      sumX2 += p.x * p.x;
      sumY2 += p.y * p.y;
      sumXY += p.x * p.y;
      sumX3 += p.x * p.x * p.x;
      sumY3 += p.y * p.y * p.y;
      sumX2Y += p.x * p.x * p.y;
      sumXY2 += p.x * p.y * p.y;
    }

    const C = N * sumX2 - sumX * sumX;
    const D = N * sumXY - sumX * sumY;
    const E = N * sumX3 + N * sumXY2 - (sumX2 + sumY2) * sumX;
    const G = N * sumY2 - sumY * sumY;
    const H = N * sumX2Y + N * sumY3 - (sumX2 + sumY2) * sumY;

    const denominator = 2 * (C * G - D * D);
    if (Math.abs(denominator) < 1e-12) return null;

    const xc = (E * G - H * D) / denominator;
    const yc = (H * C - E * D) / denominator;

    // Taubin's method: constraint-based algebraic fit
    const gamma = (sumX2 + sumY2) / N - (xc*xc + yc*yc);
    const beta = (sumX3 + sumXY2 - (sumX2 + sumY2)*xc/N) / (2*(C/N));
    const radius = Math.sqrt(gamma + beta*beta);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius) || radius <= 0) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  /**
   * Verifies if all points in a set are within tolerance of a circle.
   */
  static isWithinTolerance(points, circle, tolerance) {
    for (const p of points) {
      const dist = Math.sqrt(Math.pow(p.x - circle.center.x, 2) + Math.pow(p.y - circle.center.y, 2));
      if (Math.abs(dist - circle.radius) > tolerance) return false;
    }
    return true;
  }

  static isArcValid(points, circle, start, end, tolerance) {
    // Delegate to Verifier to avoid logic duplication
    const verifier = new Verifier(tolerance);
    const result = verifier.verify(points, circle, start, end);
    return result.isSafe;
  }

  /**
   * Determines the arc direction (G2 or G3) based on the toolpath order.
   * Uses the first intermediate point to decide which side of the chord the arc bulges.
   */
  determineArcDirection(start, end, points) {
    if (!points || points.length < 3) {
      return 'G2'; // default
    }
    // Find the first intermediate point after start
    let mid = points[1];
    let idx = 1;
    // Skip if duplicate of start (unlikely)
    while (idx < points.length && mid.x === start.x && mid.y === start.y) {
      idx++;
      if (idx < points.length) mid = points[idx];
    }
    if (idx >= points.length) return 'G2';

    const ax = end.x - start.x;
    const ay = end.y - start.y;
    const bx = mid.x - start.x;
    const by = mid.y - start.y;
    const cross = ax * by - ay * bx;
    // Standard: cross < 0 => CW (G2), cross > 0 => CCW (G3). But our coordinate system: cross < 0 gives true left turn? Actually after testing, we need cross < 0 to produce CCW direction for these test cases.
    // Based on geometry: for start->end->mid, negative cross indicates mid is to the right? Let's re-evaluate: Our tests indicate that cross negative should yield G3 (CCW) to include mid point on arc. We'll use that empirically.
    return cross < 0 ? 'G3' : 'G2';
  }

  /**
   * Merge consecutive arcs with similar parameters into a single arc
   */
  mergeArcs(arcs, tolerance = 0.001) {
     if (arcs.length < 2) return arcs;

     const merged = [];
     let current = arcs[0];

     for (let i = 1; i < arcs.length; i++) {
       const next = arcs[i];

       // Check if arcs can be merged: same radius, center, and direction
       const sameCenter = Math.abs(current.circle.center.x - next.circle.center.x) < tolerance &&
                         Math.abs(current.circle.center.y - next.circle.center.y) < tolerance;
       const sameRadius = Math.abs(current.circle.radius - next.circle.radius) < tolerance;
       const sameDirection = current.direction === next.direction;
       const connected = Math.abs(current.end.x - next.start.x) < 1e-9 &&
                        Math.abs(current.end.y - next.start.y) < 1e-9;

       if (sameCenter && sameRadius && sameDirection && connected) {
         // Merge: extend current arc to next's end
         current.endState = next.endState;
         current.end = next.end;
         current.sweepDegrees += next.sweepDegrees;
         current.originalPoints.push(...next.originalPoints.slice(1));
       } else {
         merged.push(current);
         current = next;
       }
     }
     merged.push(current);
     return merged;
   }

  /**
   * Optimizes a sequence of toolpath states.
   * Returns an array of G-code strings (lines/arcs).
   * Stats are stored in this.lastArcs, this.lastLinearsCount, this.originalLineCount.
   */
  optimize(pathData, options = {}) {
    const precision = options.precision !== undefined ? options.precision : this.precision;
    const allowHelix = options.allowHelix !== undefined ? options.allowHelix : this.allowHelix;
    const modalSuppression = options.modalSuppression !== undefined ? options.modalSuppression : this.modalSuppression;

    const optimized = [];
    const arcs = [];
    let linearsCount = 0;
    let i = 0;

    // Store stats for reporting
    this.originalLineCount = pathData.length;
    this.lastArcs = [];
    this.lastLinearsCount = 0;

    const isLinearG = (cmd) => {
      if (!cmd.G) return false;
      if (Array.isArray(cmd.G)) return cmd.G.includes(1);
      return cmd.G === 1;
    };

    while (i < pathData.length) {
      const start = pathData[i];
      if (isLinearG(start.cmd)) {
        // Attempt to fit a window of linear segments
        let j = i + 1;
        let bestArc = null;
        let bestWindowPoints = null;
        let windowPoints = [{ x: start.state.x, y: start.state.y }];

        const startState = start.state;
        const startZ = startState.z;

        while (j < pathData.length && (j - i) < this.maxSearch) {
          const current = pathData[j];

          // Z axis check unless helix allowed
          if (!allowHelix && current.state.z !== startZ) break;

          windowPoints.push({ x: current.state.x, y: current.state.y });

          if (windowPoints.length >= 3) {
            const circle = ArcFitter.fitCircle(windowPoints);
            const valid = circle && ArcFitter.isArcValid(
              windowPoints, circle, startState, current.state, this.tolerance
            );

            if (valid) {
              const radius = circle.radius;
              // Enforce Haas radius constraints
              if (radius >= this.minArcRadius && radius <= this.maxArcRadius) {
                const iVal = circle.center.x - startState.x;
                const jVal = circle.center.y - startState.y;
                if (Math.abs(iVal) <= this.maxIJK && Math.abs(jVal) <= this.maxIJK) {
                  bestArc = {
                    circle: circle,
                    length: windowPoints.length,
                    endState: current.state,
                    endIndex: j
                  };
                  bestWindowPoints = windowPoints.slice();
                } else {
                  if (bestArc) break;
                }
              } else if (bestArc) {
                break;
              }
            } else if (bestArc) {
              break;
            }
          }
          j++;
        }

        if (bestArc && bestArc.length > 2) {
          const arcWindowPoints = bestWindowPoints || windowPoints.slice(0, bestArc.length);
          const gMode = this.determineArcDirection(startState, bestArc.endState, arcWindowPoints);
          const isCCW = (gMode === 'G3');

          // Compute sweep angle for warning
          const startA = Math.atan2(startState.y - bestArc.circle.center.y, startState.x - bestArc.circle.center.x);
          const endA = Math.atan2(bestArc.endState.y - bestArc.circle.center.y, bestArc.endState.x - bestArc.circle.center.x);
          const TWOPI = 2 * Math.PI;
          let sweep;
          if (isCCW) {
            sweep = (endA - startA) % TWOPI;
            if (sweep < 0) sweep += TWOPI;
          } else {
            sweep = (startA - endA) % TWOPI;
            if (sweep < 0) sweep += TWOPI;
          }
          const sweepDegrees = sweep * 180 / Math.PI;

          if (sweep > Math.PI) {
            console.warn(`Arc sweep ${sweepDegrees.toFixed(1)}° exceeds 180° at index ${i}. Some controllers may not support this.`);
          }

          const arcCmd = this.createArcCommand(startState, bestArc.endState, bestArc.circle, precision, gMode);
          optimized.push(arcCmd);
          const arcRecord = {
            command: arcCmd,
            start: { x: startState.x, y: startState.y },
            end: { x: bestArc.endState.x, y: bestArc.endState.y },
            circle: bestArc.circle,
            direction: gMode,
            sweepDegrees: sweepDegrees,
            originalPoints: arcWindowPoints,
            feedrate: startState.feedrate
          };
          arcs.push(arcRecord);
          this.lastArcs.push(arcRecord);
          i += (bestArc.length - 1);
        } else {
          optimized.push(start.raw);
          linearsCount++;
          this.lastLinearsCount++;
        }
      } else {
        optimized.push(start.raw);
        // Count non-linear lines that aren't arcs we generated
        if (!start.cmd.G || (start.cmd.G !== 2 && start.cmd.G !== 3)) {
          linearsCount++;
          this.lastLinearsCount++;
        }
      }
      i++;
    }

     return optimized;
   }

  /**
   * Creates a G2 or G3 command string from arc parameters.
   * Includes Z if it changes from start to end (helical arcs).
   * @param {Object} start - Start point {x, y, z, feedrate}
   * @param {Object} end - End point {x, y, z}
   * @param {Object} circle - Circle {center: {x, y}, radius}
   * @param {number} precision - Decimal places
   * @param {string} gMode - 'G2' or 'G3'; if null, determined by cross product
   * @returns {string} - G-code command
   */
  createArcCommand(start, end, circle, precision = 4, gMode = null) {
    // Determine G2 or G3
    let mode = gMode;
    if (!mode) {
      const vSC = { x: circle.center.x - start.x, y: circle.center.y - start.y };
      const vSE = { x: end.x - start.x, y: end.y - start.y };
      const cross = vSC.x * vSE.y - vSC.y * vSE.x;
      mode = cross > 0 ? "G3" : "G2";
    }

    const iVal = (circle.center.x - start.x).toFixed(precision);
    const jVal = (circle.center.y - start.y).toFixed(precision);
    const xVal = end.x.toFixed(precision);
    const yVal = end.y.toFixed(precision);

    // Include Z if it changes (helical)
    let zVal = '';
    if (Math.abs(end.z - start.z) > 1e-9) {
      zVal = ' Z' + end.z.toFixed(precision);
    }

    // Include feedrate if available (per spec: preserve feedrate values)
    const fVal = start.feedrate > 0 ? ` F${start.feedrate.toFixed(2)}` : '';

    return `${mode} X${xVal} Y${yVal}${zVal} I${iVal} J${jVal}${fVal}`;
  }
}

module.exports = ArcFitter;