const ToolpathState = require('../../src/core/ToolpathState');

describe('ToolpathState G187 Integration', () => {
  test('tracks G187 enabled flag', () => {
    const state = new ToolpathState();
    expect(state.g187Enabled).toBe(false);
    state.updateFromCommand({ G: [187] });
    expect(state.g187Enabled).toBe(true);
  });

  test('stores G187 P parameter in correct units (mm)', () => {
    const state = new ToolpathState();
    // G21 metric
    state.updateFromCommand({ G: [21] });
    state.updateFromCommand({ G: [187], P: 0.01 });
    expect(state.g187Tolerance).toBe(0.01);
    expect(state.g187P).toBe(0.01);
  });

  test('converts G187 P to mm when in inch mode (G20)', () => {
    const state = new ToolpathState();
    state.updateFromCommand({ G: [20] });
    state.updateFromCommand({ G: [187], P: 0.001 });
    // 0.001" = 0.0254 mm
    expect(state.g187Tolerance).toBeCloseTo(0.0254, 5);
    expect(state.g187P).toBe(0.001);
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
