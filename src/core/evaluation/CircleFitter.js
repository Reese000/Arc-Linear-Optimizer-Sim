/**
 * CircleFitter: Circle fitting algorithms (Kåsa, Pratt, RANSAC).
 * Pure functions, no dependencies on ArcFitter.
 */
const { M_PI: PI } = Math;

/**
 * Kåsa method (simplified Least Squares)
 * @param {Array<{x,y}>} points
 * @returns {Object|null} - {center: {x,y}, radius}
 */
function fitCircle(points) {
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
 * Pratt's circle fit (geometric refinement of Kåsa)
 */
function fitCirclePratt(points) {
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
 * RANSAC robust circle fitting
 * @param {Array<{x,y}>} points
 * @param {number} tolerance - Inlier threshold
 * @param {number} maxIterations
 * @returns {Object|null} Best circle
 */
function fitCircleRANSAC(points, tolerance = 0.001, maxIterations = 100) {
  if (points.length < 3) return null;

  let bestCircle = null;
  let bestInliers = 0;

  // For speed, precompute point data as array for quick access
  const pts = points;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Sample 3 unique random points
    const idx1 = Math.floor(Math.random() * pts.length);
    let idx2 = Math.floor(Math.random() * pts.length);
    while (idx2 === idx1) idx2 = Math.floor(Math.random() * pts.length);
    let idx3 = Math.floor(Math.random() * pts.length);
    while (idx3 === idx1 || idx3 === idx2) idx3 = Math.floor(Math.random() * pts.length);

    const sample = [pts[idx1], pts[idx2], pts[idx3]];
    const circle = fitCircle(sample);
    if (!circle) continue;

    // Count inliers
    let inliers = 0;
    for (const p of pts) {
      const dx = p.x - circle.center.x;
      const dy = p.y - circle.center.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (Math.abs(dist - circle.radius) <= tolerance) {
        inliers++;
      }
    }

    if (inliers > bestInliers) {
      bestInliers = inliers;
      bestCircle = circle;
    }
  }

  if (!bestCircle) return null;

  // Optional: Refine using all inliers of best circle
  const inlierPoints = [];
  for (const p of pts) {
    const dx = p.x - bestCircle.center.x;
    const dy = p.y - bestCircle.center.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (Math.abs(dist - bestCircle.radius) <= tolerance) {
      inlierPoints.push(p);
    }
  }

  if (inlierPoints.length >= 3) {
    // Use Pratt refinement on inliers (more stable)
    return fitCirclePratt(inlierPoints);
  } else {
    return bestCircle;
  }
}

module.exports = {
  fitCircle,
  fitCirclePratt,
  fitCircleRANSAC
};
