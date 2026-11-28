import { env } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { headers } from "next/headers";

export type AuthenticatedUser = {
  id: string;
  email: string;
  provider: "chatgpt-sites" | "cloudflare-access";
};

const CHATGPT_USER_ID_HEADER = "oai-authenticated-user-id";
const CHATGPT_USER_EMAIL_HEADER = "oai-authenticated-user-email";
const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

let remoteKeys:
  | {
      issuer: string;
      audience: string;
      keys: JWTVerifyGetKey;
    }
  | undefined;

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const requestHeaders = await headers();

  const chatGPTUserId = requestHeaders.get(CHATGPT_USER_ID_HEADER)?.trim();
  const chatGPTEmail = normalizeEmail(
    requestHeaders.get(CHATGPT_USER_EMAIL_HEADER),
  );
  if (chatGPTUserId && chatGPTEmail) {
    return {
      id: chatGPTUserId,
      email: chatGPTEmail,
      provider: "chatgpt-sites",
    };
  }

  const token = requestHeaders.get(ACCESS_JWT_HEADER)?.trim();
  const accessEmail = normalizeEmail(requestHeaders.get(ACCESS_EMAIL_HEADER));
  const config = cloudflareAccessConfig();
  if (!token || !config) return null;

  try {
    const { payload } = await jwtVerify(token, config.keys, {
      issuer: config.issuer,
      audience: config.audience,
    });
    const tokenEmail = normalizeEmail(
      typeof payload.email === "string" ? payload.email : null,
    );
    if (!tokenEmail || (accessEmail && accessEmail !== tokenEmail)) return null;

    return {
      id:
        typeof payload.sub === "string" && payload.sub
          ? payload.sub
          : `cloudflare-access:${tokenEmail}`,
      email: tokenEmail,
      provider: "cloudflare-access",
    };
  } catch (error) {
    console.warn(
      "Cloudflare Access authentication failed",
      error instanceof Error ? error.message : "Unknown verification error",
    );
    return null;
  }
}

function cloudflareAccessConfig() {
  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const audience = String(env.CF_ACCESS_AUD ?? "").trim();
  if (!teamDomain || !audience) return null;

  const issuer = normalizeAccessIssuer(teamDomain);
  if (!issuer) return null;

  if (
    !remoteKeys ||
    remoteKeys.issuer !== issuer ||
    remoteKeys.audience !== audience
  ) {
    remoteKeys = {
      issuer,
      audience,
      keys: createRemoteJWKSet(
        new URL("/cdn-cgi/access/certs", `${issuer}/`),
      ),
    };
  }
  return remoteKeys;
}

function normalizeAccessIssuer(value: string): string | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !url.hostname.toLowerCase().endsWith(".cloudflareaccess.com")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeEmail(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}
