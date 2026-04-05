/**
 * AIOptimizer: Explores parameter space to find optimal arc fitting configuration.
 * Uses parallel worker threads to evaluate many parameter sets concurrently.
 */
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

class AIOptimizer {
  /**
   * @param {Object} config
   * @param {number} config.numWorkers - Number of parallel workers (default = CPU count)
   * @param {string} config.workerScript - Path to worker script (default optimize.worker.js)
   */
  constructor(config = {}) {
    this.numWorkers = config.numWorkers || os.cpus().length;
    this.workerScript = config.workerScript || path.resolve(__dirname, '../workers/optimize.worker.js');
  }

  /**
   * Run optimization over a search space.
   * @param {string} gcode - Original G-code content
   * @param {Object} searchSpace - Parameter ranges/values to sample (tolerance, minSweep, useRANSAC, bidirectional, maxSearch, etc.)
   * @param {number} [samples=50] - Number of random samples if searchSpace is ranges
   * @param {Object} [fixedOptions={}] - Additional options that are fixed (minArcRadius, maxArcRadius, maxIJK, allowHelix, etc.)
   * @returns {Promise<Object>} - { bestResult, bestScore, allResults, statistics }
   */
  async optimize(gcode, searchSpace, samples = 50, fixedOptions = {}) {
    // Generate parameter sets
    const paramSets = this.sampleParameters(searchSpace, samples);

    // Create workers
    const workers = [];
    const pending = new Map(); // jobId -> resolve
    let jobIdCounter = 0;
    const results = new Array(paramSets.length); // preserve order

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(this.workerScript);
      worker.on('message', (msg) => {
        if (msg.type === 'result' || msg.type === 'error') {
          const { jobId } = msg;
          const resolve = pending.get(jobId);
          if (resolve) {
            if (msg.type === 'result') {
              resolve({ status: 'ok', data: msg.result });
            } else {
              resolve({ status: 'error', error: msg.error });
            }
            pending.delete(jobId);
          }
        }
      });
      worker.on('error', (err) => console.error('Worker error:', err));
      workers.push(worker);
    }

     // Distribute jobs round-robin
     const promises = paramSets.map((params, idx) => {
       return new Promise((resolve) => {
         const jobId = jobIdCounter++;
         pending.set(jobId, resolve);
         const workerIdx = idx % this.numWorkers;
         const worker = workers[workerIdx];
         // Merge fixed options with sampled parameters (sample overrides if conflict)
         const mergedOptions = { ...fixedOptions, ...params };
         worker.postMessage({
           type: 'optimize',
           jobId,
           gcode,
           options: mergedOptions
         });
       });
     });

    // Wait for all
    const rawResults = await Promise.all(promises);

    // Terminate workers
    for (const w of workers) {
      await w.terminate();
    }

    // Process results
    const successfulResults = [];
    let errors = 0;
    for (let i = 0; i < rawResults.length; i++) {
      const res = rawResults[i];
      if (res.status === 'ok') {
        successfulResults.push({
          params: paramSets[i],
          ...res.data
        });
      } else {
        errors++;
      }
    }

    // Find best by quality score
    let best = null;
    let bestScore = -Infinity;
    for (const r of successfulResults) {
      if (r.quality > bestScore) {
        bestScore = r.quality;
        best = r;
      }
    }

    // Compute statistics
    const avgQuality = successfulResults.reduce((sum, r) => sum + r.quality, 0) / successfulResults.length;
    const avgArcCount = successfulResults.reduce((sum, r) => sum + r.arcCount, 0) / successfulResults.length;

    return {
      bestResult: best,
      bestScore,
      allResults: successfulResults,
      statistics: {
        totalTrials: paramSets.length,
        successful: successfulResults.length,
        errors,
        avgQuality,
        avgArcCount
      }
    };
  }

  /**
   * Generate parameter sets from search space.
   * Supports discrete arrays or ranges with steps. If both samples and ranges provided, random sampling.
   */
  sampleParameters(searchSpace, numSamples) {
    const keys = Object.keys(searchSpace);
    const sets = [];

    // Helper: expand a single key to array of values
    const expand = (key) => {
      const spec = searchSpace[key];
      if (Array.isArray(spec)) {
        return spec;
      } else if (typeof spec === 'object' && spec.min !== undefined && spec.max !== undefined) {
        const { min, max, steps } = spec;
        const step = steps ? (max - min) / (steps - 1) : (max - min);
        const arr = [];
        for (let i = 0; i < steps; i++) {
          const val = min + i * step;
          // For numeric options, keep as number
          arr.push(val);
        }
        return arr;
      } else {
        return [spec]; // single value
      }
    };

    // Get all arrays of values for each key
    const valueArrays = {};
    for (const key of keys) {
      valueArrays[key] = expand(key);
    }

    // Cartesian product if arrays are small; else random sampling
    const totalCombinations = keys.reduce((prod, key) => prod * valueArrays[key].length, 1);
    if (totalCombinations <= numSamples * 2) {
      // Full grid
      return this.cartesianProduct(valueArrays, keys);
    } else {
      // Random sampling
      return this.randomSample(valueArrays, keys, numSamples);
    }
  }

  cartesianProduct(valueArrays, keys) {
    const result = [];
    const indices = new Array(keys.length).fill(0);
    const lengths = keys.map(k => valueArrays[k].length);

    function buildRecord() {
      const rec = {};
      for (let i = 0; i < keys.length; i++) {
        rec[keys[i]] = valueArrays[keys[i]][indices[i]];
      }
      return rec;
    }

    function recurse(pos) {
      if (pos === keys.length) {
        result.push(buildRecord());
        return;
      }
      for (let i = 0; i < lengths[pos]; i++) {
        indices[pos] = i;
        recurse(pos + 1);
      }
    }

    recurse(0);
    return result;
  }

  randomSample(valueArrays, keys, n) {
    const samples = [];
    for (let i = 0; i < n; i++) {
      const sample = {};
      for (const key of keys) {
        const arr = valueArrays[key];
        const idx = Math.floor(Math.random() * arr.length);
        sample[key] = arr[idx];
      }
      samples.push(sample);
    }
    return samples;
  }
}

module.exports = AIOptimizer;
