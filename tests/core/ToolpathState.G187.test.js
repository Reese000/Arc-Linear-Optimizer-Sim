const ToolpathState = require('../../src/core/ToolpathState');

describe('ToolpathState G187 Integration', () => {
  test('tracks G187 enabled flag', () => {
    const state = new ToolpathState();
    expect(state.g187Enabled).toBe(false);
    state.updateFromCommand({ G: [187] });
    expect(state.g187Enabled).toBe(true);
  });

  test('stores G187 P level and computes tolerance correctly (metric)', () => {
    const state = new ToolpathState();
    state.setting191 = 'MEDIUM'; // base 0.01mm
    state.updateFromCommand({ G: [21] });
    state.updateFromCommand({ G: [187], P: 1 }); // ROUGH ×10
    expect(state.g187Tolerance).toBeCloseTo(0.1, 5);
    expect(state.g187P).toBe(1);
  });

  test('G187 P-derived tolerance is independent of G20/G21 units', () => {
    const state = new ToolpathState();
    state.setting191 = 'MEDIUM'; // base 0.01mm
    // Inch mode
    state.updateFromCommand({ G: [20] });
    state.updateFromCommand({ G: [187], P: 3 }); // FINISH ×0.1 → 0.001mm
    expect(state.g187Tolerance).toBeCloseTo(0.001, 5);
    expect(state.g187P).toBe(3);
  });

  test('getEffectiveTolerance returns tighter of default and G187', () => {
    const state = new ToolpathState();
    state.g187Enabled = true;
    state.g187Tolerance = 0.05; // mm
    expect(state.getEffectiveTolerance(0.1)).toBe(0.05);
    expect(state.getEffectiveTolerance(0.01)).toBe(0.01);
  });

  test('G188 cancels G187', () => {
    const state = new ToolpathState();
    state.updateFromCommand({ G: [187], P: 0.01 });
    state.updateFromCommand({ G: [188] });
    expect(state.g187Enabled).toBe(false);
    expect(state.g187Tolerance).toBeNull();
  });
});
