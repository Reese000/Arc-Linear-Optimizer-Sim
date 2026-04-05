/**
 * Tracks the modal state of the CNC machine during G-code processing.
 * Handles unit conversions (G20/G21), absolute/incremental moves (G90/G91),
 * and G187 (Exact Stop/Path Following) tolerance.
 */
class ToolpathState {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.feedrate = 0;
    this.isMetric = true; // Default to metric (G21)
    this.isAbsolute = true; // Default to absolute (G90)
    this.modalGroup1 = 'G0'; // Default G-motion group
    this.precision = 4; // Haas standard decimal places (usually 4 for inch, 3 for metric)
    // G187 Exact Stop/Path Following tolerance (stored internally in mm)
    this.g187Enabled = false;
    this.g187Tolerance = null; // tolerance in mm (after conversion if needed)
    this.g187P = null; // raw P value in original units (for reference)
    // G92 Work Coordinate offsets
    this.workOffsetX = 0;
    this.workOffsetY = 0;
    this.workOffsetZ = 0;
  }

  updateFromCommand(command) {
    if (command.G !== undefined) {
      this.updateModalG(command.G);
    }

    // Handle G187 E parameter (tolerance) if present
    if (this.g187Enabled && command.E !== undefined) {
      let eVal = command.E;
      // E is in current units (inch for G20, mm for G21) - convert to mm for internal
      if (!this.isMetric) {
        eVal = eVal * 25.4;
      }
      this.g187Tolerance = eVal;
    }

    const scale = this.isMetric ? 1 : 25.4; // Internal representation always in MM

    // Check for G92 work offset command
    const gCodes = command.G !== undefined ? (Array.isArray(command.G) ? command.G : [command.G]) : [];
    const hasG92 = gCodes.includes(92);

    if (hasG92) {
      // G92: Set work offsets. If no axes specified, reset offsets to 0.
      if (command.X === undefined && command.Y === undefined && command.Z === undefined) {
        this.workOffsetX = 0;
        this.workOffsetY = 0;
        this.workOffsetZ = 0;
      } else {
        if (command.X !== undefined) this.workOffsetX = command.X * scale;
        if (command.Y !== undefined) this.workOffsetY = command.Y * scale;
        if (command.Z !== undefined) this.workOffsetZ = command.Z * scale;
      }
      // Do not update x,y,z as G92 does not cause motion
    } else {
      // Normal motion handling
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

    if (command.F !== undefined) {
      this.feedrate = command.F;
    }

    // Handle M30/M02 (program end) to cancel G187
    if (command.M !== undefined) {
      if (command.M === 2 || command.M === 30) {
        this.g187Enabled = false;
        this.g187Tolerance = null;
      }
    }
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
        // Reset tolerance unless P is provided in the same command
      }
      // G188 cancels exact stop on Haas (some controls)
      if (g === 188) {
        this.g187Enabled = false;
        this.g187Tolerance = null;
      }
    });
  }

  getPosition() {
    return {
      x: this.x + this.workOffsetX,
      y: this.y + this.workOffsetY,
      z: this.z + this.workOffsetZ
    };
  }

  clone() {
    const newState = new ToolpathState();
    Object.assign(newState, this);
    return newState;
  }

  /**
   * Gets the effective tolerance for arc fitting, considering G187 if active.
   * Returns the tighter (smaller) of defaultTolerance and G187 tolerance.
   * @param {number} defaultTolerance - Optimizer's default tolerance (mm)
   * @returns {number} - Effective tolerance in mm
   */
   getEffectiveTolerance(defaultTolerance) {
     if (this.g187Enabled && this.g187Tolerance !== null) {
       return Math.min(defaultTolerance, this.g187Tolerance);
     }
     return defaultTolerance;
   }
}

module.exports = ToolpathState;
