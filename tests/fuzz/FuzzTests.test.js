const GCodeParser = require('../../src/core/GCodeParser');
const ArcFitter = require('../../src/core/ArcFitter');
const ToolpathState = require('../../src/core/ToolpathState');

describe('Fuzz Testing', () => {
  const random = (min, max) => Math.random() * (max - min) + min;
  const randomInt = (min, max) => Math.floor(random(min, max + 1));

  test('random simple toolpath does not crash', () => {
    const parser = new GCodeParser();
    const fitter = new ArcFitter(0.001);
    // Generate random G1 moves
    let content = 'G90\nG21\n';
    for (let i = 0; i < 100; i++) {
      const x = random(-100, 100);
      const y = random(-100, 100);
      const z = random(-10, 10);
      const f = random(50, 500);
      content += `G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z${z.toFixed(4)} F${f.toFixed(2)}\n`;
    }
    // Parse
    const parsed = parser.parseFileContent(content);
    expect(parsed.length).toBeGreaterThan(0);
    // Optimize
    const result = fitter.optimize(parsed);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('random extreme values do not crash', () => {
    const parser = new GCodeParser();
    const fitter = new ArcFitter(0.001);
    let content = 'G90\nG20\n'; // inches
    for (let i = 0; i < 50; i++) {
      const x = random(-1e6, 1e6);
      const y = random(-1e6, 1e6);
      content += `G1 X${x.toFixed(4)} Y${y.toFixed(4)}\n`;
    }
    const parsed = parser.parseFileContent(content);
    const result = fitter.optimize(parsed);
    expect(Array.isArray(result)).toBe(true);
  });

  test('random unit switches handled correctly', () => {
    const parser = new GCodeParser();
    const fitter = new ArcFitter(0.001);
    let content = 'G21\n';
    const numLines = 200;
    for (let i = 0; i < numLines; i++) {
      if (i % 50 === 0) {
        content += Math.random() > 0.5 ? 'G20\n' : 'G21\n';
      }
      const x = random(-50, 50);
      const y = random(-50, 50);
      content += `G1 X${x.toFixed(4)} Y${y.toFixed(4)}\n`;
    }
    const parsed = parser.parseFileContent(content);
    const result = fitter.optimize(parsed);
    expect(Array.isArray(result)).toBe(true);
  });

  test('random mixed commands do not crash', () => {
    const parser = new GCodeParser();
    const fitter = new ArcFitter(0.001);
    let content = 'G90\nG21\nM3 S1000\n';
    for (let i = 0; i < 50; i++) {
      const x = random(-20, 20);
      const y = random(-20, 20);
      content += `G1 X${x.toFixed(4)} Y${y.toFixed(4)}\n`;
      if (Math.random() < 0.1) {
        content += 'M5\n'; // occasional spindle stop
      }
    }
    content += 'M30\n';
    const parsed = parser.parseFileContent(content);
    const result = fitter.optimize(parsed);
    expect(Array.isArray(result)).toBe(true);
  });

  test('auto-tune with random multipliers does not crash', () => {
    const fitter = new ArcFitter(0.001);
    const points = [];
    const state = new ToolpathState();
    for (let i = 0; i < 50; i++) {
      const x = i * 0.1 + random(-0.01, 0.01);
      const y = Math.sin(i * 0.2) * 5 + random(-0.01, 0.01);
      state.updateFromCommand({ G: 21, X: x, Y: y });
      points.push({ cmd: { G: 1 }, state: state.clone() });
    }
    const result = fitter.optimizeAuto(points, { autoMultipliers: [0.5, 1.0], autoMaxSearches: [30, 50] });
    expect(Array.isArray(result)).toBe(true);
  });

  test('bidirectional fuzz', () => {
    const fitter = new ArcFitter(0.001, { bidirectional: true, maxSearch: 20 });
    const points = [];
    const state = new ToolpathState();
    for (let i = 0; i < 60; i++) {
      const x = i * 0.2;
      const y = Math.cos(i * 0.3) * 10;
      state.updateFromCommand({ G: 21, X: x, Y: y });
      points.push({ cmd: { G: 1 }, state: state.clone() });
    }
    const result = fitter.optimize(points);
    expect(Array.isArray(result)).toBe(true);
  });
});
