import { assert, it } from "@effect/vitest";

import { codexProxyUsageRequest, parseCodexProxyUsage } from "./codexProxyUsage.ts";

const proxyConfig = (provider: Record<string, unknown>) => ({
  model_provider: "recodex",
  model_providers: { recodex: provider },
});

it("builds the usage request for a ChatGPT-backend proxy", () => {
  assert.deepStrictEqual(
    codexProxyUsageRequest(
      proxyConfig({
        base_url: "http://127.0.0.1:57721/backend-api/codex",
        experimental_bearer_token: "token",
        http_headers: { "x-openai-actor-authorization": "recodex" },
      }),
      {},
    ),
    {
      url: "http://127.0.0.1:57721/backend-api/wham/usage",
      headers: { "x-openai-actor-authorization": "recodex", Authorization: "Bearer token" },
    },
  );
});

it("reads the proxy token from env_key", () => {
  assert.strictEqual(
    codexProxyUsageRequest(
      proxyConfig({ base_url: "https://proxy.test/backend-api/codex/", env_key: "PROXY_KEY" }),
      { PROXY_KEY: "env-token" },
    )?.headers.Authorization,
    "Bearer env-token",
  );
});

it("ignores routes that are not ChatGPT-backend proxies", () => {
  const env = {};
  assert.strictEqual(
    codexProxyUsageRequest(
      proxyConfig({ base_url: "http://127.0.0.1:15721/v1", experimental_bearer_token: "t" }),
      env,
    ),
    undefined,
  );
  assert.strictEqual(
    codexProxyUsageRequest(
      proxyConfig({ base_url: "http://127.0.0.1:57721/backend-api/codex" }),
      env,
    ),
    undefined,
  );
  assert.strictEqual(codexProxyUsageRequest({ model_provider: "openai" }, env), undefined);
  assert.strictEqual(codexProxyUsageRequest(undefined, env), undefined);
});

it("maps the wham usage response", () => {
  assert.deepStrictEqual(
    parseCodexProxyUsage({
      email: "lease@example.com",
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: 1795574382 },
        secondary_window: null,
      },
    }),
    {
      email: "lease@example.com",
      planType: "pro",
      snapshot: {
        planType: "pro",
        primary: { usedPercent: 2, resetsAt: 1795574382, windowDurationMins: 10080 },
        secondary: null,
      },
    },
  );
  assert.strictEqual(parseCodexProxyUsage({ error: "nope" }), undefined);
});
