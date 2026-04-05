const ArcFitter = require('../../src/core/ArcFitter');
const ToolpathState = require('../../src/core/ToolpathState');

describe('ArcFitter', () => {
  let fitter;

  beforeEach(() => {
    fitter = new ArcFitter(0.001); // 0.001" tolerance
  });

  describe('fitCircle (static)', () => {
    test('fits a circle to 3 perfect semicircle points', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 }
      ];
      const circle = ArcFitter.fitCircle(points);
      
      expect(circle).not.toBeNull();
      expect(circle.center.x).toBeCloseTo(1, 3);
      expect(circle.center.y).toBeCloseTo(0, 3);
      expect(circle.radius).toBeCloseTo(1, 3);
    });

    test('fits a circle to perfect circle points', () => {
      const points = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 }
      ];
      const circle = ArcFitter.fitCircle(points);
      
      expect(circle).not.toBeNull();
      expect(circle.center.x).toBeCloseTo(0, 5);
      expect(circle.center.y).toBeCloseTo(0, 5);
      expect(circle.radius).toBeCloseTo(1, 5);
    });

    test('returns null for less than 3 points', () => {
      const points1 = [{ x: 0, y: 0 }];
      const points2 = [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ];
      
      expect(ArcFitter.fitCircle(points1)).toBeNull();
      expect(ArcFitter.fitCircle(points2)).toBeNull();
    });

    test('handles collinear points gracefully', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ];
      const circle = ArcFitter.fitCircle(points);
      expect(circle).toBeNull();
    });
  });

  describe('isWithinTolerance (static)', () => {
    const circle = { center: { x: 0, y: 0 }, radius: 5 };

    test('returns true for points on circle', () => {
      const points = [
        { x: 5, y: 0 },
        { x: 0, y: 5 },
        { x: -5, y: 0 },
        { x: 0, y: -5 }
      ];
      expect(ArcFitter.isWithinTolerance(points, circle, 0.001)).toBe(true);
    });

    test('returns false for points outside tolerance', () => {
      const points = [
        { x: 5, y: 0 },
        { x: 5.1, y: 0 } // 0.1 beyond radius (5.0 vs 5.1)
      ];
      expect(ArcFitter.isWithinTolerance(points, circle, 0.05)).toBe(false);
    });

    test('passes when all points within tolerance', () => {
      const points = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * 2 * Math.PI;
        points.push({
          x: 5 * Math.cos(angle) + 0.0005,
          y: 5 * Math.sin(angle) + 0.0005
        });
      }
      expect(ArcFitter.isWithinTolerance(points, circle, 0.001)).toBe(true);
    });
  });

  describe('optimize', () => {
    const createState = (x, y, z = 0) => {
      const state = new ToolpathState();
      state.x = x;
      state.y = y;
      state.z = z;
      return state;
    };

    test('handles empty input', () => {
      const result = fitter.optimize([]);
      expect(result).toEqual([]);
    });

    test('passes through non-linear commands unchanged', () => {
      const pathData = [
        { raw: 'G0 X0 Y0', cmd: { G: [0] }, state: createState(0, 0) },
        { raw: 'M3 S1000', cmd: { M: 3, S: 1000 }, state: createState(0, 0) },
        { raw: 'G1 X10 Y20', cmd: { G: [1] }, state: createState(10, 20) }
      ];
      
      const result = fitter.optimize(pathData);
      expect(result).toEqual(['G0 X0 Y0', 'M3 S1000', 'G1 X10 Y20']);
    });

    test('handles single G1 as single value (bug fix test)', () => {
      const pathData = [
        { raw: 'G1 X0 Y0', cmd: { G: 1 }, state: createState(0, 0) },
        { raw: 'G1 X10 Y0', cmd: { G: 1 }, state: createState(10, 0) },
        { raw: 'G1 X10 Y10', cmd: { G: 1 }, state: createState(10, 10) }
      ];
      
      const result = fitter.optimize(pathData);
      // Should detect an arc fit for these 3 points
      expect(result.length).toBe(1);
      expect(result[0]).toMatch(/^G[23] X10\.0000 Y10\.0000 I/);
    });

    test('handles single G1 as array', () => {
      const pathData = [
        { raw: 'G1 X0 Y0', cmd: { G: [1] }, state: createState(0, 0) },
        { raw: 'G1 X10 Y0', cmd: { G: [1] }, state: createState(10, 0) },
        { raw: 'G1 X10 Y10', cmd: { G: [1] }, state: createState(10, 10) }
      ];
      
      const result = fitter.optimize(pathData);
      expect(result.length).toBe(1);
      expect(result[0]).toMatch(/^G[23] X10\.0000 Y10\.0000 I/);
    });

    test('combines multiple G1s into arc when within tolerance', () => {
      // Three points on a perfect circle centered at (0,0) radius 10
      const pathData = [
        { raw: 'G1 X10 Y0', cmd: { G: 1 }, state: createState(10, 0) },
        { raw: 'G1 X5 Y8.6603', cmd: { G: 1 }, state: createState(5, 8.6603) },
        { raw: 'G1 X0 Y10', cmd: { G: 1 }, state: createState(0, 10) }
      ];
      
      const result = fitter.optimize(pathData);
      // Should be replaced with a single arc (G2 or G3)
      expect(result.length).toBe(1);
       // Center at (0,0), so I = -10, J = 0 for start point (10,0)
       // Allow small floating point tolerance
       expect(result[0]).toMatch(/^G[23] X0\.0000 Y10\.0000 I-/);
        expect(result[0]).toMatch(/J0\.000[0-1]$/);
    });

    test('does not combine linear segments if Z changes', () => {
      const pathData = [
        { raw: 'G1 X0 Y0 Z0', cmd: { G: 1 }, state: createState(0, 0, 0) },
        { raw: 'G1 X10 Y0 Z0', cmd: { G: 1 }, state: createState(10, 0, 0) },
        { raw: 'G1 X10 Y10 Z5', cmd: { G: 1 }, state: createState(10, 10, 5) } // Z changed
      ];
      
      const result = fitter.optimize(pathData);
      // Only first two can be combined, but with only 2 points not enough for arc
      expect(result.length).toBe(3);
    });

    test('respects tolerance setting', () => {
      const fitterLoose = new ArcFitter(0.1);
      const fitterTight = new ArcFitter(0.0001);
      
      // Generate points that are a circle with small noise
      const points = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI / 2;
        const x = 10 * Math.cos(angle) + (i === 5 ? 0.05 : 0); // One point deviates 0.05
        const y = 10 * Math.sin(angle);
        points.push({ x, y });
      }
      
      // Build pathData manually
      const pathData = points.map(p => ({
        raw: `G1 X${p.x.toFixed(4)} Y${p.y.toFixed(4)}`,
        cmd: { G: 1 },
        state: createState(p.x, p.y)
      }));
      
      const resultLoose = fitterLoose.optimize(pathData);
      const resultTight = fitterTight.optimize(pathData);
      
      // Loose tolerance should produce fewer lines (arc fits)
      expect(resultLoose.length).toBeLessThanOrEqual(resultTight.length);
    });

    test('does not create arcs with only 2 points', () => {
      const pathData = [
        { raw: 'G1 X0 Y0', cmd: { G: 1 }, state: createState(0, 0) },
        { raw: 'G1 X10 Y0', cmd: { G: 1 }, state: createState(10, 0) }
      ];
      
      const result = fitter.optimize(pathData);
      expect(result).toEqual(['G1 X0 Y0', 'G1 X10 Y0']);
    });

    test('skips lines with no G code after arc', () => {
      const pathData = [
        { raw: 'G1 X0 Y0', cmd: { G: 1 }, state: createState(0, 0) },
        { raw: 'M3 S1000', cmd: { M: 3, S: 1000 }, state: createState(0, 0) },
        { raw: 'G1 X10 Y10', cmd: { G: 1 }, state: createState(10, 10) }
      ];
      
      const result = fitter.optimize(pathData);
      expect(result.length).toBe(3);
    });
  });

  describe('createArcCommand', () => {
    test('generates G2 command for clockwise arc', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 0, y: 10 };
      const circle = { center: { x: -10, y: 0 }, radius: 10 };
      
      const cmd = fitter.createArcCommand(start, end, circle);
      expect(cmd).toMatch(/^G2 X0\.0000 Y10\.0000 I-10\.0000 J0\.0000$/);
    });

    test('generates G3 command for counterclockwise arc', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 0, y: 10 };
      const circle = { center: { x: 10, y: 0 }, radius: 10 };
      
      const cmd = fitter.createArcCommand(start, end, circle);
      expect(cmd).toMatch(/^G3 X0\.0000 Y10\.0000 I10\.0000 J0\.0000$/);
    });

    test('formats coordinates to 4 decimal places', () => {
      const start = { x: 1.123456, y: 2.987654 };
      const end = { x: 11.123456, y: 12.987654 };
      const circle = { center: { x: 6.123456, y: 7.987654 }, radius: 7.2111 };
      
      const cmd = fitter.createArcCommand(start, end, circle);
       expect(cmd).toMatch(/X11\.123[45] Y12\.987[567]/);
      expect(cmd).toMatch(/I5\.0000 J5\.0000/);
    });

    test('converts coordinates to inches when isMetric=false', () => {
      const start = { x: 0, y: 0, isMetric: false, precision: 4 };
      const end = { x: 25.4, y: 0, z: 0 };
      const circle = { center: { x: 12.7, y: -12.7 }, radius: 17.9608 };
      const cmd = fitter.createArcCommand(start, end, circle, undefined, 'G2');
      // 25.4 mm = 1 inch, 12.7 mm = 0.5 inches
      expect(cmd).toBe('G2 X1.0000 Y0.0000 I0.5000 J-0.5000');
    });

    test('uses state precision when provided', () => {
      const start = { x: 0, y: 0, isMetric: true, precision: 3 };
      const end = { x: 1.23456789, y: 2.3456789 };
      const circle = { center: { x: 0.617283945, y: 1.23456789 }, radius: 1 };
      const cmd = fitter.createArcCommand(start, end, circle);
      // Should use 3 decimal places
      expect(cmd).toMatch(/X1\.235 Y2\.346/);
      expect(cmd).toMatch(/I0\.617 J1\.235/);
    });
  });
});
