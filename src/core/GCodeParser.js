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

  static parseLine(line) {
    // 1. Strip comments ( (comment) or ;comment )
    const cleanLine = line.replace(/\(.*\)|;.*/g, '').trim().toUpperCase();
    if (!cleanLine) return null;

    // 2. Tokenize into command groups (letter + value)
    const tokens = cleanLine.match(/([A-Z])([-+]?\d*\.?\d+)/g);
    if (!tokens) return null;

    const command = {};
    tokens.forEach(token => {
      const field = token[0];
      const value = parseFloat(token.substring(1));
      
      // Handle multiple G or M codes on a single line
      if (field === 'G' || field === 'M') {
        if (!command[field]) command[field] = [];
        command[field].push(value);
      } else {
        command[field] = value;
      }
    });

    return command;
  }

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
}

module.exports = GCodeParser;
