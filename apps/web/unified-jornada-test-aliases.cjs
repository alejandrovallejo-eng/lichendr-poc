// Test-only resolver. Never imported by the application or used with real credentials.
const Module = require("node:module");
const path = require("node:path");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  if (id === "@/lib/supabase/client") id = path.resolve(__dirname, "test-stubs/@/lib/supabase/client.js");
  else if (id.startsWith("@/")) id = path.resolve(__dirname, ".test-build/unified-jornada", id.slice(2));
  return resolve.call(this, id, ...args);
};
