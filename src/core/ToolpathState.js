/**
 * Tracks the modal state of the CNC machine during G-code processing.
 * Responsible for handling unit conversions (G20/G21) and absolute/incremental moves (G90/G91).
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
    this.unitsPerMm = 1;
    this.precision = 4; // Haas standard decimal places (usually 4 for inch, 3 for metric)
  }

  updateFromCommand(command) {
    if (command.G !== undefined) {
      this.updateModalG(command.G);
    }

    const scale = this.isMetric ? 1 : 25.4; // Internal representation always in MM for consistent math

    if (this.isAbsolute) {
      if (command.X !== undefined) this.x = command.X * scale;
      if (command.Y !== undefined) this.y = command.Y * scale;
      if (command.Z !== undefined) this.z = command.Z * scale;
    } else {
      if (command.X !== undefined) this.x += command.X * scale;
      if (command.Y !== undefined) this.y += command.Y * scale;
      if (command.Z !== undefined) this.z += command.Z * scale;
    }

    if (command.F !== undefined) {
      this.feedrate = command.F;
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
}

module.exports = ToolpathState;
