// Hosted AI is the default: no local Torch installation or duplicated model.
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const web = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
nextEnv.loadEnvConfig(web, true, { info() {}, error() {} });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.LICHENDR_PREVIEW_ONLY === "1") {
  throw new Error("Configura Supabase y LICHENDR_PREVIEW_ONLY=0 en apps/web/.env.local.");
}
if (!process.env.VISION_SERVICE_URL || (process.env.VISION_SERVICE_TOKEN?.length ?? 0) < 32) throw new Error("Configura el servicio MobileSAM y su token existente de al menos 32 caracteres.");
if (process.env.NEXT_PUBLIC_BIOCLIP_SUGGESTIONS === "1") {
  if (!process.env.BIOCLIP_WORKER_URL || !process.env.BIOCLIP_WORKER_TOKEN) throw new Error("BioCLIP está activado pero falta su configuración.");
  if (process.env.BIOCLIP_GOOGLE_DEVELOPER_AUTH === "1") {
    try { execFileSync(process.env.BIOCLIP_GCLOUD_PATH, ["auth", "print-identity-token", "--quiet"], { env: process.env, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error("Inicia sesión con Google Cloud CLI para usar el BioCLIP privado. Ver docs/AI_SETUP.md."); }
  }
}
await import("./copy-onnx-runtime.mjs");
let pids = "";
try { pids = execFileSync("lsof", ["-nP", "-iTCP:3000", "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* No listener. */ }
if (pids) {
  for (const pid of pids.split(/\s+/)) {
    const cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" });
    if (!cwd.split("\n").includes(`n${web}`)) throw new Error("El puerto 3000 pertenece a otro proyecto. No se detuvo ese proceso.");
  }
  console.log("LichenDR ya está abierto en http://localhost:3000; se conserva su proceso.");
} else {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--hostname", "127.0.0.1"], { cwd: web, env: process.env, stdio: "inherit" });
  process.once("SIGINT", () => child.kill("SIGINT")); process.once("SIGTERM", () => child.kill("SIGTERM"));
  child.once("exit", code => { process.exitCode = code ?? 1; });
  for (let count = 0; count < 60; count++) {
    try { const response = await fetch("http://127.0.0.1:3000", { signal: AbortSignal.timeout(2000) }); if (response.ok) break; } catch { /* Starting. */ }
    if (child.exitCode !== null) throw new Error("Next.js terminó antes de estar disponible.");
    await delay(1000);
  }
}
console.log("Datos conectados. Segmentación: MobileSAM. Clasificación: " + (process.env.NEXT_PUBLIC_BIOCLIP_SUGGESTIONS === "1" ? "BioCLIP" : "manual") + ".");
console.log("Verifica motores con npm run check:ai -- --workflow; las comprobaciones reales no se ejecutan automáticamente al arrancar.");
