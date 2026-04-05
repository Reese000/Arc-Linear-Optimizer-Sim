/**
 * WindowEvaluator: Pure function for evaluating if a window of points
 * can be represented as a valid arc. Can be used in both main thread
 * and worker threads without side effects.
 */
const CircleFitter = require('./CircleFitter');
const Verifier = require('../../sim/Verifier');

/**
 * Core evaluation logic.
 * @param {Array<{x,y,z}>} windowPoints - Points in the window (already sliced)
 * @param {Object} startState - Start point state {x, y, z}
 * @param {Object} endState - End point state {x, y, z}
 * @param {Object} options - Options (tolerance, radii, etc.)
 * @returns {Object|null}
 */
function evaluateWindowWithData(windowPoints, startState, endState, options = {}) {
  const {
    tolerance,
    effectiveTolerance = tolerance,
    minArcRadius = 0,
    maxArcRadius = Infinity,
    maxIJK = Infinity,
    allowHelix = false,
    useRANSAC = false,
    minSweep = 5,
    maxSweep = 180,
    precision = 4
  } = options;

  if (windowPoints.length < 3) return null;

  // Fit circle
  const circle = useRANSAC
    ? CircleFitter.fitCircleRANSAC(windowPoints, effectiveTolerance)
    : CircleFitter.fitCircle(windowPoints);

  if (!circle) return null;

  const radius = circle.radius;
  const epsilon = 1e-9;

  // Radius constraints
  if (radius + epsilon < minArcRadius || radius - epsilon > maxArcRadius) {
    return null;
  }

  // IJK constraints
  const iVal = circle.center.x - startState.x;
  const jVal = circle.center.y - startState.y;
  if (Math.abs(iVal) > maxIJK + epsilon || Math.abs(jVal) > maxIJK + epsilon) {
    return null;
  }

  // Z linearity for helical arcs
  if (allowHelix && Math.abs(endState.z - startState.z) > 1e-9) {
    const startA = Math.atan2(startState.y - circle.center.y, startState.x - circle.center.x);
    const endA = Math.atan2(endState.y - circle.center.y, endState.x - circle.center.x);
    // Determine direction
    let direction = 'G2';
    if (windowPoints.length >= 3) {
      let mid = windowPoints[1];
      let idx = 1;
      while (idx < windowPoints.length && mid.x === startState.x && mid.y === startState.y) {
        idx++;
        if (idx < windowPoints.length) mid = windowPoints[idx];
      }
      if (idx < windowPoints.length) {
        const ax = endState.x - startState.x;
        const ay = endState.y - startState.y;
        const bx = mid.x - startState.x;
        const by = mid.y - startState.y;
        const cross = ax * by - ay * bx;
        direction = cross < 0 ? 'G3' : 'G2';
      }
    }

    const TWOPI = 2 * Math.PI;
    let sweepRad;
    if (direction === 'G3') {
      sweepRad = (endA - startA) % TWOPI;
      if (sweepRad < 0) sweepRad += TWOPI;
    } else {
      sweepRad = (startA - endA) % TWOPI;
      if (sweepRad < 0) sweepRad += TWOPI;
    }

    const dzTotal = endState.z - startState.z;
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
      const expectedZ = startState.z + fraction * dzTotal;
      if (Math.abs(p.z - expectedZ) > effectiveTolerance) {
        return null;
      }
    }
  }

  // Verify arc using Verifier (radial deviation + endpoint fallback)
  const verifier = new Verifier(effectiveTolerance);
  const verResult = verifier.verify(windowPoints, circle, startState, endState);
  if (!verResult.isSafe) {
    return null;
  }

  // Compute sweep degrees
  const sweepDegrees = computeSweepDegrees(startState, endState, circle, windowPoints);
  if (sweepDegrees < minSweep || sweepDegrees > maxSweep) {
    return null;
  }

  return {
    valid: true,
    circle: circle,
    sweepDegrees: sweepDegrees,
    length: windowPoints.length
  };
}

/**
 * Evaluate a window given the full points array and indices.
 * @param {Array<{x,y,z}>} points - Full toolpath
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {Object} options
 * @returns {Object|null}
 */
function evaluateWindow(points, startIdx, endIdx, options) {
  const windowPoints = points.slice(startIdx, endIdx + 1);
  const startState = points[startIdx];
  const endState = points[endIdx];
  return evaluateWindowWithData(windowPoints, startState, endState, options);
}

/**
 * Evaluate a window given the already-sliced window points and states.
 * This avoids slicing overhead for the main optimizer loop.
 * @param {Array<{x,y,z}>} windowPoints
 * @param {Object} startState
 * @param {Object} endState
 * @param {Object} options
 * @returns {Object|null}
 */
function evaluateWindowSlice(windowPoints, startState, endState, options) {
  return evaluateWindowWithData(windowPoints, startState, endState, options);
}

/**
 * Compute sweep degrees for an arc from start to end.
 */
function computeSweepDegrees(start, end, circle, points) {
  const startA = Math.atan2(start.y - circle.center.y, start.x - circle.center.x);
  const endA = Math.atan2(end.y - circle.center.y, end.x - circle.center.x);
  const direction = determineArcDirection(start, end, points);
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
 * Determine arc direction (G2 or G3) based on the toolpath order.
 */
function determineArcDirection(start, end, points) {
  if (!points || points.length < 3) {
    return 'G2';
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
  return cross < 0 ? 'G3' : 'G2';
}

module.exports = {
  evaluateWindow,
  evaluateWindowSlice,
  computeSweepDegrees,
  determineArcDirection
};
