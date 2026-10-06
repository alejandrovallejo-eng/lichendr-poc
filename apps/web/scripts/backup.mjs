import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { inspectArchive, restoreArchive } from "./backup-archive.mjs";
const [mode, path, ...extra] = process.argv.slice(2);
if (!["--verify", "--restore"].includes(mode) || !path || extra.length) throw new Error("Uso: npm run backup -- --verify /ruta/copia.tar (o --restore, con sesión del propietario original)");
const archive = inspectArchive(await readFile(path));
console.log(`Copia íntegra: ${Object.keys(archive.snapshot.tables).length} tablas, ${archive.manifest.objects.length} archivos comprobados.`);
if (mode === "--restore") {
  nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), false, { info() {}, error() {} });
  const token = process.env.SUPABASE_BACKUP_ACCESS_TOKEN;
  if (!token) throw new Error("Falta SUPABASE_BACKUP_ACCESS_TOKEN del propietario original. Usa un archivo local protegido; no pegues la sesión en la terminal ni la guardes en Git.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await db.auth.getUser(token);
  if (auth.error || auth.data.user?.id !== archive.snapshot.ownerId) throw new Error("La sesión no corresponde al propietario de esta copia.");
  // getUser() on a header-only client needs the token supplied explicitly.
  db.auth.getUser = () => Promise.resolve(auth);
  await restoreArchive(db, archive);
  console.log("Registros y archivos restaurados sin sobrescribir datos existentes. Abre las fotos para reconstruir sus manifiestos de análisis si es necesario.");
}
