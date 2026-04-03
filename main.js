const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const GCodeParser = require('./src/core/GCodeParser');
const ArcFitter = require('./src/core/ArcFitter');
const ToolpathState = require('./src/core/ToolpathState');

/**
 * Main entry point for the Arc-Linear Optimizer CLI.
 */
async function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];
  const tolerance = parseFloat(args[1]) || 0.001;

  if (!inputFile) {
    console.log(chalk.red("Error: Please provide an input .nc file."));
    console.log("Usage: node main.js <input.nc> [tolerance]");
    return;
  }

  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const parser = new GCodeParser();
  const fitter = new ArcFitter(tolerance);
  const outputFile = path.join(outputDir, `${path.basename(inputFile, '.nc')}_optimized.nc`);

  console.log(chalk.cyan(`\n--- G-code Arc & Linear Optimizer ---`));
  console.log(`Input: ${inputFile}`);
  console.log(`Tolerance: ${tolerance}"`);

  try {
    const parsedData = await parser.parseFile(inputFile);
    console.log(chalk.green(`Successfully parsed ${parsedData.length} G-code lines.`));

    const optimizedLines = fitter.optimize(parsedData);
    
    // Write the optimized code
    fs.writeFileSync(outputFile, optimizedLines.join('\n'));

    const originalSize = fs.statSync(inputFile).size;
    const optimizedSize = fs.statSync(outputFile).size;
    const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(2);

    console.log(chalk.yellow(`\nOptimization Report:`));
    console.log(`- Original Size: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`- Optimized Size: ${(optimizedSize / 1024).toFixed(2)} KB`);
    console.log(`- Data Reduction: ${reduction}%`);
    console.log(`- Output File: ${outputFile}\n`);
    
    console.log(chalk.green("Optimization Complete. Check output folder for results.\n"));

  } catch (err) {
    console.error(chalk.red(`Fatal Error: ${err.message}`));
  }
}

main();
