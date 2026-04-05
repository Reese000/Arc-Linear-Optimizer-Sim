/**
 * Tracks the modal state of the CNC machine during G-code processing.
 * Handles unit conversions (G20/G21), absolute/incremental moves (G90/G91),
 * comprehensive G187 (Accuracy Control) with P (smoothness) and E (corner rounding),
 * and special commands (G10, G28, G92 variants).
 */
class ToolpathState {
  // Smoothness level to tolerance mapping (in mm)
  static SMOOTHNESS_MAP = {
    'ROUGH': 0.05,
    'MEDIUM': 0.01,
    'FINISH': 0.001
  };

  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.feedrate = 0;
    this.isMetric = true; // Default to metric (G21)
    this.isAbsolute = true; // Default to absolute (G90)
    this.modalGroup1 = 'G0'; // Default G-motion group
    this.precision = 4; // Haas standard decimal places (usually 4 for inch, 3 for metric)

    // Machine/controller settings
    this.setting191 = 'MEDIUM'; // Default smoothness when G187 not active
    this.setting85 = 0.01;      // Default corner rounding in mm

    // G187 state
    this.g187Enabled = false;
    this.g187P = null;     // 1, 2, or 3 (smoothness level); retains value when G187 active
    this.g187E = null;     // E value in mm (after conversion); null means not set
    this.g187Tolerance = null; // computed effective tolerance in mm
  }

  updateFromCommand(command) {
    // Handle M codes that cancel G187 (M30, M02)
    if (command.M) {
      const mCodes = Array.isArray(command.M) ? command.M : [command.M];
      if (mCodes.includes(2) || mCodes.includes(30)) {
        this.g187Enabled = false;
        this.g187P = null;
        this.g187E = null;
        this.g187Tolerance = null;
      }
    }

    // Update modal G state (G20/G21, G90/G91, G187, G188, etc.)
    if (command.G !== undefined) {
      this.updateModalG(command.G);
    }

    // Handle G187 parameters if active
    if (this.g187Enabled) {
      if (command.P !== undefined) {
        this.g187P = command.P; // P1/2/3
      }
      if (command.E !== undefined) {
        // E is in current units; convert to mm immediately and store
        let eVal = command.E;
        if (!this.isMetric) {
          eVal = eVal * 25.4;
        }
        this.g187E = eVal;
      }
      this.computeG187Tolerance();
    }

    const scale = this.isMetric ? 1 : 25.4;

    // Determine integer G codes for decision making (to handle G92.1, G28.1 etc)
    const gCodesInt = (() => {
      if (command.G === undefined) return [];
      const arr = Array.isArray(command.G) ? command.G : [command.G];
      return arr.map(g => Math.floor(g));
    })();

    const hasG92 = gCodesInt.includes(92);
    const hasG10 = gCodesInt.includes(10);
    const hasG28 = gCodesInt.includes(28);

    if (hasG92) {
      // G92 (including variants like G92.1, G92.2, G92.3) - set work coordinates directly
      const anyAxis = command.X !== undefined || command.Y !== undefined || command.Z !== undefined;
      if (!anyAxis) {
        // No axes: reset all work coordinates to zero
        this.x = 0;
        this.y = 0;
        this.z = 0;
      } else {
        if (command.X !== undefined) this.x = command.X * scale;
        if (command.Y !== undefined) this.y = command.Y * scale;
        if (command.Z !== undefined) this.z = command.Z * scale;
      }
    } else if (hasG10) {
      // G10 (work coordinate system setting L10/L20) - does not move tool; ignore position update
      // In a full implementation, this would set G54-G59 offset parameters
    } else if (hasG28) {
      // G28 - move to machine reference/home (zero)
      this.x = 0;
      this.y = 0;
      this.z = 0;
    } else {
      // Default motion handling: any other command with X/Y/Z updates position based on modal distance mode
      // Covers explicit motion G (0,1,2,3) and lines that rely on modal motion (e.g., "X10 Y10")
      if (this.isAbsolute) {
        if (command.X !== undefined) this.x = command.X * scale;
        if (command.Y !== undefined) this.y = command.Y * scale;
        if (command.Z !== undefined) this.z = command.Z * scale;
      } else {
        if (command.X !== undefined) this.x += command.X * scale;
        if (command.Y !== undefined) this.y += command.Y * scale;
        if (command.Z !== undefined) this.z += command.Z * scale;
      }
    }

    // Update feedrate if present (applies to most commands)
    if (command.F !== undefined) {
      this.feedrate = command.F;
    }
  }

  computeG187Tolerance() {
    const baseTol = ToolpathState.SMOOTHNESS_MAP[this.setting191] || 0.01;
    const activeTols = [];

    // P-derived tolerance if P is set
    if (this.g187P !== null) {
      const pFactor = {1: 10, 2: 1, 3: 0.1}[this.g187P] || 1;
      activeTols.push(baseTol * pFactor);
    }

    // E-derived tolerance if E is set (>0) and stored in mm (already converted)
    if (this.g187E !== null && this.g187E > 0) {
      activeTols.push(this.g187E);
    }

    // If any tolerances active, take the minimum; otherwise null
    this.g187Tolerance = activeTols.length > 0 ? Math.min(...activeTols) : null;
  }

  updateModalG(gCode) {
    const code = Array.isArray(gCode) ? gCode : [gCode];
    code.forEach(c => {
      const g = Math.floor(c);
      if (g === 0 || g === 1 || g === 2 || g === 3) this.modalGroup1 = `G${g}`;
      if (g === 20) {
        this.isMetric = false;
        this.precision = 4;
      }
      if (g === 21) {
        this.isMetric = true;
        this.precision = 3;
      }
      if (g === 90) this.isAbsolute = true;
      if (g === 91) this.isAbsolute = false;
      // G187: Exact Stop/Path Following
      if (g === 187) {
        this.g187Enabled = true;
        // Note: P and E are NOT reset here; they retain previous values if not explicitly set
        this.g187Tolerance = null;
      }
      // G188 cancels exact stop on Haas (some controls)
      if (g === 188) {
        this.g187Enabled = false;
        this.g187P = null;
        this.g187E = null;
        this.g187Tolerance = null;
      }
    });
  }

  getPosition() {
    return { x: this.x, y: this.y, z: this.z };
  }

  clone() {
    const newState = new ToolpathState();
    Object.assign(newState, this);
    return newState;
  }

  /**
   * Gets the effective tolerance for arc fitting, considering G187 if active.
   * Converts defaultTolerance (machine units) to mm for comparison with G187 tolerance.
   * @param {number} defaultTolerance - Optimizer's default tolerance (inch for G20, mm for G21)
   * @returns {number} - Effective tolerance in mm
   */
  getEffectiveTolerance(defaultTolerance) {
    // Convert default to mm for internal comparison
    const defaultMm = this.isMetric ? defaultTolerance : defaultTolerance * 25.4;
    if (this.g187Enabled && this.g187Tolerance !== null) {
      return Math.min(defaultMm, this.g187Tolerance);
    }
    return defaultMm;
  }

  /**
   * Gets a summary of the current G187 state for debugging/reporting.
   * @returns {Object} - {enabled, p, e, tolerance, setting191, setting85}
   */
  getG187State() {
    return {
      enabled: this.g187Enabled,
      p: this.g187P,
      e: this.g187E,
      tolerance: this.g187Tolerance,
      setting191: this.setting191,
      setting85: this.setting85
    };
  }
}

module.exports = ToolpathState;
