/**
 * Geometry utilities for arc fitting and validation.
 */
class GeometryUtils {
  /**
   * Computes the maximum chordal deviation of a set of points from an arc.
   * @param {Array} points - Array of {x, y}
   * @param {Object} circle - {center: {x, y}, radius}
   * @param {Object} start - Start point {x, y}
   * @param {Object} end - End point {x, y}
   * @param {boolean} isCCW - Arc direction
   * @returns {Object} - {maxDeviation, worstPoint}
   */
  static computeChordalDeviation(points, circle, start, end, isCCW) {
    const { x: cx, y: cy, radius } = circle;
    const TWOPI = 2 * Math.PI;

    // Compute start and end angles
    const startA = Math.atan2(start.y - cy, start.x - cx);
    const endA = Math.atan2(end.y - cy, end.x - cx);

    // Compute sweep angle based on direction
    let sweep;
    if (isCCW) {
      sweep = (endA - startA) % TWOPI;
      if (sweep < 0) sweep += TWOPI;
    } else {
      sweep = (startA - endA) % TWOPI;
      if (sweep < 0) sweep += TWOPI;
    }

    let maxDev = 0;
    let worstPoint = null;

    for (const p of points) {
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const radialDev = Math.abs(dist - radius);
      const pA = Math.atan2(dy, dx);

      // Check if point lies on arc segment
      let onArc;
      if (isCCW) {
        let offset = (pA - startA) % TWOPI;
        if (offset < 0) offset += TWOPI;
        onArc = offset <= sweep + 1e-9;
      } else {
        let offset = (startA - pA) % TWOPI;
        if (offset < 0) offset += TWOPI;
        onArc = offset <= sweep + 1e-9;
      }

      const dev = onArc ? radialDev : Math.min(
        Math.hypot(p.x - start.x, p.y - start.y),
        Math.hypot(p.x - end.x, p.y - end.y)
      );

      if (dev > maxDev) {
        maxDev = dev;
        worstPoint = p;
      }
    }

    return { maxDeviation: maxDev, worstPoint };
  }

  /**
   * Calculates the theoretical maximum chordal error for an arc with given radius and angular step.
   * @param {number} radius - Arc radius
   * @param {number} angleStep - Angular step in radians
   * @returns {number} - Maximum chordal deviation
   */
  static chordalError(radius, angleStep) {
    if (radius === 0) return 0;
    // Chordal error: d = r * (1 - cos(θ/2))
    return radius * (1 - Math.cos(angleStep / 2));
  }

  /**
   * Solves for the maximum angular step that keeps chordal error within tolerance.
   * @param {number} radius - Arc radius
   * @param {number} tolerance - Maximum allowed deviation
   * @returns {number} - Maximum step angle in radians
   */
  static maxStepAngleForTolerance(radius, tolerance) {
    if (radius <= 0) return Math.PI; // arbitrary
    // Inverse of chordal error formula: θ = 2 * arccos(1 - d/r)
    const ratio = Math.min(1, 1 - tolerance / radius);
    return 2 * Math.acos(ratio);
  }

  /**
   * Simpler approximation for small angles: θ_max ≈ 2 * sqrt(2*d/r)
   * @param {number} radius
   * @param {number} tolerance
   * @returns {number}
   */
  static approxMaxStepAngle(radius, tolerance) {
    if (radius <= 0) return Math.PI;
    return 2 * Math.sqrt(2 * tolerance / radius);
  }

  /**
   * Computes arc length given radius and sweep angle.
   * @param {number} radius
   * @param {number} sweepRadians
   * @returns {number}
   */
  static arcLength(radius, sweepRadians) {
    return radius * sweepRadians;
  }

  /**
   * Computes chord length between start and end points.
   * @param {Object} start
   * @param {Object} end
   * @returns {number}
   */
  static chordLength(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y);
  }

  /**
   * Estimates the number of segments needed for adaptive tessellation.
   * @param {number} radius
   * @param {number} sweepRadians
   * @param {number} tolerance
   * @returns {number}
   */
  static estimateSegments(radius, sweepRadians, tolerance) {
    if (sweepRadians <= 0) return 1;
    const maxStep = this.approxMaxStepAngle(radius, tolerance);
    const n = Math.ceil(sweepRadians / maxStep);
    return Math.max(3, n); // minimum 3 segments
  }
}

module.exports = GeometryUtils;
