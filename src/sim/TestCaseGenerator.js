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
   */
  generateSpiral(centerX, centerY, startRadius, endRadius, turns, segments, options = {}) {
    const points = [];
    const totalTheta = turns * 2 * Math.PI;
    for (let i = 0; i <= segments; i++) {
        const fraction = i / segments;
        const theta = fraction * totalTheta;
        const radius = startRadius + (endRadius - startRadius) * fraction;
        groundTruth.push({
            x: centerX + radius * Math.cos(theta),
            y: centerY + radius * Math.sin(theta),
            z: options.z || 0
        });
    }
    return this.applyDegradation(groundTruth, options);
  }

  /**
   * Generates a sinusoidal S-Curve path.
   * @param {Object} options - {length, amplitude, wavelength, segments}
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
   * @param {Object} options - {length, width, count}
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

  pointsToGcode(points) {
    const lines = ["G21", "G90", "F1000", "G0 X" + points[0].x + " Y" + points[0].y];
    for (let i = 1; i < points.length; i++) {
        lines.push(`G1 X${points[i].x.toFixed(this.precision)} Y${points[i].y.toFixed(this.precision)}`);
    }
    return lines.join("\n");
  }
}

module.exports = TestCaseGenerator;
