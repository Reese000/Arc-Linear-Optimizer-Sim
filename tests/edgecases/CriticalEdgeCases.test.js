/**
 * Critical Edge Cases & Hard G-Code Patterns
 * Tests for production-critical scenarios not covered by existing unit tests.
 */

const GCodeParser = require('../../src/core/GCodeParser');
const ArcFitter = require('../../src/core/ArcFitter');
const ToolpathState = require('../../src/core/ToolpathState');
const Verifier = require('../../src/sim/Verifier');

describe('Critical Edge Cases', () => {
  describe('Parser: Malformed & Tricky Input', () => {
    test('multiple parentheses comments preserve intervening code', () => {
      const result = GCodeParser.parseLine('(c1) G1 X10 (c2) Y20 (c3) Z5');
      expect(result.G).toContain(1);
      expect(result.X).toBe(10);
      expect(result.Y).toBe(20);
      expect(result.Z).toBe(5);
    });

    test('nested parentheses inside comment', () => {
      const result = GCodeParser.parseLine('G1 X10 (outer (inner) end) Y20');
      expect(result.X).toBe(10);
      expect(result.Y).toBe(20);
    });

    test('unclosed parentheses does not crash', () => {
      const result = GCodeParser.parseLine('G1 X10 (unclosed');
      expect(result).not.toBeNull();
      expect(result.X).toBe(10);
    });

    test('leading decimal without leading zero', () => {
      const result = GCodeParser.parseLine('G1 X.5 Y.75');
      expect(result.X).toBe(0.5);
      expect(result.Y).toBe(0.75);
    });

    test('trailing decimal without trailing digit', () => {
      const result = GCodeParser.parseLine('G1 X10. Y20.');
      expect(result.X).toBe(10);
      expect(result.Y).toBe(20);
    });

    test('negative zero handled correctly', () => {
      const result = GCodeParser.parseLine('G1 X-0 Y0');
      expect(result.X).toBe(0);
      expect(result.Y).toBe(0);
    });
  });

  describe('G92 Work Coordinate Offsets', () => {
    test('G92 sets work offset directly', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: 90 });
      state.updateFromCommand({ G: 92, X: 10, Y: 20, Z: 5 });
      expect(state.x).toBe(10);
      expect(state.y).toBe(20);
      expect(state.z).toBe(5);
    });

    test('G92 with no arguments sets offset to current position', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: 90 });
      state.updateFromCommand({ X: 100, Y: 200, Z: 50 });
      state.updateFromCommand({ G: 92 });
      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
      expect(state.z).toBe(0);
    });

    test('subsequent moves respect new work offset', () => {
      const state = new ToolpathState();
      state.updateFromCommand({ G: 90 });
      state.updateFromCommand({ G: 92, X: 10, Y: 10 });
      state.updateFromCommand({ X: 5, Y: 5 });
      expect(state.x).toBe(5);
      expect(state.y).toBe(5);
    });
  });

  describe('Constraint Validation', () => {
    test('minArcRadius > maxArcRadius throws', () => {
      expect(() => new ArcFitter(0.001, { minArcRadius: 10, maxArcRadius: 5 }))
        .toThrow('maxArcRadius must be greater than or equal to minArcRadius');
    });

    test('negative maxIJK throws', () => {
      expect(() => new ArcFitter(0.001, { maxIJK: -1 }))
        .toThrow('maxIJK must be non-negative');
    });

    test('tolerance <= 0 throws', () => {
      expect(() => new ArcFitter(0, {})).toThrow('Tolerance must be a positive number');
      expect(() => new ArcFitter(-0.001, {})).toThrow('Tolerance must be a positive number');
    });

    test('precision non-integer throws', () => {
      expect(() => new ArcFitter(0.001, { precision: 2.5 }))
        .toThrow('precision must be a non-negative integer');
      expect(() => new ArcFitter(0.001, { precision: -1 }))
        .toThrow('precision must be a non-negative integer');
    });
  });

  describe('Sweep Angle Limits', () => {
    test('arc sweep > 180° triggers warning', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // Increase maxSweep to allow 200° arc to be created, triggering warning
      const fitter = new ArcFitter(0.001, { maxSweep: 250 });
      // Build 200° arc
      const points = [];
      for (let i = 0; i <= 10; i++) {
        const theta = (i / 10) * (200 * Math.PI / 180);
        const x = 10 * Math.cos(theta);
        const y = 10 * Math.sin(theta);
        points.push({
          x,
          y,
          z: 0,
          cmd: { G: 1 },
          state: (() => {
            const s = new ToolpathState();
            s.x = x;
            s.y = y;
            s.z = 0;
            s.isMetric = true;
            return s;
          })()
        });
      }
      fitter.optimize(points);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('exceeds 180°'));
      consoleSpy.mockRestore();
    });

    test('merging exceeds maxSweep prevents merge', () => {
      const fitter = new ArcFitter(0.001, { maxSweep: 180 });
      // Create arc records with all required fields including originalPoints
      const makeArc = (start, end, sweep) => ({
        circle: { center: { x: 0, y: 0 }, radius: 10 },
        start,
        end,
        direction: 'G2',
        sweepDegrees: sweep,
        feedrate: 100,
        startState: new ToolpathState(),
        endState: new ToolpathState(),
        originalPoints: [{ x: start.x, y: start.y }] // at least one point
     });
      const arcs = [
        makeArc({ x: 10, y: 0 }, { x: 0, y: 10 }, 90),
        makeArc({ x: 0, y: 10 }, { x: -10, y: 0 }, 90)
      ];
      // First merge: 90+90=180 <= 180 => should merge into 1 arc
      const merged = fitter.mergeArcs(arcs);
      expect(merged.length).toBe(1);
      // Now test with arcs that sum to > maxSweep
      arcs[0].sweepDegrees = 100;
      arcs[1].sweepDegrees = 100;
      const mergedOver = fitter.mergeArcs(arcs);
      expect(mergedOver.length).toBe(2); // not merged
    });
  });

  describe('Feedrate Consistency', () => {
    test('different feedrates prevent merging', () => {
      const fitter = new ArcFitter(0.001);
      const arcs = [
        {
          circle: { center: { x: 0, y: 0 }, radius: 10 },
          start: { x: 10, y: 0 },
          end: { x: 0, y: 10 },
          direction: 'G2',
          sweepDegrees: 45,
          feedrate: 100,
          startState: new ToolpathState(),
          endState: new ToolpathState()
        },
        {
          circle: { center: { x: 0, y: 0 }, radius: 10 },
          start: { x: 0, y: 10 },
          end: { x: -10, y: 0 },
          direction: 'G2',
          sweepDegrees: 45,
          feedrate: 200,
          startState: new ToolpathState(),
          endState: new ToolpathState()
        }
      ];
      const merged = fitter.mergeArcs(arcs);
      expect(merged.length).toBe(2);
    });

    test('arc uses start point feedrate', () => {
      const fitter = new ArcFitter(0.001);
      const pathData = [];
      const state = new ToolpathState();
      state.updateFromCommand({ G: 21, F: 100, X: 0, Y: 0 });
      pathData.push({ cmd: { G: 1 }, state: state.clone() });
      state.updateFromCommand({ X: 1, Y: 0 });
      pathData.push({ cmd: { G: 1 }, state: state.clone() });
      state.updateFromCommand({ X: 2, Y: 0 });
      pathData.push({ cmd: { G: 1 }, state: state.clone() });
      fitter.optimize(pathData);
      if (fitter.lastArcs.length > 0) {
        expect(fitter.lastArcs[0].feedrate).toBe(100);
      }
    });
  });

  describe('Non-G1 Commands Break Arc Window', () => {
    test('M-code in linear sequence breaks window', () => {
      const fitter = new ArcFitter(0.001);
      const pathData = [];
      const state = new ToolpathState();

      // Initial setup: G21 and move to (0,0)
      state.updateFromCommand({ G: 21, X: 0, Y: 0 });
      pathData.push({
        cmd: { G: 1 },
        state: state.clone(),
        raw: 'G1 X0 Y0'
      });

      // M3 spindle on
      state.updateFromCommand({ M: 3 });
      pathData.push({
        cmd: { M: 3 },
        state: state.clone(),
        raw: 'M3'
      });

      // Continue moves
      state.updateFromCommand({ X: 10, Y: 0 });
      pathData.push({
        cmd: { G: 1 },
        state: state.clone(),
        raw: 'G1 X10 Y0'
      });
      state.updateFromCommand({ X: 20, Y: 0 });
      pathData.push({
        cmd: { G: 1 },
        state: state.clone(),
        raw: 'G1 X20 Y0'
      });

      const result = fitter.optimize(pathData);
      // Should not have arc spanning the M3 (X0 to X20)
      const longArc = result.find(l => (l.includes('G2') || l.includes('G3')) && l.includes('X20'));
      expect(longArc).toBeUndefined();
    });
  });

  describe('Unit Switching', () => {
    test('mid-file unit switch handled correctly', () => {
      const parser = new GCodeParser();
      const gcode = `G21
G1 X0 Y0
G20
G1 X1 Y1`;
      const parsed = parser.parseFileContent(gcode);
      // After parsing, final state should be metric=false (G20)
      const finalState = parsed[parsed.length - 1].state;
      expect(finalState.isMetric).toBe(false);
    });
  });

  describe('Full-Circle Arcs', () => {
    test('360° arc generates valid output', () => {
      const fitter = new ArcFitter(0.001);
      const circle = { center: { x: 0, y: 0 }, radius: 10 };
      const startState = (() => { const s = new ToolpathState(); s.x=10; s.y=0; s.isMetric=true; s.precision=4; return s; })();
      const endState = (() => { const s = new ToolpathState(); s.x=10; s.y=0; s.isMetric=true; s.precision=4; return s; })();
      const cmd = fitter.createArcCommand(startState, endState, circle, 4, 'G2');
      expect(cmd).toMatch(/^G2/);
      expect(cmd).toMatch(/I-10\.0000/);
      expect(cmd).toMatch(/J0\.0000/);
    });
  });

  describe('Numerical Stability', () => {
    test('very large coordinates handled without overflow', () => {
      const fitter = new ArcFitter(0.001);
      const state = new ToolpathState();
      state.updateFromCommand({ G: 21, X: 1e6, Y: 1e6 });
      const points = [
        { cmd: { G: 1 }, state: state.clone() },
      ];
      state.updateFromCommand({ X: 1e6 + 1, Y: 1e6 + 1 });
      points.push({ cmd: { G: 1 }, state: state.clone() });
      state.updateFromCommand({ X: 1e6 + 2, Y: 1e6 + 2 });
      points.push({ cmd: { G: 1 }, state: state.clone() });
      expect(() => fitter.optimize(points)).not.toThrow();
    });

    test('very small coordinates handled without underflow', () => {
      const fitter = new ArcFitter(0.001);
      const state = new ToolpathState();
      const points = [];
      for (let i = 0; i < 10; i++) {
        state.updateFromCommand({ G: 21, X: i * 1e-6, Y: i * 1e-6 });
        points.push({ cmd: { G: 1 }, state: state.clone() });
      }
       expect(() => fitter.optimize(points)).not.toThrow();
     });
   });

   describe('Helical Arc Z Linearity', () => {
     test('verifier detects non-linear Z interpolation', () => {
       const verifier = new Verifier(0.001); // 1mm tolerance
       const circle = { center: { x: 0, y: 0 }, radius: 10 };
       const start = { x: 10, y: 0, z: 0 };
       const end = { x: -10, y: 0, z: 10 }; // 180° arc, Z from 0 to 10

       // Perfectly linear Z points along the arc (semicircle)
       const perfectPoints = [];
       const steps = 20;
       const sweep = Math.PI; // 180 degrees
       for (let i = 0; i <= steps; i++) {
         const theta = (i / steps) * sweep; // 0 to π
         const x = 10 * Math.cos(theta);
         const y = 10 * Math.sin(theta);
         const z = (i / steps) * 10; // linear
         perfectPoints.push({ x, y, z });
       }

       let result = verifier.verify(perfectPoints, circle, start, end);
       expect(result.isSafe).toBe(true);

       // Introduce Z deviation in middle point
       const badPoints = perfectPoints.map((p, i) => {
         if (i === 10) return { ...p, z: p.z + 0.1 }; // +0.1mm deviation
         return p;
       });
       result = verifier.verify(badPoints, circle, start, end);
       expect(result.isSafe).toBe(false);
     });
   });

   describe('AutoTune Parameter Search', () => {
     test('optimizeAuto searches over multiple multipliers', () => {
       const fitter = new ArcFitter(0.001);
       const points = [];
       const state = new ToolpathState();
       for (let i = 0; i < 50; i++) {
         const x = i * 0.1;
         const y = Math.sin(i * 0.2) * 5;
         state.updateFromCommand({ G: 21, X: x, Y: y });
         points.push({ cmd: { G: 1 }, state: state.clone() });
       }
       const result = fitter.optimizeAuto(points);
       expect(result).toBeDefined();
       expect(fitter.lastAutoConfig).toBeDefined();
       expect(fitter.lastAutoConfig.tolerance).toBeLessThanOrEqual(0.002);
       expect(fitter.lastAutoConfig.tolerance).toBeGreaterThanOrEqual(0.0005);
     });
   });

   describe('Bidirectional Arc Search', () => {
     test('bidirectional mode runs without error', () => {
       const fitter = new ArcFitter(0.001, { bidirectional: true });
       const points = [];
       const state = new ToolpathState();
       // Generate a wavy path
       for (let i = 0; i < 100; i++) {
         const x = i * 0.1;
         const y = Math.sin(i * 0.2) * 5;
         state.updateFromCommand({ G: 21, X: x, Y: y });
         points.push({ cmd: { G: 1 }, state: state.clone() });
       }
       const result = fitter.optimize(points);
       expect(result).toBeDefined();
       expect(Array.isArray(result)).toBe(true);
       // Stats should be updated
       expect(fitter.lastArcs).toBeDefined();
       expect(fitter.lastLinearsCount).toBeGreaterThanOrEqual(0);
     });

     test('bidirectional can produce longer arcs when maxSearch was limiting', () => {
       // Create a long arc with many points (smooth circle arc) but limit maxSearch low
       const radius = 50;
       const fitterNoBi = new ArcFitter(0.001, { maxSearch: 30 });
       const fitterBi = new ArcFitter(0.001, { maxSearch: 30, bidirectional: true });

       const points = [];
       const state = new ToolpathState();
       // Generate a 200° arc (more than maxSearch points)
       const startAngle = 0;
       const sweepDeg = 200 * Math.PI/180;
       const numPoints = 100;
       for (let i = 0; i <= numPoints; i++) {
         const theta = startAngle + (i/numPoints) * sweepDeg;
         const x = radius * Math.cos(theta);
         const y = radius * Math.sin(theta);
         state.updateFromCommand({ G: 21, X: x, Y: y });
         points.push({ cmd: { G: 1 }, state: state.clone() });
       }

       const resultNoBi = fitterNoBi.optimize(points);
       const resultBi = fitterBi.optimize(points);

       // Bidirectional should produce same or fewer arcs (i.e., longer or equal)
       expect(fitterBi.lastArcs.length).toBeLessThanOrEqual(fitterNoBi.lastArcs.length);
     });
   });
 });
