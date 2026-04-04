/**
 * Verifier.js: Simulation and verification logic for the G-code Arc-Linear Optimizer.
 * Ensures that the optimized toolpath does not deviate more than the allowed tolerance from the original.
 */
class Verifier {
  constructor(tolerance = 0.001) {
    this.tolerance = tolerance;
    this.gougeDetected = false;
    this.maxDeviation = 0;
  }

  /**
   * Calculates the chordal distance between a point and an arc (radial deviation).
   * @param {Object} p - Point {x, y}
   * @param {Object} circle - Circle {center: {x, y}, radius}
   * @returns {number} - Distance
   */
  static getDistanceToArc(p, circle) {
    const distFromCenter = Math.sqrt(Math.pow(p.x - circle.center.x, 2) + Math.pow(p.y - circle.center.y, 2));
    return Math.abs(distFromCenter - circle.radius);
  }

  /**
   * Compares the original toolpath points against the fitted arc segment.
   * Uses chordal distance: points on the arc segment use radial distance; points off the segment use distance to nearest endpoint.
   * @param {Array} originalPoints - Array of {x, y} points from the original toolpath (includes start as first)
   * @param {Object} circle - Fitted circle {center, radius}
   * @param {Object} start - Arc start point {x, y}
   * @param {Object} end - Arc end point {x, y}
   * @returns {Object} - {isSafe: boolean, maxDeviation: number}
   */
  verify(originalPoints, circle, start, end) {
    let result = {
      isSafe: true,
      maxDeviation: 0
    };
    const { center: { x: cx, y: cy }, radius } = circle;

    // Determine arc direction using first intermediate point (consistent with ArcFitter.determineArcDirection)
    let isCCW = false; // default to G2 clockwise
    if (originalPoints.length > 2) {
        // Find first intermediate point (skip start duplicates)
        let mid = null;
        for (let i = 1; i < originalPoints.length; i++) {
            const p = originalPoints[i];
            if (p.x !== start.x || p.y !== start.y) {
                mid = p;
                break;
            }
        }
        if (mid) {
            const ax = end.x - start.x;
            const ay = end.y - start.y;
            const bx = mid.x - start.x;
            const by = mid.y - start.y;
            const cross = ax * by - ay * bx;
            // Using (end-start) x (mid-start): cross < 0 indicates CCW (G3), cross > 0 indicates CW (G2)
            isCCW = cross < 0;
        }
    }

    // Compute start and end angles
    const startA = Math.atan2(start.y - cy, start.x - cx);
    const endA = Math.atan2(end.y - cy, end.x - cx);
    const TWOPI = 2 * Math.PI;

    // Compute sweep angle (positive)
    let sweep;
    if (isCCW) {
      sweep = (endA - startA) % TWOPI;
      if (sweep < 0) sweep += TWOPI;
    } else {
      sweep = (startA - endA) % TWOPI;
      if (sweep < 0) sweep += TWOPI;
    }

    for (const p of originalPoints) {
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const radialDev = Math.abs(dist - radius);
      const pA = Math.atan2(dy, dx);

      // Check if point lies on arc segment
      let onArc;
      let offset = null;
      if (isCCW) {
        offset = (pA - startA) % TWOPI;
        if (offset < 0) offset += TWOPI;
        onArc = offset <= sweep + 1e-9;
      } else {
        offset = (startA - pA) % TWOPI;
        if (offset < 0) offset += TWOPI;
        onArc = offset <= sweep + 1e-9;
      }

      let dev;
      if (onArc) {
        dev = radialDev;
      } else {
        // Distance to nearest endpoint
        const dStart = Math.hypot(p.x - start.x, p.y - start.y);
        const dEnd = Math.hypot(p.x - end.x, p.y - end.y);
        dev = Math.min(dStart, dEnd);
      }

      if (dev > result.maxDeviation) result.maxDeviation = dev;
      if (dev > this.tolerance) result.isSafe = false;
    }

    if (result.maxDeviation > this.maxDeviation) this.maxDeviation = result.maxDeviation;
    return result;
  }

  getSummary() {
    return {
      maxError: this.maxDeviation.toFixed(6),
      isSafe: this.maxDeviation <= this.tolerance
    };
  }
}

module.exports = Verifier;
