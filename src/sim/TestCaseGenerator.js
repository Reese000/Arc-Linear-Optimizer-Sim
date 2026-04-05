/**
 * TestCaseGenerator: Creates synthetic G-code toolpaths for testing the Arc-Linear Optimizer.
 * Supports generating ground truth geometries (Circles, Spirals) and applying degradation filters.
 */
class TestCaseGenerator {
  constructor(precision = 4) {
    this.precision = precision;
  }

  /**
   * Generates a circular toolpath as a series of G1 segments.
   * @param {number} centerX - Circle center X
   * @param {number} centerY - Circle center Y
   * @param {number} radius - Circle radius
   * @param {number} segments - Number of line segments to approximate the circle
   * @param {Object} options - {seed, jitter, driftAmplitude, driftFrequency, stepJitter, z}
   * @returns {Object} - {groundTruth, degraded, gcode}
   */
  generateCircle(centerX, centerY, radius, segments, options = {}) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * 2 * Math.PI;
        points.push({
            x: centerX + radius * Math.cos(theta),
            y: centerY + radius * Math.sin(theta),
            z: options.z || 0
        });
    }
    return this.applyDegradation(points, options);
  }

  /**
   * Generates an Archimedean spiral.
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} startRadius
   * @param {number} endRadius
   * @param {number} turns - Number of spiral turns
   * @param {number} segments - Number of points
   * @param {Object} options
   * @returns {Object}
   */
  generateSpiral(centerX, centerY, startRadius, endRadius, turns, segments, options = {}) {
    const points = [];
    const totalTheta = turns * 2 * Math.PI;
    for (let i = 0; i <= segments; i++) {
        const fraction = i / segments;
        const theta = fraction * totalTheta;
        const radius = startRadius + (endRadius - startRadius) * fraction;
        points.push({
            x: centerX + radius * Math.cos(theta),
            y: centerY + radius * Math.sin(theta),
            z: options.z || 0
        });
    }
    return this.applyDegradation(points, options);
  }

  /**
   * Generates a sinusoidal S-Curve path.
   * @param {Object} options - {length, amplitude, wavelength, segments, seed, jitter}
   * @returns {Object}
   */
  generateSCurve(options = {}) {
    const length = options.length || 50;
    const amplitude = options.amplitude || 5;
    const wavelength = options.wavelength || 25;
    const segments = options.segments || 200;

    let groundTruth = [];
    for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * length;
        const y = amplitude * Math.sin((2 * Math.PI * x) / wavelength);
        groundTruth.push({ x, y, z: 0 });
    }
    return this.applyDegradation(groundTruth, options);
  }

  /**
   * Generates a "Zig-Zag" serrated path (Line String).
   * @param {Object} options - {length, width, count, seed, jitter}
   * @returns {Object}
   */
  generateZigZag(options = {}) {
    const length = options.length || 50;
    const width = options.width || 5;
    const count = options.count || 20;

    let groundTruth = [];
    for (let i = 0; i <= count * 2; i++) {
        const x = (i / (count * 2)) * length;
        const y = (i % 2 === 0) ? -width / 2 : width / 2;
        groundTruth.push({ x, y, z: 0 });
    }
    // High-density tessellation for the zig-zag
    const highRes = [];
    for (let i = 0; i < groundTruth.length - 1; i++) {
        const p1 = groundTruth[i];
        const p2 = groundTruth[i+1];
        for (let j = 0; j < 10; j++) {
            highRes.push({
                x: p1.x + (p2.x - p1.x) * (j / 10),
                y: p1.y + (p2.y - p1.y) * (j / 10),
                z: 0
            });
        }
    }
    return this.applyDegradation(highRes, options);
  }

  /**
   * Applies realistic degradation to a set of high-res points.
   * Includes jitter (high-frequency noise), drift (low-frequency bias), rounding, and step variation.
   * @param {Array} points - Array of {x, y, z}
   * @param {Object} options - {seed, jitter, driftAmplitude, driftFrequency, stepJitter}
   * @returns {Object} - {groundTruth, degraded, gcode}
   */
  applyDegradation(points, options = {}) {
    let degraded = [];

    // Simple seedable RNG (LCG)
    let seedValue = options.seed || Math.floor(Math.random() * 1000000);
    const random = () => {
        seedValue = (seedValue * 1664525 + 1013904223) % 4294967296;
        return seedValue / 4294967296;
    };

    // Non-uniform jitter params (Vibration vs Drift)
    const driftAmp = options.driftAmplitude || 0;
    const driftFreq = options.driftFrequency || 0.05;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let newP = { ...p };

        // 1. High-frequency Jitter (Vibration)
        if (options.jitter) {
            newP.x += (random() - 0.5) * options.jitter;
            newP.y += (random() - 0.5) * options.jitter;
        }

        // 2. Low-frequency Jitter (Drift / Systematic bias)
        if (driftAmp > 0) {
            newP.x += Math.sin(i * driftFreq) * driftAmp;
            newP.y += Math.cos(i * driftFreq) * driftAmp;
        }

        // 2. Rounding (Simulating controller floating point limits)
        newP.x = parseFloat(newP.x.toFixed(this.precision));
        newP.y = parseFloat(newP.y.toFixed(this.precision));

        // 3. Step Variation (Thinning the data randomly)
        if (options.stepJitter && i > 0 && i < points.length - 1) {
            if (Math.random() < options.stepJitter) continue;
        }

        degraded.push(newP);
    }

    return {
        groundTruth: points,
        degraded: degraded,
        gcode: this.pointsToGcode(degraded)
    };
  }

  /**
   * Converts an array of points to G-code (G21, G90, G0 to start, then G1 moves).
   * @param {Array} points - Array of {x, y, z}
   * @returns {string} - G-code string
   */
  pointsToGcode(points, options = {}) {
    if (!Array.isArray(points) || points.length === 0) {
        console.error('pointsToGcode: invalid points array', { pointsLength: points ? points.length : 'null/undefined', firstItem: points ? points[0] : 'N/A' });
        return "";
    }
    const first = points[0];
    if (!first) {
        console.error('pointsToGcode: first point is undefined', { pointsLength: points.length });
        return "";
    }
    const lines = ["G21", "G90", "F1000", "G0 X" + first.x + " Y" + first.y];
    for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (!p) continue; // skip any undefined entries
        lines.push(`G1 X${p.x.toFixed(this.precision)} Y${p.y.toFixed(this.precision)}`);
    }
    if (options.addReturn) {
        // Add rapid return to safe Z and then to X0 Y0 to simulate program end or tool change
        lines.push("G0 Z5", "G0 X0 Y0");
    }
    return lines.join("\n");
  }

  /**
   * Generates a multi-pass program with rapid transitions between separate toolpaths.
   * This simulates a real NC program with multiple operations.
   * @param {Array} subPaths - Array of point arrays (each sub-path)
   * @param {Object} options - { safeZ, returnHome }
   * @returns {string} G-code
   */
  generateProgram(subPaths, options = {}) {
    const lines = ["G21", "G90", "F1000"];
    const safeZ = options.safeZ || 5;
    const returnHome = options.returnHome !== undefined ? options.returnHome : true;
    for (let p = 0; p < subPaths.length; p++) {
        const points = subPaths[p];
        if (!points || points.length === 0) continue;
        // Rapid to start of this sub-path (after safe Z if not first)
        if (p > 0) {
            lines.push(`G0 Z${safeZ}`);
        }
        lines.push(`G0 X${points[0].x} Y${points[0].y}`);
        // Feed through the sub-path
        for (let i = 1; i < points.length; i++) {
            lines.push(`G1 X${points[i].x.toFixed(this.precision)} Y${points[i].y.toFixed(this.precision)}`);
        }
    }
    if (returnHome) {
        lines.push("G0 Z5", "G0 X0 Y0", "M30");
    }
    return lines.join("\n");
  }
}

module.exports = TestCaseGenerator;
