const ArcFitter = require('../../src/core/ArcFitter');

describe('ArcFitter RANSAC', () => {
  test('fitCircleRANSAC returns circle with inliers property', () => {
    // Perfect circle points
    const points = [];
    for (let i = 0; i < 20; i++) {
      const theta = (i / 20) * 2 * Math.PI;
      points.push({ x: 10 * Math.cos(theta), y: 10 * Math.sin(theta) });
    }

    const circle = ArcFitter.fitCircleRANSAC(points, 0.001, 50);
    expect(circle).not.toBeNull();
    expect(circle.center).toBeDefined();
    expect(circle.radius).toBeDefined();
    expect(circle.inliers).toBeDefined();
    expect(circle.inliers).toBeGreaterThanOrEqual(3);
  });

  test('fitCircleRANSAC handles outliers better than Kåasa', () => {
    // Circle with 30% outliers
    const points = [];
    // Inliers: circle radius 10
    for (let i = 0; i < 50; i++) {
      const theta = (i / 50) * 2 * Math.PI;
      points.push({ x: 10 * Math.cos(theta), y: 10 * Math.sin(theta) });
    }
    // Outliers: random positions far from circle
    for (let i = 0; i < 20; i++) {
      points.push({ x: Math.random() * 100 - 50, y: Math.random() * 100 - 50 });
    }

    const kasa = ArcFitter.fitCircle(points);
    const ransac = ArcFitter.fitCircleRANSAC(points, 0.1, 100);

    // RANSAC should recover radius closer to 10
    expect(ransac).not.toBeNull();
    expect(Math.abs(ransac.radius - 10)).toBeLessThan(Math.abs(kasa.radius - 10));
  });

  test('fitCircleRANSAC returns null for insufficient points', () => {
    expect(ArcFitter.fitCircleRANSAC([], 0.001)).toBeNull();
    expect(ArcFitter.fitCircleRANSAC([{x:0,y:0}], 0.001)).toBeNull();
    expect(ArcFitter.fitCircleRANSAC([{x:0,y:0},{x:1,y:1}], 0.001)).toBeNull();
  });
});
