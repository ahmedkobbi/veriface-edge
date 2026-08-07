import { NextResponse } from "next/server";

/**
 * GET /api
 * API discovery endpoint — returns available routes, version, and capabilities.
 */
export async function GET() {
  return NextResponse.json({
    name: "VeriFace Edge API",
    version: "v1",
    description: "Privacy-first web facial authentication SDK",
    endpoints: {
      tenant: "/api/tenant",
      session: {
        init: "/api/session/init",
        verify: "/api/session/verify",
        cleanup: "/api/session/cleanup",
      },
      token: {
        verify: "/api/token/verify",
        revoke: "/api/token/revoke",
      },
      audit: {
        query: "/api/audit",
        export: "/api/audit/export",
        verify: "/api/verify-audit",
      },
      templates: {
        delete: "/api/templates/delete",
        export: "/api/templates/export",
      },
      apiKeys: {
        create: "/api/api-keys/create",
        list: "/api/api-keys/list",
        revoke: "/api/api-keys/revoke",
      },
      webauthn: {
        registerBegin: "/api/webauthn/register/begin",
        registerFinish: "/api/webauthn/register/finish",
        authBegin: "/api/webauthn/auth/begin",
        authFinish: "/api/webauthn/auth/finish",
      },
      consent: "/api/consent",
      bulk: "/api/bulk",
      webhook: {
        process: "/api/webhook/process",
        config: "/api/tenant/webhook",
      },
      health: "/api/health",
      metrics: "/api/metrics",
      retention: "/api/retention/cleanup",
    },
    oidc: {
      discovery: "/.well-known/openid-configuration",
      authorize: "/oauth/authorize",
      token: "/oauth/token",
      userinfo: "/userinfo",
    },
    documentation: "/docs",
  });
}
