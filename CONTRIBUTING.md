# Contributing to VeriFace Edge

Thanks for your interest in contributing! 🎉

This document outlines how to contribute to VeriFace Edge — a privacy-first facial authentication platform.

## 🚀 Quick Start for Contributors

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/veriface-edge.git
cd veriface-edge
git remote add upstream https://github.com/ahmedkobbi/veriface-edge.git

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env — set VERIFACE_SERVER_SIGNING_KEY (openssl rand -hex 32)

# Initialize database
bun run db:push

# Start dev server
bun run dev
```

## 🛠️ Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** — follow the existing code style.

3. **Run tests**:
   ```bash
   bun test                          # Run all tests
   bun test tests/crypto.test.ts     # Run a specific test file
   bunx tsc --noEmit                 # Type check
   bun run lint                      # Lint
   ```

4. **Commit with conventional commits**:
   ```bash
   git commit -m "feat: add new liveness algorithm"
   git commit -m "fix: race condition in audit log"
   git commit -m "docs: update threat model"
   git commit -m "test: add cross-platform crypto tests"
   git commit -m "chore: bump dependencies"
   ```

5. **Push and open a PR**:
   ```bash
   git push origin feat/my-feature
   ```
   Then open a PR against `main` on GitHub.

## 📋 Code Style

- **TypeScript**: strict mode, no `any` without justification
- **Formatting**: 2-space indentation, single quotes, no semicolons (matches existing code)
- **Naming**: camelCase for variables/functions, PascalCase for classes/types
- **Comments**: JSDoc on exported functions
- **Tests**: required for new crypto primitives, API endpoints, and SDK public APIs

## 🔒 Security Considerations

This project handles biometric data and cryptographic keys. Before contributing:

1. **Read the [Threat Model](docs/THREAT_MODEL.md)** — understand the security model.
2. **Never log secrets, embeddings, or face data.**
3. **Never disable security features** (rate limiting, input validation, CSRF protection) without explicit approval.
4. **Use constant-time comparisons** for any secret comparison.
5. **Validate all inputs** with Zod schemas.
6. **Add audit log entries** for any security-relevant action.

### Reporting Security Vulnerabilities

**DO NOT open a public issue for security vulnerabilities.** Instead:

1. Go to https://github.com/ahmedkobbi/veriface-edge/security/advisories/new
2. Click "Report a vulnerability"
3. Describe the vulnerability + reproduction steps
4. We'll respond within 48 hours

## 🧪 Testing Guidelines

- **Unit tests**: test pure functions in isolation (`tests/*.test.ts`)
- **Integration tests**: test API endpoints with a real database (`tests/integration.test.ts`)
- **Cross-platform tests**: verify crypto/API compatibility across SDKs (`tests/cross-platform.test.ts`)
- **Security tests**: verify attack vectors are blocked (`tests/security.test.ts`, `tests/ssrf.test.ts`)

### Test Naming

```ts
describe('Module name', () => {
  it('does X when Y', () => { ... })
  it('rejects Z', () => { ... })
  it('handles edge case: empty input', () => { ... })
})
```

## 📦 Project Structure

```
src/
├── app/api/           # Next.js API routes (66 endpoints)
├── components/        # React components (admin, customer, premium, brand)
├── lib/               # Backend libraries (auth, crypto, db, email, etc.)
├── sdk/               # Web SDK + 4 native SDKs
│   ├── *.ts           # Web SDK (browser)
│   ├── react-native/  # React Native SDK
│   ├── flutter/       # Flutter SDK (Dart)
│   ├── ios/           # iOS native SDK (Swift)
│   └── android/       # Android native SDK (Kotlin)
├── hooks/             # React hooks
└── middleware.ts      # Next.js edge middleware

tests/                 # Test suite (162 tests)
prisma/                # Database schema
docs/                  # Documentation
.github/workflows/     # CI/CD pipelines
```

## 🏷️ Commit Message Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Type | Use for |
|------|---------|
| `feat` | New features |
| `fix` | Bug fixes |
| `docs` | Documentation changes |
| `test` | Test additions/changes |
| `refactor` | Code refactoring (no behavior change) |
| `perf` | Performance improvements |
| `chore` | Build, dependencies, tooling |
| `security` | Security fixes |
| `breaking` | Breaking changes (use with `!`) |

Examples:
```
feat: add A/B testing framework for liveness thresholds
fix: race condition in audit log chain indexing
docs: update SDK installation guide
test: add PII redaction tests for telemetry
security: enforce CRON_SECRET in production
breaking!: rename Tenant.rateLimitPerMin to perMinuteLimit
```

## 🔄 Release Process

1. **Maintainer tags a release**: `git tag v1.1.0 && git push origin v1.1.0`
2. **Release workflow runs** automatically (`.github/workflows/release.yml`)
3. **GitHub Release** is created with auto-generated changelog
4. **Source archives** (tar.gz + zip) are attached

## 💬 Getting Help

- 💬 [GitHub Discussions](https://github.com/ahmedkobbi/veriface-edge/discussions) — questions, ideas, show & tell
- 🐛 [Issues](https://github.com/ahmedkobbi/veriface-edge/issues) — bugs, feature requests
- 🔒 [Security Advisories](https://github.com/ahmedkobbi/veriface-edge/security/advisories/new) — vulnerabilities

## 📜 Code of Conduct

Be respectful. Be constructive. Assume good intent.

Harassment, discrimination, or hostile behavior will not be tolerated. We're building privacy-first tooling for everyone — let's keep the community welcoming.

## 📄 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
