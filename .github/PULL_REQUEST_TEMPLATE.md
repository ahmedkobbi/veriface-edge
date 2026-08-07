## 🔄 Pull Request Description

### What does this PR do?

A clear and concise description of the changes.

### Related Issue(s)

Fixes #123
Closes #456
Refs #789

## 📋 Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🧪 Test addition/improvement
- [ ] 🔒 Security fix
- [ ] ♻️ Refactor (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] 🏗️ Build/CI changes

## 🛡️ Security Checklist

If this PR touches security-sensitive code, please confirm:

- [ ] No secrets, API keys, or PII are logged
- [ ] All inputs are validated (Zod schemas where applicable)
- [ ] Constant-time comparisons used for any secret comparison
- [ ] Audit log entries added for security-relevant actions
- [ ] No security features disabled (rate limiting, CSRF, etc.)
- [ ] I have read the [Threat Model](docs/THREAT_MODEL.md)

## 🧪 Testing

- [ ] I have added tests for my changes
- [ ] All existing tests pass (`bun test`)
- [ ] TypeScript compiles without errors (`bunx tsc --noEmit`)
- [ ] Linting passes (`bun run lint`)

### Test Evidence

```
Paste test output here showing your changes pass
```

## 📸 Screenshots / Demos

If applicable, add screenshots or demo recordings.

## ✅ Pre-Merge Checklist

- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published in downstream modules

## 📝 Additional Notes

Any additional information for reviewers.

---

**For maintainers:**

- [ ] CI passes
- [ ] Code review completed
- [ ] Security review (if applicable)
- [ ] Documentation updated
- [ ] Ready to merge
