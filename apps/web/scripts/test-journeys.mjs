import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "lichendr-journeys-"));
const tsc = resolve("node_modules/typescript/bin/tsc");
const configs = ["tsconfig.guided-results-tests.json", "tsconfig.ecology-tests.json", "tsconfig.ecology-summary-tests.json", "tsconfig.jornada-closure-tests.json", "tsconfig.unified-jornada-tests.json", "tsconfig.exports-tests.json"];
for (const config of configs) {
  const compilation = spawnSync(process.execPath, [tsc, "-p", config, "--rootDir", "src", "--outDir", directory], { stdio: "inherit" });
  if (compilation.status !== 0) process.exit(compilation.status ?? 1);
}
const resolver = join(directory, "aliases.cjs");
writeFileSync(resolver, `const Module=require('node:module'),path=require('node:path'); const old=Module._resolveFilename; Module._resolveFilename=function(id,...args){if(id==='@/lib/supabase/client')id=${JSON.stringify(resolve("test-stubs/@/lib/supabase/client.js"))};else if(id.startsWith('@/'))id=path.join(${JSON.stringify(directory)},id.slice(2));return old.call(this,id,...args)};`);
const files = ["demo/demo", "four-view/guided-results", "four-view/guided.component", "four-view/accepted-colors", "region-suggestions/trunk-colors", "four-view/ecology", "four-view/ecology-summary", "four-view/jornada-summary", "jornada/closure", "exports/export"];
const result = spawnSync(process.execPath, ["--require", resolver, "--test", ...files.map(file => join(directory, "modules", file + ".test.js")), join(directory, "lib/analysis-capabilities.test.js")], { stdio: "inherit", env: { ...process.env, NODE_PATH: resolve("node_modules") } });
process.exitCode = result.status ?? 1;
