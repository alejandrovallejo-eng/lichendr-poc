// Test-only stand-in for `@/lib/supabase/client`, resolved through NODE_PATH by
// the component test harness (see `test:component` in package.json).
//
// The real module opens a browser Supabase client at import time, which needs
// project credentials. The component test only needs the signed-in identity, so
// it provides one here. Nothing in the application imports this file.
const userId = process.env.LICHENDR_TEST_USER_ID || "00000000-0000-4000-8000-000000000001";

exports.supabase = {
  auth: {
    async getUser() {
      return { data: { user: { id: userId } }, error: null };
    },
  },
};
