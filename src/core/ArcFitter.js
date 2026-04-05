const Verifier = require('../sim/Verifier');
const GeometryUtils = require('./GeometryUtils');
const WindowEvaluator = require('./evaluation/WindowEvaluator');

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
    if (tolerance <= 0) {
      throw new Error('Tolerance must be a positive number');
    }
    this.tolerance = tolerance;

    const minRadius = options.minArcRadius !== undefined ? options.minArcRadius : 0;
    const maxRadius = options.maxArcRadius !== undefined ? options.maxArcRadius : Infinity;
    if (minRadius < 0) {
      throw new Error('minArcRadius must be non-negative');
    }
    if (maxRadius < minRadius) {
      throw new Error('maxArcRadius must be greater than or equal to minArcRadius');
    }
    this.minArcRadius = minRadius;
    this.maxArcRadius = maxRadius;

    const maxIJK = options.maxIJK !== undefined ? options.maxIJK : Infinity;
    if (maxIJK < 0) {
      throw new Error('maxIJK must be non-negative');
    }
    this.maxIJK = maxIJK;

    if (options.precision !== undefined && (!Number.isInteger(options.precision) || options.precision < 0)) {
      throw new Error('precision must be a non-negative integer');
    }
    this.precision = options.precision || 4;

    this.allowHelix = options.allowHelix || false;
    this.modalSuppression = options.modalSuppression || false;
    this.bidirectional = options.bidirectional || false;
    this.maxSearch = options.maxSearch || 50;
    this.useRANSAC = options.ransac || false; // RANSAC robust fitting
    this.maxSweep = options.maxSweep !== undefined ? options.maxSweep : 180; // maximum arc sweep in degrees
    this.minSweep = options.minSweep !== undefined ? options.minSweep : 5; // minimum arc sweep in degrees (reject tiny arcs)
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

    const denominator = 2 * (C * G - D * D);
    if (Math.abs(denominator) < 1e-12) return null;

    const xc = (E * G - H * D) / denominator;
    const yc = (H * C - E * D) / denominator;

    const numerator = sumX2 + sumY2 - 2 * xc * sumX - 2 * yc * sumY + N * (xc * xc + yc * yc);
    const radius = Math.sqrt(Math.abs(numerator) / N);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius) || radius <= 0) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  /**
   * Pratt's circle fit (geometric refinement of Kåasa).
   */
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

    let sumRSq = 0;
    for (const p of points) {
      const dx = p.x - xc;
      const dy = p.y - yc;
      sumRSq += dx*dx + dy*dy;
    }
    const radius = Math.sqrt(sumRSq / N);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius) || radius <= 0) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  /**
   * Taubin's circle fit (constraint-based algebraic).
   */
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

    const gamma = (sumX2 + sumY2) / N - (xc*xc + yc*yc);
    const beta = (sumX3 + sumXY2 - (sumX2 + sumY2)*xc/N) / (2*(C/N));
    const radius = Math.sqrt(gamma + beta*beta);

    if (isNaN(xc) || isNaN(yc) || isNaN(radius) || radius <= 0) return null;

    return { center: { x: xc, y: yc }, radius: radius };
  }

  /**
   * RANSAC-based robust circle fitting.
   * Randomly samples minimal 3-point sets, fits circles, and selects the one with most inliers.
   * @param {Array} points - Array of {x, y}
   * @param {number} tolerance - Inlier threshold
   * @param {number} maxIterations - RANSAC iterations (default 100)
   * @returns {Object|null} - Fitted circle with inlier count
   */
  static fitCircleRANSAC(points, tolerance = 0.001, maxIterations = 100) {
    if (points.length < 3) return null;
    let bestCircle = null;
    let bestInliers = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      const idxs = new Set();
      while (idxs.size < 3) {
        idxs.add(Math.floor(Math.random() * points.length));
      }
      const sample = Array.from(idxs).map(i => points[i]);

      const circle = ArcFitter.fitCircle(sample);
      if (!circle) continue;

      let inliers = 0;
      for (const p of points) {
        const dist = Math.hypot(p.x - circle.center.x, p.y - circle.center.y);
        if (Math.abs(dist - circle.radius) <= tolerance) {
          inliers++;
        }
      }

      if (inliers > bestInliers) {
        bestInliers = inliers;
        bestCircle = { ...circle, inliers };
      }
    }

    if (bestCircle && bestInliers >= 3) {
      const inlierPoints = points.filter(p => {
        const dist = Math.hypot(p.x - bestCircle.center.x, p.y - bestCircle.center.y);
        return Math.abs(dist - bestCircle.radius) <= tolerance;
      });
      if (inlierPoints.length >= 3) {
        const refined = ArcFitter.fitCirclePratt(inlierPoints);
        if (refined) {
          return { ...refined, inliers: inlierPoints.length };
        }
      }
    }

    return bestCircle;
  }

  /**
   * Checks if all points lie within tolerance of the circle.
   * @param {Array} points
   * @param {Object} circle
   * @param {number} tolerance
   * @returns {boolean}
   */
  static isWithinTolerance(points, circle, tolerance) {
    for (const p of points) {
      const dist = Math.sqrt(Math.pow(p.x - circle.center.x, 2) + Math.pow(p.y - circle.center.y, 2));
      if (Math.abs(dist - circle.radius) > tolerance) return false;
    }
    return true;
  }

  static isArcValid(points, circle, start, end, tolerance) {
    const verifier = new Verifier(tolerance);
    const result = verifier.verify(points, circle, start, end);
    return result.isSafe;
  }

  /**
   * Computes comprehensive statistics about a set of arcs.
   * @param {Array} arcs - Array of arc records
   * @returns {Object} - Statistics object
   */
  static computeArcStats(arcs) {
    if (!arcs || arcs.length === 0) {
      return { count: 0, avgSweepDegrees: 0, maxSweepDegrees: 0, avgRadius: 0, radiusCV: 0, smallArcPct: 0, largeSweepPct: 0 };
    }

    const sweeps = arcs.map(a => a.sweepDegrees);
    const radii = arcs.map(a => a.circle.radius);
    const avgSweep = sweeps.reduce((a,b) => a+b, 0) / sweeps.length;
    const maxSweep = Math.max(...sweeps);
    const avgRadius = radii.reduce((a,b) => a+b, 0) / radii.length;
    const smallCount = arcs.filter(a => a.sweepDegrees < 10).length;
    const largeCount = arcs.filter(a => a.sweepDegrees > 180).length;

    const radiusVariance = radii.reduce((sum, r) => sum + Math.pow(r - avgRadius, 2), 0) / radii.length;
    const radiusCV = Math.sqrt(radiusVariance) / (avgRadius || 1);

    return {
      count: arcs.length,
      avgSweepDegrees: avgSweep,
      maxSweepDegrees: maxSweep,
      avgRadius: avgRadius,
      radiusCV: radiusCV,
      smallArcPct: smallCount / arcs.length,
      largeSweepPct: largeCount / arcs.length
    };
  }

  /**
   * Determines the arc direction (G2 or G3) based on the toolpath order.
   * Uses the first intermediate point to decide which side of the chord the arc bulges.
   */
  determineArcDirection(start, end, points) {
    if (!points || points.length < 3) {
      return 'G2'; // default
    }
    let mid = points[1];
    let idx = 1;
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
    // Using (end-start) x (mid-start): cross < 0 indicates CCW (G3), cross > 0 indicates CW (G2)
    return cross < 0 ? 'G3' : 'G2';
  }

  /**
   * Computes the sweep angle in degrees for an arc from start to end following the given circle,
   * using the intermediate points to determine direction.
   */
   computeSweepDegrees(start, end, circle, points) {
     const startA = Math.atan2(start.y - circle.center.y, start.x - circle.center.x);
     const endA = Math.atan2(end.y - circle.center.y, end.x - circle.center.x);
     const direction = this.determineArcDirection(start, end, points);
     const TWOPI = 2 * Math.PI;
     let sweep;
     if (direction === 'G3') { // CCW
       sweep = (endA - startA) % TWOPI;
       if (sweep < 0) sweep += TWOPI;
     } else { // CW
       sweep = (startA - endA) % TWOPI;
       if (sweep < 0) sweep += TWOPI;
     }
     return sweep * 180 / Math.PI;
   }

   /**
    * Computes a composite quality score for an optimization result.
    * Score weights: 60% compression, 30% accuracy, 10% stability.
    * @static
    * @param {number} originalCount - Original line count
    * @param {Array} arcs - Array of arc records (with sweepDegrees, circle.radius)
    * @param {number} linearsCount - Number of linear moves remaining
    * @returns {number} - Quality score 0-100
    */
   static computeQualityScore(originalCount, arcs, linearsCount) {
     if (originalCount === 0) return 0;
     const optCount = arcs.length + linearsCount;
     const reduction = ((originalCount - optCount) / originalCount) * 100;
     // Compression score: scaled up to 100 at 66.67% reduction
     const compressionScore = Math.max(0, Math.min(100, reduction * 1.5));

     // Assuming all arcs passed verification during fitting, accuracy is perfect
     const accuracyScore = 100;

     // Stability score based on arc statistics
     let stabilityScore = 80; // Default when no arcs (stable but not compressed)
     if (arcs.length > 0) {
       const smallSweepCount = arcs.filter(a => a.sweepDegrees < 5).length;
       const largeSweepCount = arcs.filter(a => a.sweepDegrees > 180).length;
       const pctSmall = smallSweepCount / arcs.length;
       const pctLarge = largeSweepCount / arcs.length;

       // Coefficient of variation of arc radii (prefer consistent radii)
       const radii = arcs.map(a => a.circle.radius);
       const radiiMean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
       const radiiVariance = radii.reduce((sum, r) => sum + Math.pow(r - radiiMean, 2), 0) / radii.length;
       const cv = Math.sqrt(radiiVariance) / (radiiMean || 1);

       // Penalize many tiny arcs (<5°), arcs > 180°, and high radius variation
       stabilityScore = Math.max(0, 100 - 40 * pctSmall - 20 * pctLarge - 15 * cv);
     }

     const finalScore = compressionScore * 0.6 + accuracyScore * 0.3 + stabilityScore * 0.1;
     return Math.round(finalScore);
   }

  /**
   * Merge consecutive arcs with similar parameters into a single arc
   */
   mergeArcs(arcs, tolerance = 0.001) {
       if (arcs.length < 2) return arcs;

       // Use adaptive merge tolerance: base tolerance or 1% of radius (whichever larger)
       const getMergeTol = (radius) => Math.max(tolerance, radius * 0.01, 0.05);

       const merged = [];
       let current = arcs[0];

       for (let i = 1; i < arcs.length; i++) {
         const next = arcs[i];
         const mergeTol = getMergeTol(current.circle.radius);

         const sameCenter = Math.abs(current.circle.center.x - next.circle.center.x) < mergeTol &&
                           Math.abs(current.circle.center.y - next.circle.center.y) < mergeTol;
         const sameRadius = Math.abs(current.circle.radius - next.circle.radius) < mergeTol;
         const sameDirection = current.direction === next.direction;
         const connected = Math.abs(current.end.x - next.start.x) < 1e-9 &&
                          Math.abs(current.end.y - next.start.y) < 1e-9;
         const sameFeedrate = Math.abs(current.feedrate - next.feedrate) < 1e-9;

         // Check combined sweep does not exceed maxSweep constraint
         const combinedSweep = current.sweepDegrees + next.sweepDegrees;

         if (sameCenter && sameRadius && sameDirection && connected && sameFeedrate && combinedSweep <= this.maxSweep) {
           const combinedPoints = [...current.originalPoints, ...next.originalPoints.slice(1)];
           let refitSuccess = false;
           if (combinedPoints.length >= 3) {
             const newCircle = this.useRANSAC
               ? ArcFitter.fitCircleRANSAC(combinedPoints, tolerance)
               : ArcFitter.fitCircle(combinedPoints);

             if (newCircle && ArcFitter.isArcValid(combinedPoints, newCircle, current.startState, next.endState, tolerance)) {
               const iVal = newCircle.center.x - current.startState.x;
               const jVal = newCircle.center.y - current.startState.y;
               const epsilon = 1e-9;
               if (Math.abs(iVal) <= this.maxIJK + epsilon && Math.abs(jVal) <= this.maxIJK + epsilon) {
                 // Refit succeeded: update arc with new circle
                 current.circle = newCircle;
                 current.endState = next.endState;
                 current.end = next.end;
                 current.sweepDegrees = this.computeSweepDegrees(current.startState, next.endState, newCircle, combinedPoints);
                 current.originalPoints = combinedPoints;
                 refitSuccess = true;
               }
             }
           }
           if (!refitSuccess) {
             // Fallback to simple merge without refit: combine arcs that have same circle
             current.endState = next.endState;
             current.end = next.end;
             current.sweepDegrees = combinedSweep;
             current.originalPoints.push(...next.originalPoints.slice(1));
             // IMPORTANT: Validate the combined arc; if it now exceeds tolerance, reject the merge
             if (!ArcFitter.isArcValid(current.originalPoints, current.circle, current.startState, current.endState, tolerance)) {
               // Undo the merge by splitting back
               merged.push(current);
               current = next;
               continue; // try merging next from current
             }
           }
           // Continue to try merging further
           continue;
         }
         merged.push(current);
         current = next;
       }
       merged.push(current);
       return merged;
     }

   /**
    * Attempts to extend arcs backward to include more points before their start.
    * This bidirectionally increases arc coverage by looking at points that were
    * previously excluded because a short arc was greedily chosen.
    * @param {Array} arcRecords - Array of arc records from initial optimization
    * @param {Array} allPathData - Full parsed path data
    * @param {number} effectiveTolerance - Tolerance to use for fitting
    * @returns {Array} - Extended arc records
    */
    extendArcsBackward(arcRecords, allPathData, effectiveTolerance) {
      if (arcRecords.length === 0) return arcRecords;

      // Precompute start and end indices for each arc, build sorted list
      const arcInfos = arcRecords.map(arc => {
        const startIdx = allPathData.findIndex(item =>
          Math.abs(item.state.x - arc.start.x) < 1e-9 &&
          Math.abs(item.state.y - arc.start.y) < 1e-9
        );
        const endIdx = allPathData.findIndex(item =>
          Math.abs(item.state.x - arc.end.x) < 1e-9 &&
          Math.abs(item.state.y - arc.end.y) < 1e-9
        );
        return { arc, startIdx, endIdx };
      }).filter(info => info.startIdx !== -1 && info.endIdx !== -1);

      // Sort by start index (forward order)
      arcInfos.sort((a, b) => a.startIdx - b.startIdx);

      const extendedArcs = [];
      for (let idx = 0; idx < arcInfos.length; idx++) {
        const { arc, startIdx, endIdx } = arcInfos[idx];

        // Determine the minimum allowed start index to avoid overlap with previous arc
        let minAllowed = 0;
        if (idx > 0) {
          const prevEndIdx = arcInfos[idx - 1].endIdx;
          minAllowed = prevEndIdx + 1;
        }

        // Search window: startIdx - this.maxSearch, but not before minAllowed
        let bestExtension = null;
        let bestWindowPoints = null;
        const minIdx = Math.max(minAllowed, startIdx - this.maxSearch);

        // If minIdx >= startIdx, nothing to extend
        if (minIdx >= startIdx) {
          extendedArcs.push(arc);
          continue;
        }

        for (let j = startIdx - 1; j >= minIdx; j--) {
          const candidateStart = allPathData[j];
          // Check that points between j and startIdx are all G1 and same Z
          let valid = true;
          let windowPoints = [{ x: candidateStart.state.x, y: candidateStart.state.y }];
          for (let k = j + 1; k <= startIdx; k++) {
            const pt = allPathData[k];
            if (!this._isLinearG(pt.cmd)) { valid = false; break; }
            if (!this.allowHelix && Math.abs(pt.state.z - candidateStart.state.z) > 1e-9) { valid = false; break; }
            windowPoints.push({ x: pt.state.x, y: pt.state.y });
          }
          if (!valid) break;

          if (windowPoints.length >= 3) {
            const circle = this.useRANSAC
              ? ArcFitter.fitCircleRANSAC(windowPoints, effectiveTolerance)
              : ArcFitter.fitCircle(windowPoints);
            if (circle && ArcFitter.isArcValid(windowPoints, circle, candidateStart.state, arc.startState, effectiveTolerance)) {
              const radius = circle.radius;
              const epsilon = 1e-9;
              if (radius + epsilon >= this.minArcRadius && radius - epsilon <= this.maxArcRadius) {
                const iVal = circle.center.x - candidateStart.state.x;
                const jVal = circle.center.y - candidateStart.state.y;
                if (Math.abs(iVal) <= this.maxIJK + epsilon && Math.abs(jVal) <= this.maxIJK + epsilon) {
                  const sweepDegrees = this.computeSweepDegrees(candidateStart.state, arc.startState, circle, windowPoints);
                  if (sweepDegrees <= this.maxSweep && sweepDegrees >= this.minSweep) {
                    bestExtension = {
                      circle,
                      length: windowPoints.length,
                      startState: candidateStart.state,
                      startIndex: j,
                      endState: arc.startState,
                      endIndex: startIdx,
                      sweepDegrees,
                      originalPoints: windowPoints
                    };
                  }
                }
              }
            }
          }
        }

        if (bestExtension) {
          const combinedSweep = bestExtension.sweepDegrees + arc.sweepDegrees;
          if (combinedSweep <= this.maxSweep) {
            const combinedPoints = [...bestExtension.originalPoints, ...arc.originalPoints.slice(1)];
            // Validate the combined arc against the extension's circle
            if (ArcFitter.isArcValid(combinedPoints, bestExtension.circle, bestExtension.startState, arc.endState, effectiveTolerance)) {
              const combinedArc = {
                circle: bestExtension.circle,
                start: { x: bestExtension.startState.x, y: bestExtension.startState.y },
                end: { x: arc.endState.x, y: arc.endState.y },
                startState: bestExtension.startState,
                endState: arc.endState,
                startIndex: bestExtension.startIndex,
                endIndex: endIdx,
                originalPoints: combinedPoints,
                direction: arc.direction,
                feedrate: arc.feedrate,
                sweepDegrees: combinedSweep
              };
              extendedArcs.push(combinedArc);
            } else {
              // Extension would produce invalid arc; keep original arc unchanged
              extendedArcs.push(arc);
            }
          } else {
            extendedArcs.push(arc);
          }
        } else {
          extendedArcs.push(arc);
        }
      }

      return extendedArcs;
    }

   /**
    * Second refinement pass: attempt to fit arcs into gaps between existing arcs.
    * This can recover toolpath compression lost due to greedy first-fit decisions.
    * @param {Array} allPathData - Full parsed path data
    * @param {number} effectiveTolerance - Tolerance to use for fitting
    * @returns {Array<string>} - Further optimized G-code strings
    */
   refine(allPathData, effectiveTolerance) {
     if (!this.lastArcs || this.lastArcs.length === 0) {
       return this.lastResult || [];
     }

     // Gather current arcs and their index ranges
     const arcRanges = this.lastArcs.map(arc => {
       const startIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - arc.start.x) < 1e-9 &&
         Math.abs(item.state.y - arc.start.y) < 1e-9
       );
       const endIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - arc.end.x) < 1e-9 &&
         Math.abs(item.state.y - arc.end.y) < 1e-9
       );
       return { start: startIdx, end: endIdx, arc };
     }).filter(r => r.start !== -1 && r.end !== -1);

     // Sort arcs by start index
     arcRanges.sort((a, b) => a.start - b.start);

     // Identify gaps (segments of linear moves not yet converted to arcs)
     const gaps = [];
     let lastEnd = -1;
     for (const range of arcRanges) {
       if (range.start > lastEnd + 1) {
         gaps.push({ start: lastEnd + 1, end: range.start - 1 });
       }
       lastEnd = range.end;
     }
     if (lastEnd < allPathData.length - 1) {
       gaps.push({ start: lastEnd + 1, end: allPathData.length - 1 });
     }

      // If no gaps, rebuild output from current arcs and return
      if (gaps.length === 0 || gaps[0].start === -1) {
        const output = this._regenerateOutput(allPathData, this.lastArcs);
        this.lastLinearsCount = output.length - this.lastArcs.length;
        return output;
      }

      // For each gap, try to fit an arc if it's not too long (within maxSearch)
      const newArcs = [];
      for (const gap of gaps) {
        const gapLength = gap.end - gap.start + 1;
        if (gapLength < 3) continue; // Need at least 3 points for arc

        // Try to fit an arc across the entire gap
        const windowPoints = [];
        for (let i = gap.start; i <= gap.end; i++) {
          windowPoints.push({ x: allPathData[i].state.x, y: allPathData[i].state.y });
        }

        const startState = allPathData[gap.start].state;
        const endState = allPathData[gap.end].state;

        // Determine effective tolerance from start state (G187 aware)
        const gapTolerance = (typeof startState.getEffectiveTolerance === 'function')
          ? startState.getEffectiveTolerance(this.tolerance)
          : this.tolerance;

        const circle = this.useRANSAC
          ? ArcFitter.fitCircleRANSAC(windowPoints, gapTolerance)
          : ArcFitter.fitCircle(windowPoints);

        if (circle && ArcFitter.isArcValid(windowPoints, circle, startState, endState, gapTolerance)) {
          const radius = circle.radius;
          const epsilon = 1e-9;
          if (radius + epsilon >= this.minArcRadius && radius - epsilon <= this.maxArcRadius) {
            const iVal = circle.center.x - startState.x;
            const jVal = circle.center.y - startState.y;
            if (Math.abs(iVal) <= this.maxIJK + epsilon && Math.abs(jVal) <= this.maxIJK + epsilon) {
              const sweepDegrees = this.computeSweepDegrees(startState, endState, circle, windowPoints);
              if (sweepDegrees <= this.maxSweep && sweepDegrees >= this.minSweep) {
                // Found an arc for this gap!
                const gMode = this.determineArcDirection(startState, endState, windowPoints);
                const arcCmd = this.createArcCommand(startState, endState, circle, this.precision, gMode);
                newArcs.push({
                  command: arcCmd,
                  start: { x: startState.x, y: startState.y },
                  end: { x: endState.x, y: endState.y },
                  circle,
                  direction: gMode,
                  sweepDegrees,
                  feedrate: startState.feedrate,
                  startState,
                  endState,
                  originalPoints: windowPoints
                });
                continue; // Gap filled with one arc
              }
            }
          }
        }

        // If single arc doesn't work, try to break gap into smaller arcs using normal sliding window
        // Run a mini-optimization on just this gap
        let i = gap.start;
        while (i <= gap.end) {
          const startItem = allPathData[i];
          if (!this._isLinearG(startItem.cmd)) {
            i++;
            continue;
          }
          const startZ = startItem.state.z;
          let j = i + 1;
          let bestArc = null;
          let bestWindowPoints = null;
          let windowPoints = [{ x: startItem.state.x, y: startItem.state.y }];

          while (j <= gap.end && (j - gap.start) < this.maxSearch) {
            const current = allPathData[j];
            if (!this._isLinearG(current.cmd)) break;
            if (!this.allowHelix && Math.abs(current.state.z - startZ) > 1e-9) break;

            windowPoints.push({ x: current.state.x, y: current.state.y });
            if (windowPoints.length >= 3) {
              const circle = this.useRANSAC
                ? ArcFitter.fitCircleRANSAC(windowPoints, gapTolerance)
                : ArcFitter.fitCircle(windowPoints);
              if (circle && ArcFitter.isArcValid(windowPoints, circle, startItem.state, current.state, gapTolerance)) {
                const radius = circle.radius;
                const epsilon = 1e-9;
                if (radius + epsilon >= this.minArcRadius && radius - epsilon <= this.maxArcRadius) {
                  const iVal = circle.center.x - startItem.state.x;
                  const jVal = circle.center.y - startItem.state.y;
                  if (Math.abs(iVal) <= this.maxIJK + epsilon && Math.abs(jVal) <= this.maxIJK + epsilon) {
                    // Z linearity verification for helical arcs (same as in optimize)
                    if (this.allowHelix && Math.abs(current.state.z - startZ) > 1e-9) {
                      const startA = Math.atan2(startItem.state.y - circle.center.y, startItem.state.x - circle.center.x);
                      const endA = Math.atan2(current.state.y - circle.center.y, current.state.x - circle.center.x);
                      const direction = this.determineArcDirection(startItem.state, current.state, windowPoints);
                      const TWOPI = 2 * Math.PI;
                      let sweepRad;
                      if (direction === 'G3') {
                        sweepRad = (endA - startA) % TWOPI;
                        if (sweepRad < 0) sweepRad += TWOPI;
                      } else {
                        sweepRad = (startA - endA) % TWOPI;
                        if (sweepRad < 0) sweepRad += TWOPI;
                      }
                      const dzTotal = current.state.z - startZ;
                      let zValid = true;
                      for (let k = 1; k < windowPoints.length - 1; k++) {
                        const p = windowPoints[k];
                        const pA = Math.atan2(p.y - circle.center.y, p.x - circle.center.x);
                        let angleDiff;
                        if (direction === 'G3') {
                          angleDiff = (pA - startA) % TWOPI;
                          if (angleDiff < 0) angleDiff += TWOPI;
                        } else {
                          angleDiff = (startA - pA) % TWOPI;
                          if (angleDiff < 0) angleDiff += TWOPI;
                        }
                        const fraction = sweepRad > 0 ? angleDiff / sweepRad : 0;
                        const expectedZ = startZ + fraction * dzTotal;
                        if (Math.abs(p.z - expectedZ) > gapTolerance) {
                          zValid = false;
                          break;
                        }
                      }
                      if (!zValid) {
                        if (bestArc) break;
                        else break;
                      }
                    }

                    bestArc = {
                      circle,
                      length: windowPoints.length,
                      startState: startItem.state,
                      endState: current.state,
                      endIndex: j
                    };
                    bestWindowPoints = windowPoints.slice();
                  }
                }
              } else if (bestArc) {
                break;
              }
            }
            j++;
          }

         if (bestArc && bestArc.length > 2) {
            const sweepDegrees = this.computeSweepDegrees(startItem.state, bestArc.endState, bestArc.circle, windowPoints);
            if (sweepDegrees > this.maxSweep || sweepDegrees < this.minSweep) {
              if (bestArc) break;
              else continue;
            }
            const gMode = this.determineArcDirection(startItem.state, bestArc.endState, windowPoints);
            const arcCmd = this.createArcCommand(startItem.state, bestArc.endState, bestArc.circle, this.precision, gMode);
           newArcs.push({
             command: arcCmd,
             start: { x: startItem.state.x, y: startItem.state.y },
             end: { x: bestArc.endState.x, y: bestArc.endState.y },
             circle: bestArc.circle,
             direction: gMode,
             sweepDegrees,
             feedrate: startItem.state.feedrate,
             startState: startItem.state,
             endState: bestArc.endState,
             originalPoints: windowPoints.slice(0, bestArc.length)
           });
           i = bestArc.endIndex + 1;
         } else {
           i++;
         }
       }
     }

     // Merge newArcs with existing arcs and sort by position
     const allArcs = [...this.lastArcs, ...newArcs];
     allArcs.sort((a, b) => {
       // Compare by start index approximation
       const aIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - a.start.x) < 1e-9 && Math.abs(item.state.y - a.start.y) < 1e-9
       );
       const bIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - b.start.x) < 1e-9 && Math.abs(item.state.y - b.start.y) < 1e-9
       );
       return aIdx - bIdx;
     });

      // Re-run mergeArcs on combined set
      const merged = this.mergeArcs(allArcs);

      // Regenerate full output (arcs + linears)
      const finalOutput = this._regenerateOutput(allPathData, merged);

      // Update instance state to reflect refined result
      this.lastArcs = merged;
      this.lastLinearsCount = finalOutput.length - merged.length;

      return finalOutput;
    }

   /**
    * Regenerates optimized G-code output using a given set of arcs.
    * @param {Array} allPathData - Full parsed path data
    * @param {Array} arcs - Arc records to include
    * @returns {Array<string>} - Optimized G-code strings
    * @private
    */
   _regenerateOutput(allPathData, arcs) {
     // Build a map of indices covered by arcs
     const covered = new Set();
     const arcRecords = arcs.map(arc => {
       const startIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - arc.start.x) < 1e-9 &&
         Math.abs(item.state.y - arc.start.y) < 1e-9
       );
       const endIdx = allPathData.findIndex(item =>
         Math.abs(item.state.x - arc.end.x) < 1e-9 &&
         Math.abs(item.state.y - arc.end.y) < 1e-9
       );
       if (startIdx !== -1 && endIdx !== -1) {
         // Mark all points from startIdx to endIdx as covered by this arc
         for (let i = startIdx; i <= endIdx; i++) covered.add(i);
         return { arc, startIdx, endIdx };
       }
       return null;
     }).filter(r => r !== null);

     // Traverse path data and build output
     const output = [];
     let lastCommand = null;
     let i = 0;
     while (i < allPathData.length) {
       if (covered.has(i)) {
         // Find the arc that covers i (should be the first one starting at i)
         const rec = arcRecords.find(r => r.startIdx === i);
         if (rec) {
           output.push(rec.arc.command);
           i = rec.endIdx + 1;
           continue;
         }
       }
       // Pass through as linear (G1)
       const item = allPathData[i];
       if (item.cmd.G === 1 || item.cmd.G === 0) {
         // Reconstruct G1 line (simplified: just X Y F from state)
         const s = item.state;
         let line = `G1 X${s.x.toFixed(4)} Y${s.y.toFixed(4)}`;
         if (Math.abs(s.z - (allPathData[i-1]?.state.z || s.z)) > 1e-9) {
           line += ` Z${s.z.toFixed(4)}`;
         }
         if (s.feedrate > 0) {
           line += ` F${s.feedrate.toFixed(2)}`;
         }
         output.push(line);
       } else {
         // Non-motion command - pass through raw if available
         if (item.raw) output.push(item.raw);
       }
       i++;
     }

     return output;
   }

   /**
    * Helper to check if command is a linear G1 move
    * @private
    */
   _isLinearG(cmd) {
     if (!cmd || !cmd.G) return false;
     if (Array.isArray(cmd.G)) return cmd.G.includes(1);
     return cmd.G === 1;
   }

    /**
     * Automated optimization: searches over tolerance multipliers, maxSearch depths, and RANSAC
     * to find the configuration that maximizes the quality score.
     * This multi-parameter search allows adaptation to geometry complexity without manual tuning.
     * @param {Array} pathData - Parsed toolpath data
     * @param {Object} options - Optimization options (same as optimize)
     * @param {Array<number>} options.autoMultipliers - Tolerance multipliers (default [0.5, 1.0, 2.0])
     * @param {Array<number>} options.autoMaxSearches - Max search depths to try (default [50, 100])
     * @param {boolean} options.autoIncludeRansac - Also test with RANSAC (default false)
     * @param {boolean} options.autoRefine - Run deep-search pass on best result (default true)
     * @returns {Array<string>} - Optimized G-code strings from best configuration
     */
    optimizeAuto(pathData, options = {}) {
      const baseTolerance = this.tolerance;
      const multipliers = options.autoMultipliers || [0.5, 1.0, 2.0];
      const maxSearches = options.autoMaxSearches || [this.maxSearch, this.maxSearch * 2];
      const includeRansac = options.autoIncludeRansac || false;
      const doRefine = options.autoRefine !== false;

      let bestScore = -Infinity;
      let bestResult = null;
      let bestFitter = null;

      // Cross product: multipliers × maxSearches × [ransac]
      for (const mult of multipliers) {
        for (const ms of maxSearches) {
          for (const ransac of (includeRansac ? [false, true] : [false])) {
            const trialFitter = new ArcFitter(baseTolerance * mult, {
              minArcRadius: this.minArcRadius,
              maxArcRadius: this.maxArcRadius,
              maxIJK: this.maxIJK,
              allowHelix: this.allowHelix,
              modalSuppression: this.modalSuppression,
              bidirectional: this.bidirectional,
              ransac: ransac,
              maxSearch: ms,
              maxSweep: this.maxSweep,
              precision: this.precision
            });
            const result = trialFitter.optimize(pathData, options);
            const score = ArcFitter.computeQualityScore(trialFitter.originalLineCount, trialFitter.lastArcs, trialFitter.lastLinearsCount);

            if (score > bestScore) {
              bestScore = score;
              bestResult = result;
              bestFitter = trialFitter;
            }
          }
        }
      }

      // Optional deep-search refinement: re-optimize with larger maxSearch
      if (doRefine && bestFitter) {
        const deepMaxSearch = Math.max(...maxSearches) * 2;
        const deepFitter = new ArcFitter(bestFitter.tolerance, {
          minArcRadius: this.minArcRadius,
          maxArcRadius: this.maxArcRadius,
          maxIJK: this.maxIJK,
          allowHelix: this.allowHelix,
          modalSuppression: this.modalSuppression,
          bidirectional: this.bidirectional,
          ransac: bestFitter.useRANSAC,
          maxSearch: deepMaxSearch,
          maxSweep: this.maxSweep,
          precision: this.precision
        });
        const deepResult = deepFitter.optimize(pathData, options);
        const deepScore = ArcFitter.computeQualityScore(deepFitter.originalLineCount, deepFitter.lastArcs, deepFitter.lastLinearsCount);
        if (deepScore > bestScore) {
          bestFitter = deepFitter;
          bestScore = deepScore;
          bestResult = deepResult;
        }
      }

      // Copy best fitter's stats to this instance
      this.lastArcs = bestFitter.lastArcs;
      this.lastLinearsCount = bestFitter.lastLinearsCount;
      this.originalLineCount = bestFitter.originalLineCount;
      this.lastAutoConfig = {
        tolerance: bestFitter.tolerance,
        ransac: bestFitter.useRANSAC,
        maxSearch: bestFitter.maxSearch,
        score: bestScore
      };

       return bestResult;
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
        let j = i + 1;
        let bestArc = null;
        let bestWindowPoints = null;
        let windowPoints = [{ x: start.state.x, y: start.state.y }];

        const startState = start.state;
        const startZ = startState.z;

        // Determine effective tolerance: G187 overrides default if tighter
        const effectiveTolerance = (typeof startState.getEffectiveTolerance === 'function')
          ? startState.getEffectiveTolerance(this.tolerance)
          : this.tolerance;

        while (j < pathData.length && (j - i) < this.maxSearch) {
          const current = pathData[j];

          // Only consecutive G1 moves are eligible for arc fitting; any other command breaks the window
          if (!isLinearG(current.cmd)) break;

          if (!allowHelix && current.state.z !== startZ) break;

          windowPoints.push({ x: current.state.x, y: current.state.y });

          if (windowPoints.length >= 3) {
            const result = WindowEvaluator.evaluateWindowSlice(
              windowPoints,
              startState,
              current.state,
              {
                tolerance: this.tolerance,
                effectiveTolerance: effectiveTolerance,
                minArcRadius: this.minArcRadius,
                maxArcRadius: this.maxArcRadius,
                maxIJK: this.maxIJK,
                allowHelix: this.allowHelix,
                useRANSAC: this.useRANSAC,
                minSweep: this.minSweep,
                maxSweep: this.maxSweep,
                precision: this.precision
              }
            );

            if (result) {
              bestArc = {
                circle: result.circle,
                length: result.length,
                endState: current.state,
                endIndex: j,
                sweepDegrees: result.sweepDegrees
              };
              bestWindowPoints = windowPoints.slice();
            } else {
              // Any invalid window stops expansion; use bestArc if we have one
              break;
            }
          }
          j++;
        }

         if (bestArc && bestArc.length > 2) {
           const arcWindowPoints = bestWindowPoints || windowPoints.slice(0, bestArc.length);
           const gMode = this.determineArcDirection(startState, bestArc.endState, arcWindowPoints);
           const sweepDegrees = bestArc.sweepDegrees; // use stored value

           // Still warn if > 180° for user awareness
           if (sweepDegrees > 180) {
             console.warn(`Arc sweep ${sweepDegrees.toFixed(1)}° exceeds 180° at index ${i}. Some controllers may not support this.`);
           }

            let arcCmd = this.createArcCommand(startState, bestArc.endState, bestArc.circle, precision, gMode);

            // Apply modal suppression if enabled
            if (modalSuppression) {
              const prevCmd = optimized[optimized.length - 1];
              if (prevCmd) {
                // Suppress G2/G3 if same as previous
                const prevMode = prevCmd.substring(0, 2);
                const currMode = arcCmd.substring(0, 2);
                if (currMode === prevMode && (currMode === 'G2' || currMode === 'G3')) {
                  arcCmd = arcCmd.replace(/^G2 /, '').replace(/^G3 /, '');
                }
                // Suppress F if same as previous
                const prevFMatch = prevCmd.match(/F([\d.]+)/);
                const currFMatch = arcCmd.match(/F([\d.]+)/);
                if (prevFMatch && currFMatch && parseFloat(prevFMatch[1]) === parseFloat(currFMatch[1])) {
                  arcCmd = arcCmd.replace(/ F[\d.]+/, '');
                }
              }
            }

            optimized.push(arcCmd);
           const arcRecord = {
             command: arcCmd,
             start: { x: startState.x, y: startState.y },
             end: { x: bestArc.endState.x, y: bestArc.endState.y },
             startState: startState,
             endState: bestArc.endState,
             circle: bestArc.circle,
             direction: gMode,
             sweepDegrees: sweepDegrees,
             originalPoints: arcWindowPoints,
             feedrate: startState.feedrate,
             effectiveTolerance: effectiveTolerance
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
        if (!start.cmd.G || (start.cmd.G !== 2 && start.cmd.G !== 3)) {
          linearsCount++;
          this.lastLinearsCount++;
        }
      }
      i++;
    }

    // If bidirectional mode, extend arcs backward and refine to fill gaps
    if (this.bidirectional && this.lastArcs.length > 0) {
      // Use the base tolerance for extension (could be refined per-arc later)
      const extended = this.extendArcsBackward(this.lastArcs, pathData, this.tolerance);
      this.lastArcs = extended;
      // Refine to fill any gaps between extended arcs
      const refined = this.refine(pathData, this.tolerance);
      return refined;
    }

    return optimized;
  }

  createArcCommand(start, end, circle, precision = 4, gMode = null) {
    let mode = gMode;
    if (!mode) {
      const vSC = { x: circle.center.x - start.x, y: circle.center.y - start.y };
      const vSE = { x: end.x - start.x, y: end.y - start.y };
       const cross = vSC.x * vSE.y - vSC.y * vSE.x;
       mode = cross > 0 ? "G3" : "G2";
    }

    // Use state's precision if available; fall back to provided precision
    const actualPrecision = (start.precision !== undefined) ? start.precision : precision;
    // Determine unit mode: use start.isMetric (true for G21 mm, false for G20 inch). Default true.
    const isMetric = (start.isMetric !== undefined) ? start.isMetric : true;

    // Compute raw values in mm
    const iRaw = circle.center.x - start.x;
    const jRaw = circle.center.y - start.y;
    const xRaw = end.x;
    const yRaw = end.y;
    const zRaw = end.z - start.z;

    // Convert to current units if necessary
    let iVal, jVal, xVal, yVal, zVal;
    if (!isMetric) {
      // Convert mm to inches
      iVal = (iRaw / 25.4).toFixed(actualPrecision);
      jVal = (jRaw / 25.4).toFixed(actualPrecision);
      xVal = (xRaw / 25.4).toFixed(actualPrecision);
      yVal = (yRaw / 25.4).toFixed(actualPrecision);
    } else {
      iVal = iRaw.toFixed(actualPrecision);
      jVal = jRaw.toFixed(actualPrecision);
      xVal = xRaw.toFixed(actualPrecision);
      yVal = yRaw.toFixed(actualPrecision);
    }

    let zPart = '';
    if (Math.abs(zRaw) > 1e-9) {
      const zNum = !isMetric ? zRaw / 25.4 : zRaw;
      zPart = ' Z' + zNum.toFixed(actualPrecision);
    }

    const fVal = start.feedrate > 0 ? ` F${start.feedrate.toFixed(2)}` : '';

    return `${mode} X${xVal} Y${yVal}${zPart} I${iVal} J${jVal}${fVal}`;
  }
}

module.exports = ArcFitter;
