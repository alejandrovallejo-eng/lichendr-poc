"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const bioclip_1 = require("./bioclip");
const origin = "https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app";
const request = () => new Request("https://app.example/api/region-suggestions", {
    headers: { "x-vercel-oidc-token": "test-invocation-identity" },
});
function fixture(environment = "production", incoming = request(), workerUrl = origin) {
    const calls = [];
    const fetchImpl = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push({ url, init });
        if (url === "https://sts.googleapis.com/v1/token")
            return Response.json({ access_token: "test-exchanged-token" });
        if (url.endsWith(":generateIdToken"))
            return Response.json({ token: "test-google-identity" });
        return Response.json({ ok: true });
    };
    return { calls, fetchImpl, run: (0, bioclip_1.createBioclipFetch)(incoming, { enabled: true, environment, workerUrl, fetchImpl }) };
}
for (const environment of ["preview", "production"]) {
    (0, node_test_1.default)(`${environment}: lazy exchange, private target, independent bearer, per-request reuse`, async () => {
        const { calls, run } = fixture(environment);
        strict_1.default.equal(calls.length, 0);
        await run(origin + "/health", { headers: { Authorization: "Bearer test-worker-secret" } });
        await run(origin + "/suggest-regions", { method: "POST", body: "{}", headers: { Authorization: "Bearer test-worker-secret" } });
        strict_1.default.equal(calls.length, 4);
        const exchange = JSON.parse(String(calls[0].init?.body));
        strict_1.default.equal(exchange.subjectToken, "test-invocation-identity");
        strict_1.default.equal(exchange.audience, "//iam.googleapis.com/projects/838586175073/locations/global/workloadIdentityPools/lichendr-vercel-preview/providers/vercel");
        strict_1.default.equal(calls[1].url, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/lichendr-vercel-preview@lichendr.iam.gserviceaccount.com:generateIdToken");
        strict_1.default.equal(JSON.parse(String(calls[1].init?.body)).audience, origin);
        for (const call of calls.slice(2)) {
            const headers = new Headers(call.init?.headers);
            strict_1.default.equal(headers.get("Authorization"), "Bearer test-worker-secret");
            strict_1.default.equal(headers.get("X-Serverless-Authorization"), "Bearer test-google-identity");
            strict_1.default.equal(call.init?.redirect, "error");
            strict_1.default.equal(call.init?.cache, "no-store");
        }
    });
}
(0, node_test_1.default)("Storage requests never trigger or receive Google authentication", async () => {
    const { calls, run } = fixture();
    await run("https://storage.example/signed/photo.jpg");
    strict_1.default.equal(calls.length, 1);
    strict_1.default.equal(new Headers(calls[0].init?.headers).has("X-Serverless-Authorization"), false);
});
for (const environment of ["development", "staging", ""]) {
    (0, node_test_1.default)(`reject unapproved environment ${environment || "empty"} before network`, async () => {
        const { calls, run } = fixture(environment);
        await strict_1.default.rejects(run(origin + "/health"), /restricted/);
        strict_1.default.equal(calls.length, 0);
    });
}
(0, node_test_1.default)("reject an unapproved worker before credential exchange", async () => {
    const { calls, run } = fixture("production", request(), "https://unapproved.example");
    await strict_1.default.rejects(run("https://unapproved.example/health"), /restricted/);
    strict_1.default.equal(calls.length, 0);
});
(0, node_test_1.default)("reject unapproved paths before credential exchange", async () => {
    const { calls, run } = fixture();
    await strict_1.default.rejects(run(origin + "/admin"), /path not allowed/);
    strict_1.default.equal(calls.length, 0);
});
(0, node_test_1.default)("missing fresh invocation identity fails without using a build token", async () => {
    const { calls, run } = fixture("production", new Request("https://app.example"));
    await strict_1.default.rejects(run(origin + "/health"), /identity unavailable/);
    strict_1.default.equal(calls.length, 0);
});
(0, node_test_1.default)("disabled IAM preserves the existing local-worker fetch", () => {
    const { fetchImpl } = fixture();
    strict_1.default.equal((0, bioclip_1.createBioclipFetch)(request(), { enabled: false, fetchImpl }), fetchImpl);
});
(0, node_test_1.default)("failed exchanges are redacted and can retry in the same invocation", async () => {
    let exchanges = 0;
    const fetchImpl = async (input) => {
        if (String(input) === "https://sts.googleapis.com/v1/token") {
            exchanges += 1;
            return exchanges === 1 ? new Response("sensitive-detail", { status: 403 }) : Response.json({ access_token: "test-access" });
        }
        if (String(input).endsWith(":generateIdToken"))
            return Response.json({ token: "test-id" });
        return Response.json({ ok: true });
    };
    const run = (0, bioclip_1.createBioclipFetch)(request(), { enabled: true, environment: "production", workerUrl: origin, fetchImpl });
    await strict_1.default.rejects(run(origin + "/health"), { message: "BioCLIP identity exchange failed" });
    strict_1.default.equal((await run(origin + "/health")).status, 200);
    strict_1.default.equal(exchanges, 2);
});
