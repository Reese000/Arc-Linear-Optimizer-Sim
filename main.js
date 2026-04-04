const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');
const GCodeParser = require('./src/core/GCodeParser');
const ArcFitter = require('./src/core/ArcFitter');
const ToolpathState = require('./src/core/ToolpathState');

/**
 * Main entry point for the Arc-Linear Optimizer CLI.
 */
async function main() {
  const rawArgs = process.argv.slice(2);
  
  // Support legacy positional arguments: node main.js <input.nc> [tolerance]
  if (rawArgs.length > 0 && !rawArgs[0].startsWith('--')) {
    const inputFile = rawArgs[0];
    const tolerance = parseFloat(rawArgs[1]) || 0.001;
    // Convert to flags format
    rawArgs.length = 0;
    rawArgs.push('--input', inputFile);
    rawArgs.push('--tolerance', tolerance.toString());
  }

  const argv = yargsParser(rawArgs, {
    boolean: [
      'help', 'verbose', 'report', 'allow-helix', 'modal-suppression', 'skip-errors',
      'bidirectional', 'ransac'
    ],
    number: [
      'tolerance', 'min-radius', 'max-radius', 'max-ijk', 'precision'
    ],
    string: [
      'input', 'output-dir', 'report-format'
    ],
    default: {
      tolerance: 0.001,
      'min-radius': 0,
      'max-radius': Infinity,
      'max-ijk': Infinity,
      'report-format': 'json',
      precision: null,
      ransac: false
    },
    alias: {
      i: 'input',
      o: 'output-dir',
      t: 'tolerance',
      h: 'help',
      v: 'verbose',
      r: 'report',
      fmt: 'report-format'
    }
  });

  if (argv.help || !argv.input) {
    console.log(`
${chalk.cyan('Ultimate Haas 3-Axis G-Code Optimizer')}

${chalk.yellow('Usage:')}
  node main.js --input <file.nc> [options]

${chalk.yellow('Required:')}
  --input, -i       Input .nc file path
  OR use --input-dir for batch processing

${chalk.yellow('Haas Constraints:')}
  --tolerance, -t      Fit tolerance in machine units (default: 0.001)
                       Respects G20 (inch) / G21 (mm) automatically
  --min-radius         Minimum arc radius allowed (default: 0)
  --max-radius         Maximum arc radius allowed (default: Infinity)
  --max-ijk            Maximum IJK magnitude (default: Infinity)

 ${chalk.yellow('Algorithm Options:')}
   --bidirectional      Search backward and forward to maximize arc length
   --allow-helix        Allow helical arcs (Z changes during arcs) (default: false)
   --modal-suppression  Suppress redundant modal codes in output (default: false)
   --ransac             Enable RANSAC robust circle fitting for outlier rejection (default: false)

${chalk.yellow('Output:')}
  --output-dir, -o     Output directory (default: ./output)
  --report, -r         Generate optimization report (default: false)
  --report-format, --fmt
                      Report format: json or csv (default: json)
  --precision          Decimal places for coordinates (default: 4 for G20, 3 for G21)

${chalk.yellow('Quality:')}
  --skip-errors        Continue processing on errors (default: false)
  --verbose, -v        Enable verbose logging

${chalk.yellow('Examples:')}
  node main.js --input test.nc --tolerance 0.0005 --max-radius 10 --report
  node main.js -i input.nc -o ./optimized --bidirectional --modal-suppression
  node main.js --input-dir ./gcode --output-dir ./optimized --tolerance 0.001

${chalk.yellow('Haas Integration:')}
  This optimizer is designed for non-HSM Haas 3-axis mills.
  Default tolerance 0.001" (G20) or 0.01mm (G21) meets Haas accuracy standards.
    `);
    return;
  }

  // Handle batch processing
  if (argv['input-dir']) {
    await processBatch(argv);
    return;
  }

  // Single file processing
  await processFile(argv);
}

