/**
 * Optimization worker: receives G-code and options, runs optimizer, returns result.
 */
const { parentPort } = require('worker_threads');
const GCodeParser = require('../core/GCodeParser');
const ArcFitter = require('../core/ArcFitter');

parentPort.on('message', async (msg) => {
  if (msg.type === 'optimize') {
    const { jobId, gcode, options } = msg;
    try {
      const parser = new GCodeParser();
      const pathData = parser.parseFileContent(gcode);
      const fitter = new ArcFitter(options.tolerance, options);
      const optimized = fitter.optimize(pathData);
       const quality = ArcFitter.computeQualityScore(
         fitter.originalLineCount,
         fitter.lastArcs,
         fitter.lastLinearsCount,
         options.tolerance
       );
      const stats = ArcFitter.computeArcStats(fitter.lastArcs);

      parentPort.postMessage({
        type: 'result',
        jobId,
        result: {
          optimized: optimized, // array of strings
          arcs: fitter.lastArcs, // array of arc records (maybe too large; could omit for summary)
          quality,
          stats,
          lineCount: optimized.length,
          arcCount: fitter.lastArcs.length,
          linearsCount: fitter.lastLinearsCount
        }
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        jobId,
        error: err.message
      });
    }
  }
});
