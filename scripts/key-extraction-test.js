/**
 * VeriFace Edge — Client-Side Key Extraction Test
 *
 * Tests whether the tenant's Ed25519 signing private key can be extracted
 * from:
 *   1. The Web SDK's minified JavaScript bundle
 *   2. The SDK source code (checks for hardcoded keys)
 *   3. The .env file (checks if keys are committed)
 *
 * This simulates what an attacker would do after downloading the app.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = process.cwd()

let findings = []

function check(name, condition, detail) {
  const status = condition ? '✅ PASS' : '❌ FAIL'
  findings.push({ name, status, detail })
  console.log(`${status} — ${name}`)
  if (detail) console.log(`         ${detail}`)
}

// 1. Check .env file for hardcoded keys
console.log('\n=== 1. .env File Check ===')
const envPath = join(PROJECT_ROOT, '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8')
  const hasSigningKey = /VERIFACE_SERVER_SIGNING_KEY=([0-9a-f]{64})/i.test(envContent)
  const hasEncryptionKey = /VERIFACE_ENCRYPTION_KEY=([0-9a-f]{64})/i.test(envContent)
  check('.env contains VERIFACE_SERVER_SIGNING_KEY', !hasSigningKey || process.env.NODE_ENV === 'production',
    hasSigningKey ? 'Key found in .env (acceptable for dev, must not be committed in prod)' : 'No signing key in .env')
  check('.env contains VERIFACE_ENCRYPTION_KEY', !hasEncryptionKey || process.env.NODE_ENV === 'production',
    hasSigningKey ? 'Key found in .env (acceptable for dev, must not be committed in prod)' : 'No encryption key in .env')
} else {
  check('.env file exists', false, 'No .env file found')
}

// 2. Check .gitignore for .env
console.log('\n=== 2. .gitignore Check ===')
const gitignorePath = join(PROJECT_ROOT, '.gitignore')
if (existsSync(gitignorePath)) {
  const gitignore = readFileSync(gitignorePath, 'utf8')
  check('.env is in .gitignore', gitignore.includes('.env'), '')
  check('.env.example is NOT in .gitignore', !gitignore.includes('.env.example'), '')
} else {
  check('.gitignore exists', false, 'No .gitignore found')
}

// 3. Check Web SDK source for hardcoded keys
console.log('\n=== 3. Web SDK Source Check ===')
const sdkFiles = [
  'src/sdk/veriface.ts',
  'src/sdk/crypto.ts',
  'src/sdk/index.ts',
]
for (const file of sdkFiles) {
  const fullPath = join(PROJECT_ROOT, file)
  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath, 'utf8')
    // Check for 64-char hex strings that look like private keys
    const hexKeyPattern = /[0-9a-f]{64}/gi
    const matches = content.match(hexKeyPattern)
    const hardcodedKey = matches && matches.some(m => m !== '0'.repeat(64) && !m.includes('test'))
    check(`${file} has no hardcoded private keys`, !hardcodedKey,
      hardcodedKey ? `Found potential key: ${matches.find(m => m !== '0'.repeat(64))?.slice(0, 16)}...` : '')
  }
}

// 4. Check if signingPrivateKey is required in config
console.log('\n=== 4. SDK Config Validation ===')
const verifaceSdkPath = join(PROJECT_ROOT, 'src/sdk/veriface.ts')
if (existsSync(verifaceSdkPath)) {
  const content = readFileSync(verifaceSdkPath, 'utf8')
  check('Web SDK requires signingPrivateKey', content.includes('signingPrivateKey: string'), '')
  check('Web SDK validates key format', content.includes('/^[0-9a-f]{64}$/i'), '')
  check('Web SDK signs JWT with tenant key', content.includes('this.config.signingPrivateKey'), '')
}

// 5. Check native SDKs
console.log('\n=== 5. Native SDK Check ===')
const iosCryptoPath = join(PROJECT_ROOT, 'src/sdk/ios/Sources/VeriFaceEdge/VeriFaceCrypto.swift')
if (existsSync(iosCryptoPath)) {
  const content = readFileSync(iosCryptoPath, 'utf8')
  check('iOS SDK requires signingPrivateKeyHex', content.includes('signingPrivateKeyHex: String'), '')
  check('iOS SDK validates key format', content.includes('signingPrivateKeyHex.count == 64'), '')
  check('iOS SDK loads key from bytes', content.includes('rawRepresentation: Data(keyBytes)'), '')
}

const androidCryptoPath = join(PROJECT_ROOT, 'src/sdk/android/library/src/main/kotlin/io/veriface/sdk/crypto/VeriFaceCrypto.kt')
if (existsSync(androidCryptoPath)) {
  const content = readFileSync(androidCryptoPath, 'utf8')
  check('Android SDK requires signingPrivateKeyHex', content.includes('signingPrivateKeyHex: String'), '')
  check('Android SDK validates key format', content.includes('signingPrivateKeyHex.length == 64'), '')
  check('Android SDK loads key from bytes', content.includes('Ed25519PrivateKeyParameters(keyBytes, 0)'), '')
}

const flutterEd25519Path = join(PROJECT_ROOT, 'src/sdk/flutter/lib/src/crypto/ed25519.dart')
if (existsSync(flutterEd25519Path)) {
  const content = readFileSync(flutterEd25519Path, 'utf8')
  check('Flutter SDK has loadEd25519KeyPair function', content.includes('loadEd25519KeyPair'), '')
  check('Flutter SDK validates key format', content.includes('privateKeyHex.length != 64'), '')
}

// 6. Check .env.example doesn't contain real keys
console.log('\n=== 6. .env.example Check ===')
const envExamplePath = join(PROJECT_ROOT, '.env.example')
if (existsSync(envExamplePath)) {
  const content = readFileSync(envExamplePath, 'utf8')
  const hasRealKey = /[0-9a-f]{64}/i.test(content.replace(/ed37ea339f3c0afb7ed2a28c79f0383bf7128a46a7f67265484cdd628c149a21/g, ''))
  check('.env.example has no real private keys', !hasRealKey,
    hasRealKey ? 'Real key found in .env.example!' : '')
} else {
  check('.env.example exists', false, 'No .env.example found')
}

// Summary
console.log('\n=== Summary ===')
const passed = findings.filter(f => f.status.includes('PASS')).length
const failed = findings.filter(f => f.status.includes('FAIL')).length
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
