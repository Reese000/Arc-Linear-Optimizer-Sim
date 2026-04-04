/**
 * ArcFitter attempts to replace sequences of G1 (linear) segments
 * with a single G2/G3 (arc) command while maintaining accuracy.
 */
class ArcFitter {
  constructor(tolerance = 0.001) {
    this.tolerance = tolerance; // Default to 0.001" (suitable for Haas non-HSM)
  }

  /**
   * Fits a circle to a set of points using the Kåsa method (simplified Least Squares).
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
    const radius = Math.sqrt(Math.abs(sumX2 + sumY2 - 2 * xc * sumX - 2 * yc * sumY + N * (xc * xc + yc * yc)) / N);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius)) return null;

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

  /**
   * Optimizes a sequence of toolpath states.
   */
   optimize(pathData) {
     const optimized = [];
     let i = 0;

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
        let windowPoints = [{ x: start.state.x, y: start.state.y }];

        while (j < pathData.length && isLinearG(pathData[j].cmd)) {
          // Prevent fitting if Z changes (strictly XY arcs for now)
          if (pathData[j].state.z !== start.state.z) break;

          windowPoints.push({ x: pathData[j].state.x, y: pathData[j].state.y });
          
          if (windowPoints.length >= 3) {
            const circle = ArcFitter.fitCircle(windowPoints);
            if (circle && ArcFitter.isWithinTolerance(windowPoints, circle, this.tolerance)) {
              bestArc = {
                circle: circle,
                length: windowPoints.length,
                endState: pathData[j].state
              };
            } else if (bestArc) {
              // Current window failed, but we had a valid arc before this.
              break; 
            }
          }
          j++;
        }

        if (bestArc && bestArc.length > 2) {
          // Replace linear segments with an arc
          optimized.push(this.createArcCommand(start.state, bestArc.endState, bestArc.circle));
          i += (bestArc.length - 1);
        } else {
          optimized.push(pathData[i].raw);
        }
      } else {
        optimized.push(pathData[i].raw);
      }
      i++;
    }
    return optimized;
  }

  createArcCommand(start, end, circle) {
    // Determine G2 or G3 using the cross product of (start->center) and (start->end)
    const vSC = { x: circle.center.x - start.x, y: circle.center.y - start.y };
    const vSE = { x: end.x - start.x, y: end.y - start.y };
    const cross = vSC.x * vSE.y - vSC.y * vSE.x;
    
    const gMode = cross > 0 ? "G3" : "G2";
    const iVal = (circle.center.x - start.x).toFixed(4);
    const jVal = (circle.center.y - start.y).toFixed(4);
    
    return `${gMode} X${end.x.toFixed(4)} Y${end.y.toFixed(4)} I${iVal} J${jVal}`;
  }
}

module.exports = ArcFitter;
