import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import type { CodexRateLimitSnapshot } from "./codexUsageLimits.ts";

/**
 * Some Codex model providers are local proxies that forward the whole ChatGPT
 * backend (for example ReCodex in lease mode). Codex itself has no ChatGPT
 * login there, so `account/read` and `account/rateLimits/read` return nothing,
 * but the proxy answers the same `wham/usage` request the ChatGPT backend does.
 */
const ProxyRoutingConfig = Schema.Struct({
  model_provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model_providers: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        base_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
        experimental_bearer_token: Schema.optionalKey(Schema.NullOr(Schema.String)),
        env_key: Schema.optionalKey(Schema.NullOr(Schema.String)),
        http_headers: Schema.optionalKey(
          Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
        ),
      }),
    ),
  ),
});
const decodeProxyRoutingConfig = Schema.decodeUnknownOption(ProxyRoutingConfig);

const ProxyWindow = Schema.Struct({
  used_percent: Schema.Number,
  reset_at: Schema.optional(Schema.NullOr(Schema.Number)),
  limit_window_seconds: Schema.optional(Schema.NullOr(Schema.Number)),
});
const ProxyUsage = Schema.Struct({
  email: Schema.optional(Schema.NullOr(Schema.String)),
  plan_type: Schema.optional(Schema.NullOr(Schema.String)),
  rate_limit: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        primary_window: Schema.optional(Schema.NullOr(ProxyWindow)),
        secondary_window: Schema.optional(Schema.NullOr(ProxyWindow)),
      }),
    ),
  ),
});
const decodeProxyUsage = Schema.decodeUnknownOption(ProxyUsage);

export interface CodexProxyUsageRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface CodexProxyUsage {
  readonly email: string | undefined;
  readonly planType: string | undefined;
  readonly snapshot: CodexRateLimitSnapshot;
}

const CHATGPT_BACKEND_CODEX_PATH = /\/backend-api\/codex\/?$/u;

/** The usage request for a ChatGPT-backend proxy provider, or undefined for any other route. */
export function codexProxyUsageRequest(
  config: unknown,
  environment: NodeJS.ProcessEnv,
): CodexProxyUsageRequest | undefined {
  const routing = Option.getOrUndefined(decodeProxyRoutingConfig(config));
  const providerId = routing?.model_provider;
  if (!routing || !providerId || providerId === "openai") return undefined;
  const provider = routing.model_providers?.[providerId];
  const baseUrl = provider?.base_url ? URL.parse(provider.base_url) : null;
  if (!baseUrl || !/^https?:$/u.test(baseUrl.protocol)) return undefined;
  if (!CHATGPT_BACKEND_CODEX_PATH.test(baseUrl.pathname)) return undefined;
  const token =
    provider?.experimental_bearer_token?.trim() ||
    (provider?.env_key ? environment[provider.env_key]?.trim() : undefined);
  if (!token) return undefined;
  baseUrl.pathname = baseUrl.pathname.replace(
    CHATGPT_BACKEND_CODEX_PATH,
    "/backend-api/wham/usage",
  );
  baseUrl.search = "";
  return {
    url: baseUrl.toString(),
    headers: { ...provider?.http_headers, Authorization: `Bearer ${token}` },
  };
}

export function parseCodexProxyUsage(body: unknown): CodexProxyUsage | undefined {
  const usage = Option.getOrUndefined(decodeProxyUsage(body));
  if (!usage?.rate_limit) return undefined;
  const toWindow = (window: typeof ProxyWindow.Type | null | undefined) =>
    window
      ? {
          usedPercent: window.used_percent,
          resetsAt: window.reset_at ?? null,
          ...(typeof window.limit_window_seconds === "number"
            ? { windowDurationMins: window.limit_window_seconds / 60 }
            : {}),
        }
      : null;
  const planType = usage.plan_type?.trim() || undefined;
  return {
    email: usage.email?.trim() || undefined,
    planType,
    snapshot: {
      planType: planType ?? null,
      primary: toWindow(usage.rate_limit.primary_window),
      secondary: toWindow(usage.rate_limit.secondary_window),
    },
  };
}

const fetchCodexProxyUsage = Effect.fn("CodexProxyUsage.fetch")(function* (
  request: CodexProxyUsageRequest,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(
    HttpClientRequest.get(request.url).pipe(HttpClientRequest.setHeaders(request.headers)),
  );
  if (response.status < 200 || response.status >= 300) return undefined;
  return parseCodexProxyUsage(yield* response.json);
});

/** Usage is an enrichment: any failure means "no proxy usage", never a failed probe. */
export const readCodexProxyUsage = (request: CodexProxyUsageRequest, timeoutMs: number) =>
  fetchCodexProxyUsage(request).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catch((cause) =>
      Effect.logDebug("Codex proxy usage read failed.", { cause }).pipe(Effect.as(undefined)),
    ),
  );
