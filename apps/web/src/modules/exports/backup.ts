import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataExport } from "./data";
export interface BackupObject { path: string; size: number; sha256: string; archivePath: string; contentType: string }
export interface BackupManifest { version: 1; scope: "current_user"; ownerId: string; generatedAt: string; objects: BackupObject[] }
/** Portable uncompressed ustar; Blob parts avoid a second complete byte copy. */
export function tar(files: { path: string; blob: Blob }[]) {
  const parts: BlobPart[] = [];
  for (const file of files) {
    if (!/^[a-zA-Z0-9/_.-]{1,100}$/.test(file.path) || file.path.includes("..")) throw new Error("Ruta de archivo inválida.");
    const header = new Uint8Array(512), encoder = new TextEncoder();
    const put = (offset: number, value: string) => header.set(encoder.encode(value), offset);
    put(0, file.path); put(100, "0000600\0"); put(108, "0000000\0"); put(116, "0000000\0");
    put(124, file.blob.size.toString(8).padStart(11, "0") + "\0"); put(136, "00000000000\0");
    header.fill(32, 148, 156); header[156] = 48; put(257, "ustar\0"); put(263, "00");
    put(148, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ");
    parts.push(header, file.blob, new Uint8Array((512 - file.blob.size % 512) % 512));
  }
  parts.push(new Uint8Array(1024));
  return new Blob(parts, { type: "application/x-tar" });
}
export async function backupArchive(db: SupabaseClient, snapshot: DataExport, progress: (message: string) => void) {
  async function owner() {
    const { data, error } = await db.auth.getUser();
    if (error || data.user?.id !== snapshot.ownerId) throw new Error("La sesión cambió. No se creó una copia parcial.");
  }
  await owner();
  const bucket = db.storage.from("lichen-images");
  const maxBytes = 256 * 1024 * 1024;
  async function listObjects() {
    const pending = [snapshot.ownerId], paths: { path: string; contentType: string; updatedAt: string; size: number }[] = [];
    while (pending.length) {
      const prefix = pending.shift()!;
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await bucket.list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
        if (error || !data) throw new Error("No se pudieron listar tus fotografías. No se creó una copia parcial.");
        for (const item of data) {
          if (!item.name || item.name.includes("/") || item.name === "." || item.name === "..") throw new Error("Ruta de almacenamiento inválida.");
          const path = `${prefix}/${item.name}`;
          if (!item.id) pending.push(path);
          else paths.push({ path, contentType: item.metadata?.mimetype || "application/octet-stream", updatedAt: item.updated_at ?? "", size: Number(item.metadata?.size ?? 0) });
        }
        if (paths.length + pending.length > 20_000) throw new Error("Usa un respaldo administrativo para este volumen de archivos.");
        if (data.length < 100) break;
      }
    }
    return paths.sort((a,b) => a.path.localeCompare(b.path));
  }
  const paths = await listObjects();
  if (paths.reduce((total,item) => total + item.size,0) > maxBytes) throw new Error("Esta copia supera 256 MiB. Usa un respaldo administrativo de Storage.");
  const objects: BackupObject[] = [], files: { path: string; blob: Blob }[] = [];
  let total = 0;
  for (const item of paths) {
    progress(`Guardando archivo ${objects.length + 1} de ${paths.length}…`);
    const { data, error } = await bucket.download(item.path);
    if (error || !data) throw new Error("No se pudo descargar una fotografía. No se creó una copia parcial.");
    total += data.size;
    if (total > maxBytes) throw new Error("Esta copia supera 256 MiB. Usa un respaldo administrativo de Storage.");
    const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    const archivePath = `files/${String(objects.length + 1).padStart(6, "0")}.bin`;
    objects.push({ path: item.path, contentType: item.contentType, archivePath, size: data.size, sha256 }); files.push({ path: archivePath, blob: data });
  }
  await owner();
  if (JSON.stringify(paths) !== JSON.stringify(await listObjects())) throw new Error("Tus archivos cambiaron durante la copia. Genera una nueva copia después de guardar tus fotos.");
  const manifest: BackupManifest = { version: 1, scope: "current_user", ownerId: snapshot.ownerId, generatedAt: snapshot.generatedAt, objects };
  return tar([{ path: "records.json", blob: new Blob([JSON.stringify(snapshot)]) }, { path: "manifest.json", blob: new Blob([JSON.stringify(manifest)]) }, ...files]);
}
