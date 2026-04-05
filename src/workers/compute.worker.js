/**
 * Compute worker: evaluates arc window fitness in parallel.
 * Runs in a Worker thread, receives init + job messages.
 */
const { parentPort } = require('worker_threads');
const WindowEvaluator = require('../core/evaluation/WindowEvaluator');

let points = null; // will be array of {x, y, z}

parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    points = msg.points;
    // Optionally acknowledge
    parentPort.postMessage({ type: 'init-ack' });
  } else if (msg.type === 'job') {
    const { jobId, windows, options } = msg;
    const results = windows.map(win => {
      try {
        const result = WindowEvaluator.evaluateWindow(points, win.start, win.end, options);
        return result; // may be null
      } catch (err) {
        // Return error info? For now, just return null and maybe log
        return null;
      }
    });
    parentPort.postMessage({ jobId, results });
  }
});
