import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { type GatewayConfig, googleIdTokenIssuers } from "../config.js";
import { SignInError } from "./errors.js";
import { randomUrlToken } from "./random.js";

const discoverySchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  id_token_signing_alg_values_supported: z.array(z.string().min(1)).optional(),
});

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

export type OidcDiscovery = z.infer<typeof discoverySchema>;

export type GoogleIdentity = {
  sub: string;
  email: string;
};

type CachedDiscovery = {
  doc: OidcDiscovery;
  expiresAt: number;
};

let discoveryCache: CachedDiscovery | null = null;
let jwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUri: string | null = null;

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function emailVerifiedClaim(value: unknown): boolean | undefined {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return undefined;
}

export function createOauthSecrets(config: GatewayConfig): {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomUrlToken(config.OAUTH_TOKEN_BYTES);
  const nonce = randomUrlToken(config.OAUTH_TOKEN_BYTES);
  const codeVerifier = randomUrlToken(config.OAUTH_TOKEN_BYTES);
  return {
    state,
    nonce,
    codeVerifier,
    codeChallenge: pkceChallenge(codeVerifier),
  };
}

export async function loadOidcDiscovery(
  config: GatewayConfig,
): Promise<OidcDiscovery> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expiresAt > now) {
    return discoveryCache.doc;
  }
  const response = await fetch(config.GOOGLE_OIDC_DISCOVERY_URL, {
    signal: AbortSignal.timeout(config.OIDC_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SignInError(`oidc discovery http ${response.status}`);
  }
  const parsed = discoverySchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new SignInError("oidc discovery document invalid");
  }
  discoveryCache = {
    doc: parsed.data,
    expiresAt: now + config.OIDC_DISCOVERY_TTL_SECONDS * 1000,
  };
  return parsed.data;
}

export async function buildGoogleAuthorizationUrl(
  config: GatewayConfig,
  params: {
    state: string;
    nonce: string;
    codeChallenge: string;
  },
): Promise<string> {
  const discovery = await loadOidcDiscovery(config);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", config.GOOGLE_CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.GOOGLE_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", config.GOOGLE_PKCE_METHOD);
  if (config.GOOGLE_AUTH_PROMPT) {
    url.searchParams.set("prompt", config.GOOGLE_AUTH_PROMPT);
  }
  return url.toString();
}

export async function exchangeAuthorizationCode(
  config: GatewayConfig,
  params: { code: string; codeVerifier: string },
): Promise<string> {
  const discovery = await loadOidcDiscovery(config);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: config.GOOGLE_CALLBACK_URL,
    code_verifier: params.codeVerifier,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(config.OIDC_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SignInError(`token exchange http ${response.status}`);
  }
  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new SignInError("token response missing id_token");
  }
  return parsed.data.id_token;
}

export async function verifyGoogleIdToken(
  config: GatewayConfig,
  idToken: string,
  expectedNonce: string,
): Promise<GoogleIdentity> {
  const discovery = await loadOidcDiscovery(config);
  if (!jwksResolver || jwksUri !== discovery.jwks_uri) {
    jwksResolver = createRemoteJWKSet(new URL(discovery.jwks_uri));
    jwksUri = discovery.jwks_uri;
  }
  const issuers = googleIdTokenIssuers(config, discovery.issuer);
  try {
    const { payload } = await jwtVerify(idToken, jwksResolver, {
      issuer: issuers,
      audience: config.GOOGLE_CLIENT_ID,
      clockTolerance: config.OIDC_CLOCK_TOLERANCE_SECONDS,
      ...(discovery.id_token_signing_alg_values_supported
        ? { algorithms: discovery.id_token_signing_alg_values_supported }
        : {}),
    });
    if (payload.nonce !== expectedNonce) {
      throw new SignInError("nonce mismatch");
    }
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new SignInError("id_token missing sub");
    }
    if (typeof payload.email !== "string" || payload.email.length === 0) {
      throw new SignInError("id_token missing email");
    }
    if (config.GOOGLE_REQUIRE_EMAIL_VERIFIED === "true") {
      const verified = emailVerifiedClaim(payload.email_verified);
      if (verified === false) {
        throw new SignInError("email not verified");
      }
    }
    return { sub: payload.sub, email: payload.email };
  } catch (error) {
    if (error instanceof SignInError) {
      throw error;
    }
    throw new SignInError("id_token verification failed");
  }
}
