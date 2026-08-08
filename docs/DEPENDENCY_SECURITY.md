# VeriFace Edge — Dependency Security Policy

## Pinned Dependencies (Critical Security Libraries)

The following dependencies are pinned to exact versions (no `^` or `~` prefix)
because they implement security-critical cryptography. A minor version bump
could introduce a vulnerability or break compatibility with our ZK proof
system, post-quantum signatures, or audit hash chain.

| Package | Pinned Version | Rationale |
|---------|---------------|-----------|
| `@noble/post-quantum` | `0.6.1` | ML-DSA-87 (FIPS 204) — pre-standardization; monitor for CVEs |
| `@noble/curves` | `^2.3.0` | Ed25519, X25519 — allow minor bumps (bug fixes) |
| `@noble/hashes` | `^2.3.0` | SHA-256, BLAKE3, HKDF — allow minor bumps |
| `@noble/ciphers` | `^2.2.0` | AES-256-GCM — allow minor bumps |
| `@noble/ed25519` | `^3.1.0` | Ed25519 signing — allow minor bumps |
| `snarkjs` | (see package.json) | PLONK zk-SNARK verification |

## SECURITY FIX (I-7): @noble/post-quantum Monitoring

`@noble/post-quantum` implements ML-DSA-87 (FIPS 204), which is:
- **Pre-standardization**: FIPS 204 was finalized in August 2024, but the
  implementation may not yet be FIPS-validated (no CMVP certificate).
- **Monitor for CVEs**: The library is new and may have undiscovered bugs.
- **Pin to exact version**: `0.6.1` — no auto-upgrades. Bumps require manual
  review of the changelog + diff + CVE database.

### Monitoring Process

1. **Weekly**: Run `bun audit` in CI (see `.github/workflows/ci.yml`).
2. **On CVE**: If a CVE is published against `@noble/post-quantum`:
   - Assess severity (CVSS score)
   - If CVSS ≥ 7.0: emergency upgrade within 24 hours
   - If CVSS < 7.0: upgrade within 7 days
3. **On FIPS 204 update**: If NIST publishes a revision to FIPS 204:
   - Review the changes
   - Update the library if compatibility is maintained
   - Re-run the FIPS self-tests (see `src/lib/fips/index.ts`)

### Alternative Libraries (if @noble/post-quantum is compromised)

If `@noble/post-quantum` must be replaced, the following alternatives
implement ML-DSA-87:
- `liboqs-js` (bindings to liboqs — NIST reference implementation)
- `pqclean` (compiled to WASM)
- AWS KMS (cloud-hosted post-quantum signing — no client-side library)

The crypto abstraction layer (`src/lib/post-quantum-server.ts`) isolates
the library choice — swapping requires updating only that file.

## SECURITY FIX (I-8): CI Dependency Audit

The CI pipeline (`.github/workflows/ci.yml`) runs:
1. `bun audit` — checks the dependency tree against the GitHub Advisory Database
2. `bun pm ls` — verifies the installed versions match the lockfile
3. GitHub CodeQL — static analysis for vulnerability patterns
4. Dependabot — automated PRs for outdated dependencies (configured in
   `.github/dependabot.yml`)

### Audit Failure Policy

- **Critical/High CVE**: CI fails (blocks merge)
- **Medium CVE**: CI warns (allows merge, creates issue)
- **Low CVE**: CI passes (tracked in backlog)

## Lockfile Integrity

- `bun.lock` is committed to the repository
- `bun install --frozen-lockfile` is used in CI (refuses to update the lockfile)
- Lockfile changes require PR review + approval

## Supply Chain Hardening

- All packages are installed from the public npm registry (no custom registries)
- `npm provenance` is verified for packages that support it
- SBOM (Software Bill of Materials) is generated on each release
  (via `bun pm ls --json > sbom.json`)
