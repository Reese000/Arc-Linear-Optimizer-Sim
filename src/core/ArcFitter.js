const ArcOptimizer = require('./ArcOptimizer');
const ArcCommandGenerator = require('./ArcCommandGenerator');
const { fitCircle, fitCirclePratt, fitCircleRANSAC } = require('./evaluation/CircleFitter');

class ArcFitter {
  constructor(tolerance = 0.001, options = {}) {
    this.tolerance = tolerance;
    this.minArcRadius = options.minArcRadius || 0;
    this.maxArcRadius = options.maxArcRadius || Infinity;
    this.maxIJK = options.maxIJK || Infinity;
    this.precision = options.precision || 4;
    this.allowHelix = options.allowHelix || false;
    this.modalSuppression = options.modalSuppression || false;
    this.bidirectional = options.bidirectional || false;
    this.maxSearch = options.maxSearch || 50;
    this.useRANSAC = options.ransac || false;
  }

  optimize(pathData, options = {}) {
    const mergedOptions = {
      tolerance: this.tolerance,
      minArcRadius: this.minArcRadius,
      maxArcRadius: this.maxArcRadius,
      maxIJK: this.maxIJK,
      allowHelix: this.allowHelix,
      modalSuppression: this.modalSuppression,
      bidirectional: this.bidirectional,
      ransac: this.useRANSAC,
      maxSearch: this.maxSearch,
      precision: options.precision !== undefined ? options.precision : this.precision,
      isMetric: options.isMetric
    };

    const result = ArcOptimizer.optimize(pathData, mergedOptions);
    
    this.lastArcs = result.arcs;
    this.lastLinearsCount = result.stats.linearsCreated;
    this.originalLineCount = result.stats.originalLineCount;

    return result.lines;
  }

  createArcCommand(start, end, circle, precision = 4, gMode = null) {
    const isMetric = start.isMetric !== undefined ? start.isMetric : true;
    return ArcCommandGenerator.generateArcCommand(start, end, circle, precision, gMode, isMetric);
  }

  optimizeAuto(pathData, options = {}) {
    const result = this.optimize(pathData, options);
    this.lastAutoConfig = {
      tolerance: this.tolerance,
      ransac: this.useRANSAC,
      maxSearch: this.maxSearch
    };
    return result;
  }

  // Static compatibility methods

  static fitCircle(points) {
    return fitCircle(points);
  }

  static fitCirclePratt(points) {
    return fitCirclePratt(points);
  }

  static fitCircleRANSAC(points, tolerance = 0.001, maxIterations = 100) {
    return fitCircleRANSAC(points, tolerance, maxIterations);
  }

  static isWithinTolerance(points, circle, tolerance) {
    for (const p of points) {
      const dx = p.x - circle.center.x;
      const dy = p.y - circle.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(dist - circle.radius) > tolerance) {
        return false;
      }
    }
    return true;
  }

  static computeArcStats(arcs) {
    if (!arcs || arcs.length === 0) {
      return { count: 0, avgSweepDegrees: 0, maxSweepDegrees: 0, avgRadius: 0, radiusCV: 0, smallArcPct: 0, largeSweepPct: 0 };
    }
    const sweeps = arcs.map(a => a.sweepDegrees);
    const radii = arcs.map(a => a.circle.radius);
    const avgSweep = sweeps.reduce((a, b) => a + b, 0) / sweeps.length;
    const maxSweep = Math.max(...sweeps);
    const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    const smallCount = arcs.filter(a => a.sweepDegrees < 10).length;
    const largeCount = arcs.filter(a => a.sweepDegrees > 180).length;
    const radiusVariance = radii.reduce((sum, r) => sum + Math.pow(r - avgRadius, 2), 0) / radii.length;
    const radiusCV = Math.sqrt(radiusVariance) / (avgRadius || 1);
    return {
      count: arcs.length,
      avgSweepDegrees: avgSweep,
      maxSweepDegrees: maxSweep,
      avgRadius: avgRadius,
      radiusCV,
      smallArcPct: smallCount / arcs.length,
      largeSweepPct: largeCount / arcs.length
    };
  }

  static computeQualityScore(originalCount, arcs, linearsCount /*, tolerance */) {
    if (originalCount === 0) return 0;
    const optCount = arcs.length + linearsCount;
    const reduction = ((originalCount - optCount) / originalCount) * 100;
    // Compression score: scaled up to 100 at 66.67% reduction
    const compressionScore = Math.max(0, Math.min(100, reduction * 1.5));
    // Accuracy score: assumed perfect since arcs already verified during fitting
    const accuracyScore = 100;
    // Stability score based on arc statistics
    let stabilityScore = 80; // Default when no arcs
    if (arcs.length > 0) {
      const smallSweepCount = arcs.filter(a => a.sweepDegrees < 5).length;
      const largeSweepCount = arcs.filter(a => a.sweepDegrees > 180).length;
      const pctSmall = smallSweepCount / arcs.length;
      const pctLarge = largeSweepCount / arcs.length;
      const radii = arcs.map(a => a.circle.radius);
      const radiiMean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
      const radiiVariance = radii.reduce((sum, r) => sum + Math.pow(r - radiiMean, 2), 0) / radii.length;
      const cv = Math.sqrt(radiiVariance) / (radiiMean || 1);
      stabilityScore = Math.max(0, 100 - 40 * pctSmall - 20 * pctLarge - 15 * cv);
    }
    const finalScore = compressionScore * 0.6 + accuracyScore * 0.3 + stabilityScore * 0.1;
    return Math.round(finalScore);
  }
}

module.exports = ArcFitter;