async function processFile(argv) {
  const inputFile = argv.input;
  const outputDir = argv['output-dir'] || path.join(process.cwd(), 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const parser = new GCodeParser();
  const fitter = new ArcFitter(argv.tolerance, {
    minArcRadius: argv['min-radius'],
    maxArcRadius: argv['max-radius'],
    maxIJK: argv['max-ijk'],
    allowHelix: argv['allow-helix'],
    modalSuppression: argv['modal-suppression'],
    bidirectional: argv['bidirectional'],
    ransac: argv['ransac'] || false
  });

  const outputFile = path.join(outputDir, `${path.basename(inputFile, '.nc')}_optimized.nc`);
  const reportFile = argv.report ? path.join(outputDir, `${path.basename(inputFile, '.nc')}_report.${argv['report-format']}`) : null;

  console.log(chalk.cyan(`\n--- G-code Arc & Linear Optimizer ---`));
  console.log(`Input: ${inputFile}`);
  console.log(`Tolerance: ${argv.tolerance}`);

  try {
    const parsedData = await parser.parseFile(inputFile);
    console.log(chalk.green(`Successfully parsed ${parsedData.length} G-code lines.`));

    if (argv.verbose) {
      console.log(`Constraints: min-radius=${argv['min-radius']}, max-radius=${argv['max-radius']}, max-ijk=${argv['max-ijk']}`);
    }

    const resultLines = fitter.optimize(parsedData, {
      precision: argv.precision,
      allowHelix: argv['allow-helix'],
      modalSuppression: argv['modal-suppression'],
      bidirectional: argv['bidirectional']
    });

    // Write the optimized code
    fs.writeFileSync(outputFile, resultLines.join('\n'));

    const originalSize = fs.statSync(inputFile).size;
    const optimizedSize = fs.statSync(outputFile).size;
    const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(2);

    console.log(chalk.yellow(`\nOptimization Report:`));
    console.log(`- Original Size: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`- Optimized Size: ${(optimizedSize / 1024).toFixed(2)} KB`);
    console.log(`- Data Reduction: ${reduction}%`);
    console.log(`- Arcs Created: ${fitter.lastArcs ? fitter.lastArcs.length : 0}`);
    console.log(`- Output File: ${outputFile}`);

    if (reportFile) {
      generateReport(fitter, reportFile, argv['report-format']);
      console.log(`- Detailed Report: ${reportFile}`);
    }

    console.log(chalk.green("\nOptimization Complete.\n"));

  } catch (err) {
    console.error(chalk.red(`Fatal Error: ${err.message}`));
    if (argv['skip-errors']) {
      console.log(chalk.yellow('--skip-errors enabled, continuing...'));
    } else {
      process.exit(1);
    }
   }
 }

 async function processBatch(argv) {
  const inputDir = argv['input-dir'];
  const outputDir = argv['output-dir'] || path.join(process.cwd(), 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.nc'));

  if (files.length === 0) {
    console.log(chalk.yellow('No .nc files found in input directory.'));
    return;
  }

  console.log(chalk.cyan(`\n--- Batch Processing (${files.length} files) ---`));

  const parser = new GCodeParser();
  const fitter = new ArcFitter(argv.tolerance, {
    minArcRadius: argv['min-radius'],
    maxArcRadius: argv['max-radius'],
    maxIJK: argv['max-ijk'],
    allowHelix: argv['allow-helix'],
    modalSuppression: argv['modal-suppression'],
    bidirectional: argv['bidirectional'],
    ransac: argv['ransac'] || false
  });

  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, `${path.basename(file, '.nc')}_optimized.nc`);

    try {
      const parsedData = await parser.parseFile(inputPath);
      const optimizedLines = fitter.optimize(parsedData, {
        precision: argv.precision,
        allowHelix: argv['allow-helix'],
        modalSuppression: argv['modal-suppression'],
        bidirectional: argv['bidirectional']
      });

      fs.writeFileSync(outputPath, optimizedLines.join('\n'));
      console.log(chalk.green(`✓ ${file}`));
      successCount++;
    } catch (err) {
      console.log(chalk.red(`✗ ${file}: ${err.message}`));
      errorCount++;
      if (!argv['skip-errors']) break;
    }
  }

  console.log(chalk.cyan(`\nBatch Complete: ${successCount} succeeded, ${errorCount} failed\n`));
}

function generateReport(fitter, reportFile, format) {
  const arcs = fitter.lastArcs || [];
  const linearsCount = fitter.lastLinearsCount || 0;
  const originalLineCount = fitter.originalLineCount || 0;

  const report = {
    summary: {
      originalLineCount: originalLineCount,
      optimizedLineCount: arcs.length + linearsCount,
      arcCount: arcs.length,
      linearCount: linearsCount,
      reductionPercent: ((1 - (arcs.length + linearsCount) / originalLineCount) * 100).toFixed(2)
    },
    arcs: arcs.map(arc => ({
      start: { x: arc.start.x, y: arc.start.y },
      end: { x: arc.end.x, y: arc.end.y },
      center: arc.circle.center,
      radius: arc.circle.radius,
      direction: arc.direction,
      sweepDegrees: arc.sweepDegrees,
      pointCount: arc.originalPoints.length,
      feedrate: arc.feedrate
    }))
  };

  if (format === 'csv') {
    const csv = [
      'Direction,StartX,StartY,EndX,EndY,CenterX,CenterY,Radius,SweepDegrees,Points,Feedrate',
      ...report.arcs.map(a =>
        `${a.direction},${a.start.x},${a.start.y},${a.end.x},${a.end.y},` +
        `${a.center.x},${a.center.y},${a.radius},${a.sweepDegrees},` +
        `${a.pointCount},${a.feedrate || ''}`
      )
    ].join('\n');
    fs.writeFileSync(reportFile, csv);
  } else {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
}

main();
