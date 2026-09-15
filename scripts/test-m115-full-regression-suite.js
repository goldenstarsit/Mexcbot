import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scriptsDir = join(process.cwd(), "scripts");

const scripts = readdirSync(scriptsDir)
  .filter((name) => /^test-m(10[1-9]|11[0-4])-.*\.js$/.test(name))
  .sort((a, b) => {
    const ma = Number(a.match(/^test-m(\d+)/)[1]);
    const mb = Number(b.match(/^test-m(\d+)/)[1]);
    return ma - mb;
  });

if (scripts.length === 0) {
  throw new Error("No M101-M114 regression test scripts found.");
}

console.log("M115 FULL REGRESSION SUITE");
console.log("==========================");
console.log(`Tests discovered: ${scripts.length}`);
console.log("");

const results = [];

for (const script of scripts) {
  const milestone = script.match(/^test-m(\d+)/)?.[1] ?? "?";

  console.log(`----- M${milestone}: ${script} -----`);

  const result = spawnSync(
    process.execPath,
    [join(scriptsDir, script)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    },
  );

  const passed = result.status === 0 && !result.error;

  results.push({
    milestone: `M${milestone}`,
    script,
    passed,
    exitCode: result.status,
  });

  if (!passed) {
    console.error("");
    console.error(`M115 FAILED: ${script}`);
    console.error(`Exit code: ${result.status}`);
    if (result.error) {
      console.error(result.error);
    }
    process.exit(result.status || 1);
  }

  console.log(`M${milestone}: PASS`);
  console.log("");
}

console.log("M115 FULL REGRESSION SUITE: PASS");
console.log({
  testsDiscovered: scripts.length,
  testsPassed: results.filter((r) => r.passed).length,
  testsFailed: results.filter((r) => !r.passed).length,
  milestones: results.map((r) => r.milestone),
});
