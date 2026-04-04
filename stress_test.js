const StressTester = require('./src/sim/StressTester');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

/**
 * CLI Entry Point for Automated Stress Testing & Scoring.
 * Usage:
 *   node stress_test.js [--all] [--parallel N] [--export json|csv|html] [--regression] [--golden FILE] [--generate-golden]
 */
async function main() {
    const args = process.argv.slice(2);
    const parallel = parseInt(args.find(a => a.startsWith('--parallel='))?.split('=')[1]) || 4;
    const exportFormat = args.includes('--export') ? (args.find(a => a.startsWith('--export='))?.split('=')[1] || 'json') : null;
    const regression = args.includes('--regression');
    const generateGolden = args.includes('--generate-golden');
    const goldenPath = args.find(a => a.startsWith('--golden='))?.split('=')[1] || path.join(__dirname, 'golden.json');

    const tester = new StressTester(0.001);

    // Progress callback
    const onProgress = (completed, total) => {
        // Could also emit events, but just log
        console.log(chalk.gray(`Progress: ${completed}/${total} tests completed`));
    };

    // Run the full modular test suite
    console.log(chalk.bold.blue("\n🚀 INITIALIZING STRESS TEST SUITE...\n"));
    await tester.runAllTests(parallel, onProgress);

    // Print report to console
    tester.printReport();

    // Regression mode
    if (regression) {
        if (!fs.existsSync(goldenPath)) {
            console.error(chalk.red(`Golden file not found: ${goldenPath}`));
            process.exit(1);
        }
        const goldenData = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
        // Compare current results with golden
        const goldenMap = new Map(goldenData.results.map(r => [r.name, r]));
        let passed = 0, failed = 0;
        console.log(chalk.cyan("\n--- REGRESSION TESTING ---"));
        for (const result of tester.results) {
            const golden = goldenMap.get(result.name);
            if (!golden) {
                console.log(chalk.yellow(`⊘ ${result.name}: no golden data`));
                continue;
            }
            const scoreDiff = Math.abs(result.score - golden.score);
            const compDiff = Math.abs(parseFloat(result.compression) - parseFloat(golden.compression));
            const arcsDiff = result.arcsGenerated - golden.arcsGenerated;
            const runtimeDiff = result.runtime - golden.runtime;

            const scoreThresh = 5;
            const compThresh = 1.0;
            const runtimeThreshPct = 0.2;

            let isOk = true;
            let reasons = [];
            if (scoreDiff > scoreThresh) { isOk = false; reasons.push(`Score diff ${scoreDiff}`); }
            if (compDiff > compThresh) { isOk = false; reasons.push(`Compression diff ${compDiff.toFixed(2)}%`); }
            if (arcsDiff !== 0) { isOk = false; reasons.push(`Arcs count diff ${arcsDiff}`); }
            if (golden.runtime > 0 && (result.runtime / golden.runtime - 1) > runtimeThreshPct) { isOk = false; reasons.push(`Runtime +${((result.runtime/golden.runtime-1)*100).toFixed(1)}%`); }

            if (isOk) {
                passed++;
                console.log(chalk.green(`✓ ${result.name}`));
            } else {
                failed++;
                console.log(chalk.red(`✗ ${result.name}: ${reasons.join(', ')}`));
            }
        }
        console.log(chalk.cyan(`\nRegression: ${passed} passed, ${failed} failed`));
        process.exit(failed === 0 ? 0 : 1);
        return;
    }

    // Generate golden baseline
    if (generateGolden) {
        fs.writeFileSync(goldenPath, JSON.stringify({
            meta: {
                tolerance: tester.tolerance,
                timestamp: new Date().toISOString(),
                suite: tester.getTestSuite().map(t => t.name)
            },
            results: tester.results
        }, null, 2));
        console.log(chalk.green(`\n✅ Golden baseline saved to ${goldenPath}`));
    }

    // Export reports
    if (exportFormat) {
        const timestamp = new Date().toISOString().replace(/[:]/g, '-').substring(0, 19);
        if (exportFormat === 'json' || exportFormat === 'all') {
            tester.exportJSON(path.join(__dirname, `report-${timestamp}.json`));
        }
        if (exportFormat === 'csv' || exportFormat === 'all') {
            tester.exportCSV(path.join(__dirname, `report-${timestamp}.csv`));
        }
        if (exportFormat === 'html' || exportFormat === 'all') {
            tester.exportHTML(path.join(__dirname, `report-${timestamp}.html`));
        }
    }
}

main().catch(err => {
    console.error(chalk.red("\n❌ Stress Test Failed: " + err.message));
    process.exit(1);
});
