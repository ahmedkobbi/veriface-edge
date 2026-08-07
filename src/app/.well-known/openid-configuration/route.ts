/**
 * GET /.well-known/openid-configuration
 *
 * OIDC Discovery endpoint. Allows enterprise clients to auto-configure
 * their OIDC clients (libraries like next-auth, passport, oidc-client).
 *
 * VeriFace acts as an OIDC Provider — after successful face auth,
 * clients receive a standard authorization code exchangeable for an
 * ID Token.
 */

import { NextResponse } from 'next/server'

const ISSUER = process.env.OIDC_ISSUER ?? 'http://localhost:3000'

export async function GET() {
  const config = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    response_types_supported: ['code', 'id_token'],
    grant_types_supported: ['authorization_code', 'implicit'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt',
    ],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'auth_time',
      'nonce',
      'amr',
      'acr',
      'tenant_id',
      'session_id',
      'liveness_score',
    ],
    claim_types_supported: ['normal'],
    service_documentation: `${ISSUER}/docs`,
    request_uri_parameter_supported: false,
    require_request_uri_registration: false,
    op_policy_uri: `${ISSUER}/privacy`,
    op_tos_uri: `${ISSUER}/terms`,
  }

  return NextResponse.json(config, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
