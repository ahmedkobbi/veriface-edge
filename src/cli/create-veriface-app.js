#!/usr/bin/env node
/**
 * create-veriface-app — CLI scaffolding tool
 *
 * Generates a complete project with working VeriFace Edge auth flow.
 *
 * Usage:
 *   npx create-veriface-app my-auth-app
 *   npx create-veriface-app my-auth-app --template nextjs
 *   npx create-veriface-app my-auth-app --template react --tenant-id tnt_... --api-key vf_live_...
 *
 * Templates:
 *   nextjs        Next.js 16 + TypeScript + Tailwind (recommended)
 *   react         React + Vite + TypeScript
 *   vue           Vue 3 + Vite + TypeScript
 *   rn            React Native (Expo)
 *   ios           iOS Swift (SPM)
 *   android       Android Kotlin (Gradle)
 *   flutter       Flutter (Dart)
 *
 * The generated project includes:
 *   - Working face authentication flow (capture → verify → token)
 *   - Pre-configured SDK installation
 *   - Environment variable setup
 *   - README with setup instructions
 *   - 5-minute time-to-first-auth
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const readline = require('readline')

// ---------------------------------------------------------------------------
// Colors (no dependencies — works with plain Node.js)
// ---------------------------------------------------------------------------

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
}

function log(msg) { console.log(msg) }
function success(msg) { console.log(`${colors.green}✅${colors.reset} ${msg}`) }
function info(msg) { console.log(`${colors.cyan}ℹ️${colors.reset}  ${msg}`) }
function warn(msg) { console.log(`${colors.yellow}⚠️${colors.reset}  ${msg}`) }
function error(msg) { console.error(`${colors.red}❌${colors.reset} ${msg}`) }

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES = {
  nextjs: {
    name: 'Next.js 16 + TypeScript + Tailwind',
    description: 'Full-stack with API routes (recommended for web apps)',
    icon: '▲',
    files: getNextJsTemplate(),
  },
  react: {
    name: 'React + Vite + TypeScript',
    description: 'Client-only SPA',
    icon: '⚛️',
    files: getReactTemplate(),
  },
  vue: {
    name: 'Vue 3 + Vite + TypeScript',
    description: 'Client-only SPA',
    icon: '💚',
    files: getVueTemplate(),
  },
  rn: {
    name: 'React Native (Expo)',
    description: 'iOS + Android mobile app',
    icon: '📱',
    files: getRnTemplate(),
  },
  ios: {
    name: 'iOS (Swift + SPM)',
    description: 'Native iOS app with AVFoundation',
    icon: '🍎',
    files: getIosTemplate(),
  },
  android: {
    name: 'Android (Kotlin + Gradle)',
    description: 'Native Android app with CameraX',
    icon: '🤖',
    files: getAndroidTemplate(),
  },
  flutter: {
    name: 'Flutter (Dart)',
    description: 'Cross-platform mobile app',
    icon: '🐦',
    files: getFlutterTemplate(),
  },
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)

  console.log('')
  console.log(`${colors.bold}${colors.cyan}╔══════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bold}${colors.cyan}║   create-veriface-app — VeriFace Edge Scaffold       ║${colors.reset}`)
  console.log(`${colors.bold}${colors.cyan}║   Privacy-first facial authentication in 5 minutes   ║${colors.reset}`)
  console.log(`${colors.bold}${colors.cyan}╚══════════════════════════════════════════════════════╝${colors.reset}`)
  console.log('')

  // Parse args
  let projectName = args[0]
  let template = 'nextjs'
  let tenantId = ''
  let apiKey = ''

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--template' || args[i] === '-t') template = args[++i]
    if (args[i] === '--tenant-id') tenantId = args[++i]
    if (args[i] === '--api-key') apiKey = args[++i]
  }

  // Interactive: project name
  if (!projectName) {
    projectName = await prompt('Project name', 'my-veriface-app')
  }

  // Validate project name
  if (!/^[a-z0-9-_]+$/i.test(projectName)) {
    error('Project name can only contain letters, numbers, hyphens, and underscores')
    process.exit(1)
  }

  // Interactive: template selection
  if (!args.includes('--template') && !args.includes('-t')) {
    console.log('')
    console.log('Select a template:')
    const templateKeys = Object.keys(TEMPLATES)
    templateKeys.forEach((key, i) => {
      const t = TEMPLATES[key]
      console.log(`  ${colors.cyan}${i + 1}${colors.reset}. ${t.icon} ${t.name} — ${colors.dim}${t.description}${colors.reset}`)
    })
    console.log('')
    const choice = await prompt('Choose (1-7)', '1')
    const idx = parseInt(choice, 10) - 1
    template = templateKeys[idx] || 'nextjs'
  }

  // Validate template
  if (!TEMPLATES[template]) {
    error(`Unknown template: ${template}`)
    console.log('Available templates:', Object.keys(TEMPLATES).join(', '))
    process.exit(1)
  }

  // Interactive: credentials
  if (!tenantId) {
    console.log('')
    info('You can find your Tenant ID and API key in the VeriFace Edge admin panel.')
    info('Skip for now — you can add them later in .env')
    console.log('')
    tenantId = await prompt('Tenant ID (optional)', '')
  }
  if (!apiKey) {
    apiKey = await prompt('API Key (optional)', '')
  }

  // Create project
  const projectDir = path.resolve(projectName)

  console.log('')
  info(`Creating project: ${projectName}`)
  info(`Template: ${TEMPLATES[template].name}`)
  info(`Directory: ${projectDir}`)
  console.log('')

  // Create directory
  if (fs.existsSync(projectDir)) {
    error(`Directory already exists: ${projectDir}`)
    process.exit(1)
  }
  fs.mkdirSync(projectDir, { recursive: true })

  // Write template files
  const files = TEMPLATES[template].files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(projectDir, filePath)
    const dir = path.dirname(fullPath)
    fs.mkdirSync(dir, { recursive: true })

    // Replace placeholders
    let finalContent = content
      .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
      .replace(/\{\{TENANT_ID\}\}/g, tenantId || 'your-tenant-id')
      .replace(/\{\{API_KEY\}\}/g, apiKey || 'your-api-key')

    fs.writeFileSync(fullPath, finalContent)
    success(`Created: ${filePath}`)
  }

  // Install dependencies (for JS templates)
  if (['nextjs', 'react', 'vue', 'rn'].includes(template)) {
    console.log('')
    info('Installing dependencies...')
    try {
      execSync('npm install', { cwd: projectDir, stdio: 'inherit', timeout: 120000 })
      success('Dependencies installed')
    } catch (e) {
      warn('npm install failed — you can run it manually: npm install')
    }
  }

  // Success message
  console.log('')
  console.log(`${colors.green}${colors.bold}╔══════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.green}${colors.bold}║   ✅ Project created successfully!                    ║${colors.reset}`)
  console.log(`${colors.green}${colors.bold}╚══════════════════════════════════════════════════════╝${colors.reset}`)
  console.log('')

  // Next steps
  console.log('Next steps:')
  console.log(`  ${colors.cyan}cd${colors.reset} ${projectName}`)

  if (template === 'nextjs' || template === 'react' || template === 'vue') {
    console.log(`  ${colors.cyan}npm run dev${colors.reset}`)
    console.log('')
    console.log('  Then open http://localhost:3000 (or the port shown)')
  } else if (template === 'rn') {
    console.log(`  ${colors.cyan}npx expo start${colors.reset}`)
  } else if (template === 'ios') {
    console.log(`  ${colors.cyan}open ${projectName}.xcodeproj${colors.reset}`)
  } else if (template === 'android') {
    console.log(`  ${colors.cyan}./gradlew assembleDebug${colors.reset}`)
  } else if (template === 'flutter') {
    console.log(`  ${colors.cyan}flutter run${colors.reset}`)
  }

  if (!tenantId || !apiKey) {
    console.log('')
    warn('Add your Tenant ID + API key to .env before running')
  }

  console.log('')
  console.log(`${colors.dim}📚 Docs: https://github.com/ahmedkobbi/veriface-edge${colors.reset}`)
  console.log(`${colors.dim}🐛 Issues: https://github.com/ahmedkobbi/veriface-edge/issues${colors.reset}`)
  console.log('')
}

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const suffix = defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : ''
    rl.question(`  ${question}:${suffix} `, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function getNextJsTemplate() {
  return {
    'package.json': JSON.stringify({
      name: '{{PROJECT_NAME}}',
      version: '1.0.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
      },
      dependencies: {
        next: '^16.0.0',
        react: '^18.0.0',
        'react-dom': '^18.0.0',
        '@veriface/edge-sdk': '^1.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
        '@types/react': '^18.0.0',
        '@types/node': '^20.0.0',
        tailwindcss: '^4.0.0',
      },
    }, null, 2),

    '.env.local': `# VeriFace Edge Configuration
NEXT_PUBLIC_VERIFACE_TENANT_ID={{TENANT_ID}}
NEXT_PUBLIC_VERIFACE_API_KEY={{API_KEY}}
NEXT_PUBLIC_VERIFACE_API_URL=https://api.veriface.io
`,

    'src/app/page.tsx': `'use client'

import { useState } from 'react'
import { VeriFace, type VeriFaceResult } from '@veriface/edge-sdk'

const tenantId = process.env.NEXT_PUBLIC_VERIFACE_TENANT_ID || 'your-tenant-id'
const apiKey = process.env.NEXT_PUBLIC_VERIFACE_API_KEY || 'your-api-key'

export default function Home() {
  const [status, setStatus] = useState<string>('idle')
  const [result, setResult] = useState<VeriFaceResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleVerify = async () => {
    setStatus('initializing')
    setError(null)
    setResult(null)

    try {
      const vf = new VeriFace({ tenantId, apiKey })
      const res = await vf.authenticate(externalUserId: 'demo-user')
      setResult(res)
      setStatus(res.success ? 'success' : 'failed')
    } catch (e: any) {
      setError(e.message || 'Verification failed')
      setStatus('failed')
    }
  }

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui',
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        🔐 VeriFace Edge Demo
      </h1>
      <p style={{ color: '#64748b', marginBottom: '2rem' }}>
        Privacy-first facial authentication
      </p>

      <button
        onClick={handleVerify}
        disabled={status === 'initializing' || status === 'capturing'}
        style={{
          background: 'linear-gradient(135deg, #10b981, #06b6d4)',
          color: 'white', border: 'none', borderRadius: '12px',
          padding: '12px 32px', fontSize: '16px', fontWeight: 600,
          cursor: 'pointer', marginBottom: '2rem',
        }}
      >
        {status === 'initializing' ? 'Initializing...' :
         status === 'capturing' ? 'Look at the camera...' :
         status === 'success' ? '✅ Verified!' :
         status === 'failed' ? '❌ Try Again' :
         'Verify Identity'}
      </button>

      {result?.success && (
        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', maxWidth: '500px' }}>
          <p style={{ color: '#10b981', marginBottom: '0.5rem' }}>✅ Authentication successful!</p>
          <p style={{ fontSize: '12px', color: '#64748b' }}>Token: {result.authPayload?.token?.slice(0, 32)}...</p>
          <p style={{ fontSize: '12px', color: '#64748b' }}>
            Liveness: {((result.liveness?.overall || 0) * 100).toFixed(0)}%
          </p>
        </div>
      )}

      {error && (
        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <p style={{ marginTop: '2rem', fontSize: '12px', color: '#475569' }}>
        All biometric computation runs on-device. No face data leaves your browser.
      </p>
    </main>
  )
}
`,

    'src/app/layout.tsx': `export const metadata = {
  title: '{{PROJECT_NAME}} — VeriFace Edge',
  description: 'Privacy-first facial authentication',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,

    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'es5',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2),

    'README.md': `# {{PROJECT_NAME}}

Privacy-first facial authentication powered by VeriFace Edge.

## Setup

1. Add your credentials to \`.env.local\`:
   \`\`\`
   NEXT_PUBLIC_VERIFACE_TENANT_ID=your-tenant-id
   NEXT_PUBLIC_VERIFACE_API_KEY=vf_live_...
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Run the dev server:
   \`\`\`bash
   npm run dev
   \`\`\`

4. Open http://localhost:3000

## How It Works

1. User clicks "Verify Identity"
2. SDK opens the camera and captures face data (all on-device)
3. SDK computes: face detection → rPPG (heart rate) → PAD (anti-spoofing) → embedding
4. SDK generates a ZK proof (PLONK) — proves embedding is valid without revealing it
5. SDK encrypts the embedding (AES-256-GCM) + signs the payload (Ed25519 + ML-DSA-87)
6. Backend verifies the ZK proof + signatures → issues auth token

**No face images, embeddings, or biometric signals ever leave the browser.**

## Learn More

- [VeriFace Edge on GitHub](https://github.com/ahmedkobbi/veriface-edge)
- [API Documentation](https://api.veriface.io/api-docs)
- [SDK Documentation](https://github.com/ahmedkobbi/veriface-edge/tree/main/src/sdk)
`,
  }
}

function getReactTemplate() {
  return {
    'package.json': JSON.stringify({
      name: '{{PROJECT_NAME}}',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.0.0',
        'react-dom': '^18.0.0',
        '@veriface/edge-sdk': '^1.0.0',
      },
      devDependencies: {
        '@types/react': '^18.0.0',
        '@vitejs/plugin-react': '^4.0.0',
        typescript: '^5.0.0',
        vite: '^5.0.0',
      },
    }, null, 2),

    '.env': `VITE_VERIFACE_TENANT_ID={{TENANT_ID}}
VITE_VERIFACE_API_KEY={{API_KEY}}
`,

    'src/App.tsx': `import { useState } from 'react'
import { VeriFace } from '@veriface/edge-sdk'

const tenantId = import.meta.env.VITE_VERIFACE_TENANT_ID || 'your-tenant-id'
const apiKey = import.meta.env.VITE_VERIFACE_API_KEY || 'your-api-key'

function App() {
  const [status, setStatus] = useState('idle')
  const [token, setToken] = useState('')

  const handleVerify = async () => {
    setStatus('capturing')
    const vf = new VeriFace({ tenantId, apiKey })
    const result = await vf.authenticate(externalUserId: 'demo-user')
    if (result.success) {
      setToken(result.authPayload?.token || '')
      setStatus('success')
    } else {
      setStatus('failed')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <h1>🔐 VeriFace Edge</h1>
      <button onClick={handleVerify} disabled={status === 'capturing'} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '12px', padding: '12px 32px', fontSize: '16px', cursor: 'pointer' }}>
        {status === 'capturing' ? 'Look at camera...' : 'Verify Identity'}
      </button>
      {token && <p style={{ marginTop: '1rem', fontSize: '12px', color: '#64748b' }}>Token: {token.slice(0, 32)}...</p>}
    </div>
  )
}

export default App
`,

    'src/main.tsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`,

    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{PROJECT_NAME}}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,

    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true },
      include: ['src'],
    }, null, 2),

    'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,

    'README.md': `# {{PROJECT_NAME}}

React + Vite + VeriFace Edge facial authentication.

## Setup
1. Edit .env with your credentials
2. npm install
3. npm run dev
4. Open http://localhost:5173
`,
  }
}

function getVueTemplate() {
  return {
    'package.json': JSON.stringify({
      name: '{{PROJECT_NAME}}',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { dev: 'vite', build: 'vue-tsc && vite build', preview: 'vite preview' },
      dependencies: { vue: '^3.4.0', '@veriface/edge-sdk': '^1.0.0' },
      devDependencies: { '@vitejs/plugin-vue': '^5.0.0', typescript: '^5.0.0', vite: '^5.0.0', 'vue-tsc': '^2.0.0' },
    }, null, 2),

    '.env': `VITE_VERIFACE_TENANT_ID={{TENANT_ID}}
VITE_VERIFACE_API_KEY={{API_KEY}}
`,

    'src/App.vue': `<template>
  <div class="app">
    <h1>🔐 VeriFace Edge</h1>
    <button @click="verify" :disabled="status === 'capturing'">
      {{ status === 'capturing' ? 'Look at camera...' : 'Verify Identity' }}
    </button>
    <p v-if="token" class="token">Token: {{ token.slice(0, 32) }}...</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { VeriFace } from '@veriface/edge-sdk'

const tenantId = import.meta.env.VITE_VERIFACE_TENANT_ID || 'your-tenant-id'
const apiKey = import.meta.env.VITE_VERIFACE_API_KEY || 'your-api-key'

const status = ref('idle')
const token = ref('')

const verify = async () => {
  status.value = 'capturing'
  const vf = new VeriFace({ tenantId, apiKey })
  const result = await vf.authenticate(externalUserId: 'demo-user')
  if (result.success) {
    token.value = result.authPayload?.token || ''
    status.value = 'success'
  } else {
    status.value = 'failed'
  }
}
</script>

<style>
.app { min-height: 100vh; background: #0f172a; color: #f1f5f9; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: system-ui; }
button { background: #10b981; color: white; border: none; border-radius: 12px; padding: 12px 32px; font-size: 16px; cursor: pointer; }
.token { margin-top: 1rem; font-size: 12px; color: #64748b; }
</style>
`,

    'src/main.ts': `import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
`,

    'index.html': `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>{{PROJECT_NAME}}</title></head>
<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
`,

    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2020', useDefineForClassFields: true, module: 'ESNext', lib: ['ES2020', 'DOM', 'DOM.Iterable'], skipLibCheck: true, moduleResolution: 'bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'preserve', strict: true },
      include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
    }, null, 2),

    'vite.config.ts': `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({ plugins: [vue()] })
`,

    'README.md': `# {{PROJECT_NAME}}

Vue 3 + Vite + VeriFace Edge facial authentication.

## Setup
1. Edit .env with your credentials
2. npm install
3. npm run dev
`,
  }
}

function getRnTemplate() {
  return {
    'package.json': JSON.stringify({
      name: '{{PROJECT_NAME}}',
      version: '1.0.0',
      main: 'index.ts',
      scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios' },
      dependencies: {
        expo: '~51.0.0',
        react: '18.2.0',
        'react-native': '0.74.0',
        '@veriface/edge-react-native': '^1.0.0',
        'react-native-webview': '^13.0.0',
      },
      devDependencies: { '@types/react': '~18.2.0', typescript: '^5.0.0' },
    }, null, 2),

    '.env': `EXPO_PUBLIC_VERIFACE_TENANT_ID={{TENANT_ID}}
EXPO_PUBLIC_VERIFACE_API_KEY={{API_KEY}}
`,

    'App.tsx': `import { VeriFaceView } from '@veriface/edge-react-native'

const tenantId = process.env.EXPO_PUBLIC_VERIFACE_TENANT_ID || 'your-tenant-id'
const apiKey = process.env.EXPO_PUBLIC_VERIFACE_API_KEY || 'your-api-key'

export default function App() {
  return (
    <VeriFaceView
      tenantId={tenantId}
      apiKey={apiKey}
      flow="authenticate"
      externalUserId="demo-user"
      onSuccess={(result) => console.log('Token:', result.token)}
      onFailure={(error) => console.error('Failed:', error)}
      style={{ flex: 1 }}
    />
  )
}
`,

    'app.json': JSON.stringify({
      expo: { name: '{{PROJECT_NAME}}', slug: '{{PROJECT_NAME}}', version: '1.0.0', orientation: 'portrait', icon: './assets/icon.png', sdkVersion: '51.0.0' },
    }, null, 2),

    'README.md': `# {{PROJECT_NAME}}

React Native (Expo) + VeriFace Edge.

## Setup
1. npm install
2. Edit .env with your credentials
3. npx expo start
4. Press 'i' for iOS or 'a' for Android
`,
  }
}

function getIosTemplate() {
  return {
    'Package.swift': `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "{{PROJECT_NAME}}",
    platforms: [.iOS(.v15)],
    products: [.executable(name: "{{PROJECT_NAME}}", targets: ["{{PROJECT_NAME}}"])],
    dependencies: [
        .package(url: "https://github.com/ahmedkobbi/veriface-edge.git", branch: "main"),
    ],
    targets: [.executableTarget(name: "{{PROJECT_NAME}}", dependencies: ["VeriFaceEdge"])]
)
`,

    'Sources/main.swift': `import VeriFaceEdge
import Foundation

let config = VeriFaceConfig(
    tenantId: "{{TENANT_ID}}",
    apiKey: "{{API_KEY}}",
    apiBaseUrl: URL(string: "https://api.veriface.io")!
)

let client = VeriFaceClient(config: config)

Task {
    do {
        let result = try await client.authenticate(externalUserId: "demo-user")
        print("✅ Token: \\(result.token ?? "")")
    } catch {
        print("❌ Failed: \\(error)")
    }
}
`,

    'README.md': `# {{PROJECT_NAME}}

iOS (Swift) + VeriFace Edge facial authentication.

## Setup
1. swift build
2. swift run
3. Or open in Xcode: open Package.swift
`,
  }
}

function getAndroidTemplate() {
  return {
    'build.gradle.kts': `plugins { id("application") }
repositories { mavenCentral() }
dependencies {
    implementation("io.veriface:edge-sdk-android:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
}
application { mainClass.set("MainKt") }
`,

    'src/main/kotlin/Main.kt': `import io.veriface.sdk.VeriFaceClient
import io.veriface.sdk.api.VeriFaceConfig

fun main() {
    val config = VeriFaceConfig(
        tenantId = "{{TENANT_ID}}",
        apiKey = "{{API_KEY}}",
    )
    println("VeriFace Edge — Android Demo")
    println("Tenant: \\${'$'}{config.tenantId}")
    println("In production, call VeriFaceClient(context, config).authenticate()")
}
`,

    'README.md': `# {{PROJECT_NAME}}

Android (Kotlin) + VeriFace Edge facial authentication.

## Setup
1. ./gradlew run
2. Or import into Android Studio
`,
  }
}

function getFlutterTemplate() {
  return {
    'pubspec.yaml': `name: {{PROJECT_NAME}}
description: VeriFace Edge facial authentication
version: 1.0.0

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  veriface_edge: ^1.0.0
`,

    'lib/main.dart': `import 'package:flutter/material.dart';
import 'package:veriface_edge/veriface_edge.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Center(
          child: VeriFaceWidget(
            config: VeriFaceConfig(
              tenantId: '{{TENANT_ID}}',
              apiKey: '{{API_KEY}}',
            ),
            flow: 'authenticate',
            externalUserId: 'demo-user',
            onSuccess: (result) => print('Token: \\${'$'}{result.token}'),
            onFailure: (error) => print('Failed: \\${'$'}{error}'),
          ),
        ),
      ),
    );
  }
}
`,

    'README.md': `# {{PROJECT_NAME}}

Flutter + VeriFace Edge facial authentication.

## Setup
1. flutter pub get
2. flutter run
`,
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((e) => {
  error(e.message || e)
  process.exit(1)
})
