const fs = require('fs');
const readline = require('readline');
const ToolpathState = require('./ToolpathState');

/**
 * GCodeParser converts raw .NC strings into structured command objects.
 * Handles comment stripping and modal state persistence.
 */
class GCodeParser {
  constructor() {
    this.state = new ToolpathState();
    this.commands = [];
  }

  /**
   * Strips comments (parentheses or semicolon) from a G-code line.
   * Handles nested parentheses and unclosed parentheses by discarding from first '(' onward if not closed.
   * @param {string} line
   * @returns {string}
   */
  static stripComments(line) {
    let result = '';
    let i = 0;
    let parenDepth = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ';' && parenDepth === 0) {
        break; // semicolon comment: ignore rest of line
      } else if (ch === '(') {
        parenDepth++;
        i++;
        continue;
      } else if (ch === ')' && parenDepth > 0) {
        parenDepth--;
        i++;
        continue;
      } else if (parenDepth > 0) {
        // skip character inside parentheses
        i++;
        continue;
      } else {
        result += ch;
        i++;
      }
    }
    return result.trim();
  }

  /**
   * Parses a single line of G-code and returns a command object.
   * Supports modal G-codes (arrays) and handles comments (parentheses or semicolon).
   * @param {string} line - Raw G-code line
   * @returns {Object|null} - Command object with fields (X, Y, Z, F, G[], M[], etc.) or null if empty/comments
   */
  static parseLine(line) {
     // 1. Strip comments using a balanced parentheses handler
     const cleanLine = GCodeParser.stripComments(line).trim().toUpperCase();
     if (!cleanLine) return null;

    // 2. Tokenize into command groups (letter + value)
    const tokens = cleanLine.match(/([A-Z])([-+]?\d*\.?\d+)/g);
    if (!tokens) return null;

    const command = {};
    for (const token of tokens) {
      const field = token[0];
      let value = parseFloat(token.substring(1));

      // Reject non-finite numbers (NaN, Infinity, -Infinity)
      if (!isFinite(value)) {
        return null;
      }

      // Normalize -0 to 0
      if (value === 0) value = 0;

      // Handle multiple G or M codes on a single line
      if (field === 'G' || field === 'M') {
        if (!command[field]) command[field] = [];
        command[field].push(value);
      } else {
        command[field] = value;
      }
    }

    return command;
  }

  /**
   * Asynchronously parses a G-code file into an array of snapshots.
   * Each snapshot includes the raw line, parsed command, and machine state after execution.
   * @param {string} filePath - Path to the .nc file
   * @returns {Promise<Array>} - Array of {raw, cmd, state} objects
   */
  async parseFile(filePath) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    const parsedData = [];
    for await (const line of rl) {
      const cmd = GCodeParser.parseLine(line);
      if (cmd) {
        this.state.updateFromCommand(cmd);
        const snapshot = {
          raw: line,
          cmd: cmd,
          state: this.state.clone()
        };
        parsedData.push(snapshot);
      }
    }
    return parsedData;
  }

  /**
   * Parses G-code content from a string (synchronous) and returns path data snapshots.
   * Useful for testing.
   * @param {string} content
   * @returns {Array}
   */
  parseFileContent(content) {
    const lines = content.split(/\r?\n/);
    const parsedData = [];
    for (const line of lines) {
      const cmd = GCodeParser.parseLine(line);
      if (cmd) {
        this.state.updateFromCommand(cmd);
        parsedData.push({
          raw: line,
          cmd: cmd,
          state: this.state.clone()
        });
      }
    }
    return parsedData;
  }
}

module.exports = GCodeParser;
