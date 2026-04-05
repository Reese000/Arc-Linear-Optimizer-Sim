/**
 * WorkerPool: Manages a pool of compute workers for parallel window evaluation.
 */
const { Worker } = require('worker_threads');
const path = require('path');

class WorkerPool {
  /**
   * @param {number} numWorkers - Number of workers to spawn (default = CPU count)
   * @param {Array<{x,y,z}>} points - Toolpath points to initialize workers with
   * @param {string} workerScript - Path to worker script (default to compute.worker.js)
   */
  constructor(numWorkers = require('os').cpus().length, points, workerScript) {
    this.numWorkers = numWorkers;
    this.points = points;
    this.workerScript = workerScript || path.resolve(__dirname, '../workers/compute.worker.js');
    this.workers = [];
    this.initialized = false;
  }

  /**
   * Initialize all workers and wait for them to be ready.
   * @returns {Promise<void>}
   */
  async init() {
    const initPromises = [];
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(this.workerScript, {
        workerData: undefined
      });
      // Track current job to match responses
      worker.currentJobId = null;
      worker.busy = false;
      worker.on('message', (msg) => {
        if (msg.type === 'init-ack') {
          // nothing special
        } else if (msg.jobId !== undefined) {
          // Resolve the job's promise
          const { resolve, reject } = worker.currentJob;
          worker.busy = false;
          worker.currentJob = null;
          resolve(msg.results);
        }
      });
      worker.on('error', (err) => {
        if (worker.currentJob) {
          const { reject } = worker.currentJob;
          worker.busy = false;
          worker.currentJob = null;
          reject(err);
        } else {
          console.error('Worker error:', err);
        }
      });
      // Send init data
      const initPromise = new Promise((resolve, reject) => {
        worker.once('message', (msg) => {
          if (msg.type === 'init-ack') resolve();
          else reject(new Error('Worker did not acknowledge init'));
        });
        worker.postMessage({ type: 'init', points: this.points });
      });
      initPromises.push(initPromise);
      this.workers.push(worker);
    }
    await Promise.all(initPromises);
    this.initialized = true;
  }

  /**
   * Submit a batch of window evaluations to the pool.
   * @param {Array<{start:number, end:number}>} windows
   * @param {Object} options - Common options for all windows
   * @returns {Promise<Array>} Results in same order as windows
   */
  async evaluateBatch(windows, options) {
    if (!this.initialized) {
      await this.init();
    }

    if (windows.length === 0) return [];

    // Simple round-robin chunking: assign windows to workers in consecutive chunks
     const chunks = this._chunkArray(windows, this.numWorkers);
    const promises = [];

    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i];
      const chunk = chunks[i];
      if (!chunk || chunk.length === 0) continue;

      // Assign job to this worker
      const jobId = i; // not needed globally; we use per-worker promise
      const promise = new Promise((resolve, reject) => {
        worker.busy = true;
        worker.currentJob = { resolve, reject };
        worker.postMessage({
          type: 'job',
          jobId: i,
          windows: chunk,
          options: options
        });
      });
      promises.push(promise);
    }

    // Wait for all workers to finish their chunks
    const resultsArrays = await Promise.all(promises);
    // Flatten results in order of original windows? Our chunking splits in order, but if we want exact order, we need to merge.
    // We'll return concatenated results in the same order as chunks (which preserves relative order within each chunk). Since we split sequentially, the concatenation will be original order.
    return resultsArrays.flat();
  }

  /**
   * Utility to split array into N chunks (approximately equal)
   */
  _chunkArray(array, n) {
    const chunks = [];
    const size = Math.ceil(array.length / n);
    for (let i = 0; i < n; i++) {
      const start = i * size;
      const end = start + size;
      if (start < array.length) {
        chunks.push(array.slice(start, end));
      } else {
        chunks.push([]);
      }
    }
    return chunks;
  }

  /**
   * Gracefully terminate all workers.
   */
  async terminate() {
    for (const worker of this.workers) {
      await worker.terminate();
    }
    this.workers = [];
    this.initialized = false;
  }
}

module.exports = WorkerPool;
