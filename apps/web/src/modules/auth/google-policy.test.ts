import { strict as assert } from "node:assert";
import { test } from "node:test";
import { googleAction, linkedUserMatches, authMessage } from "./google-policy";

const anonymous = { id: "original", is_anonymous: true };
const permanent = { id: "original", is_anonymous: false, email: "example@example.com", identities: [{ provider: "google" }] };
test("an existing anonymous user always links by default", () => assert.equal(googleAction(anonymous, "connect", 12), "link"));
test("new browser can sign in without first creating an anonymous account", () => assert.equal(googleAction(null, "connect", null), "signin"));
test("recovery refuses to abandon projects", () => assert.equal(googleAction(anonymous, "recover", 1), "protect"));
test("failed project count is not treated as empty", () => assert.equal(googleAction(anonymous, "recover", null), "protect"));
test("explicit recovery permitted only for an empty session", () => assert.equal(googleAction(anonymous, "recover", 0), "signin"));
test("a permanent session cannot switch accounts through this feature", () => assert.equal(googleAction(permanent, "recover", 0), "connected"));
test("unknown action cannot bypass linking", () => assert.equal(googleAction(anonymous, "other", 0), "link"));
test("link accepts only original UID and permanent Google identity", () => {
  assert.equal(linkedUserMatches("original", permanent), true);
  assert.equal(linkedUserMatches("original", { ...permanent, id: "different" }), false);
  assert.equal(linkedUserMatches("original", anonymous), false);
  assert.equal(linkedUserMatches("original", { ...permanent, identities: [] }), false);
  assert.equal(linkedUserMatches("original", null), false);
});
test("normal login still requires a permanent Google identity", () => {
  assert.equal(linkedUserMatches("signin", permanent), true);
  assert.equal(linkedUserMatches("signin", anonymous), false);
});
test("provider error descriptions are never rendered", () => assert.equal(authMessage("<script>secret</script>"), null));
