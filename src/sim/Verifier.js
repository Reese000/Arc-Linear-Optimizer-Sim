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
   * Calculates the chordal distance between a point and an arc.
   * @param {Object} p - Point {x, y}
   * @param {Object} circle - Circle {center: {x, y}, radius}
   * @returns {number} - Distance
   */
  static getDistanceToArc(p, circle) {
    const distFromCenter = Math.sqrt(Math.pow(p.x - circle.center.x, 2) + Math.pow(p.y - circle.center.y, 2));
    return Math.abs(distFromCenter - circle.radius);
  }

  /**
   * Compares the original toolpath points against the fitted arc.
   */
  verify(originalPoints, circle) {
    let result = {
      isSafe: true,
      maxDeviation: 0
    };

    for (const p of originalPoints) {
      const dev = Verifier.getDistanceToArc(p, circle);
      if (dev > result.maxDeviation) result.maxDeviation = dev;
      if (dev > this.tolerance) {
        result.isSafe = false;
      }
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
