const GeometryUtils = require('../../src/core/GeometryUtils');

describe('GeometryUtils', () => {
  describe('estimateSegments', () => {
    test('returns at least 3 segments', () => {
      expect(GeometryUtils.estimateSegments(10, 0.1, 0.001)).toBeGreaterThanOrEqual(3);
    });

    test('larger radius requires more segments for same tolerance', () => {
      const smallRadius = 1;
      const largeRadius = 100;
      const segsSmall = GeometryUtils.estimateSegments(smallRadius, Math.PI, 0.01);
      const segsLarge = GeometryUtils.estimateSegments(largeRadius, Math.PI, 0.01);
      expect(segsLarge).toBeGreaterThan(segsSmall);
    });

    test('tighter tolerance yields more segments', () => {
      const radius = 10;
      const sweep = Math.PI;
      const loose = GeometryUtils.estimateSegments(radius, sweep, 0.1);
      const tight = GeometryUtils.estimateSegments(radius, sweep, 0.001);
      expect(tight).toBeGreaterThan(loose);
    });
  });

  describe('chordalError', () => {
    test('computes correct chordal deviation for small angles', () => {
      const radius = 10;
      const angle = 0.1; // rad
      const error = GeometryUtils.chordalError(radius, angle);
      // Approx formula: r*(1-cos(theta/2))
      const expected = radius * (1 - Math.cos(angle/2));
      expect(error).toBeCloseTo(expected, 5);
    });

    test('zero radius gives zero error', () => {
      expect(GeometryUtils.chordalError(0, 1)).toBe(0);
    });
  });

  describe('maxStepAngleForTolerance', () => {
    test('inverse of chordalError approx', () => {
      const radius = 10;
      const tolerance = 0.001;
      const maxStep = GeometryUtils.maxStepAngleForTolerance(radius, tolerance);
      const computedError = GeometryUtils.chordalError(radius, maxStep);
      // Should be <= tolerance
      expect(computedError).toBeLessThanOrEqual(tolerance * 1.1); // allow small margin
    });
  });

  describe('arcLength and chordLength', () => {
    test('computes arc length correctly', () => {
      expect(GeometryUtils.arcLength(10, Math.PI)).toBeCloseTo(10 * Math.PI);
    });

    test('computes chord length correctly', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 3, y: 4 };
      expect(GeometryUtils.chordLength(start, end)).toBe(5);
    });
  });
});
