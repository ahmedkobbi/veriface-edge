/**
 * API Docs Page — Interactive Swagger UI + Code Snippets
 *
 * Serves an interactive API documentation page with:
 *   - Full OpenAPI 3.1 spec rendering (Swagger UI)
 *   - "Try it now" buttons (live API calls)
 *   - Auto-generated SDK code snippets in 5+ languages
 *   - API key input (stored in localStorage, never sent to server)
 *   - Dark theme matching VeriFace Edge brand
 *
 * Route: /api-docs
 * Also deployable as a static HTML file to GitHub Pages.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const dynamic = 'force-static'

export async function GET() {
  // Read the OpenAPI spec
  const specPath = join(process.cwd(), 'openapi.json')
  let spec: string
  try {
    spec = readFileSync(specPath, 'utf8')
  } catch {
    spec = '{}'
  }

  const html = buildSwaggerHtml(spec)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function buildSwaggerHtml(spec: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VeriFace Edge — API Documentation</title>
  <link rel="icon" href="/favicon.ico" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@stoplight/elements/styles.min.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #f1f5f9;
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-bottom: 1px solid #334155;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 1000;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      font-size: 20px;
      font-weight: 700;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header-tag {
      font-size: 11px;
      color: #64748b;
      padding: 2px 8px;
      border: 1px solid #334155;
      border-radius: 4px;
    }
    .api-key-bar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .api-key-input {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 12px;
      color: #f1f5f9;
      font-size: 12px;
      width: 250px;
      font-family: monospace;
    }
    .api-key-input::placeholder { color: #475569; }
    .api-key-input:focus { outline: none; border-color: #10b981; }
    .api-key-label {
      font-size: 11px;
      color: #64748b;
      white-space: nowrap;
    }
    .tabs {
      display: flex;
      gap: 1px;
      background: #1e293b;
      padding: 0 24px;
      border-bottom: 1px solid #334155;
    }
    .tab {
      padding: 10px 20px;
      font-size: 13px;
      color: #94a3b8;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: #f1f5f9; background: rgba(255,255,255,0.03); }
    .tab.active {
      color: #10b981;
      border-bottom: 2px solid #10b981;
      font-weight: 600;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    #swagger-ui {
      background: #0f172a;
      padding: 0;
    }
    #swagger-ui .swagger-ui {
      background: #0f172a;
    }
    #swagger-ui .swagger-ui .topbar { display: none; }
    #swagger-ui .swagger-ui .info {
      background: #1e293b;
      margin: 0;
      padding: 24px;
      border-bottom: 1px solid #334155;
    }
    #swagger-ui .swagger-ui .info .title { color: #f1f5f9; }
    #swagger-ui .swagger-ui .info .description { color: #94a3b8; }
    #swagger-ui .swagger-ui .scheme-container {
      background: #1e293b;
      box-shadow: none;
      border-bottom: 1px solid #334155;
    }
    #swagger-ui .swagger-ui .opblock {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      margin: 8px 0;
    }
    #swagger-ui .swagger-ui .opblock .opblock-summary-method {
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      min-width: 60px;
      text-align: center;
    }
    #swagger-ui .swagger-ui .opblock-get .opblock-summary-method { background: #10b981; }
    #swagger-ui .swagger-ui .opblock-post .opblock-summary-method { background: #06b6d4; }
    #swagger-ui .swagger-ui .opblock-put .opblock-summary-method { background: #f59e0b; }
    #swagger-ui .swagger-ui .opblock-delete .opblock-summary-method { background: #ef4444; }
    #swagger-ui .swagger-ui .opblock .opblock-summary-path { color: #f1f5f9; font-family: monospace; }
    #swagger-ui .swagger-ui .opblock .opblock-summary-description { color: #64748b; }
    #swagger-ui .swagger-ui table thead tr th { color: #94a3b8; border-bottom: 2px solid #334155; }
    #swagger-ui .swagger-ui table tbody tr td { color: #cbd5e1; border-bottom: 1px solid #1e293b; }
    #swagger-ui .swagger-ui .parameter__name { color: #f1f5f9; }
    #swagger-ui .swagger-ui .parameter__type { color: #64748b; }
    #swagger-ui .swagger-ui .section { background: transparent; }
    #swagger-ui .swagger-ui .renderedmarkdown p { color: #94a3b8; }
    #swagger-ui .swagger-ui .btn {
      background: #10b981;
      border: none;
      border-radius: 6px;
      color: white;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 16px;
      cursor: pointer;
    }
    #swagger-ui .swagger-ui .btn:hover { background: #059669; }
    #swagger-ui .swagger-ui .btn.authorize { background: #06b6d4; }
    #swagger-ui .swagger-ui .btn.authorize:hover { background: #0891b2; }
    #swagger-ui .swagger-ui .btn.cancel { background: #475569; }
    #swagger-ui .swagger-ui input[type=text],
    #swagger-ui .swagger-ui textarea {
      background: #0f172a;
      border: 1px solid #334155;
      color: #f1f5f9;
      border-radius: 4px;
      padding: 6px 10px;
      font-family: monospace;
      font-size: 12px;
    }
    #swagger-ui .swagger-ui .response-col_status { color: #94a3b8; }
    #swagger-ui .swagger-ui .response-col_description { color: #cbd5e1; }
    #swagger-ui .swagger-ui .highlight-code {
      background: #0f172a;
      border-radius: 6px;
    }
    #swagger-ui .swagger-ui .download-contents {
      color: #10b981;
    }

    /* Quickstart section */
    .quickstart {
      padding: 32px 24px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .quickstart h2 {
      font-size: 20px;
      color: #f1f5f9;
      margin-bottom: 16px;
    }
    .quickstart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .quickstart-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
      transition: all 0.2s;
      cursor: pointer;
    }
    .quickstart-card:hover {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.05);
      transform: translateY(-2px);
    }
    .quickstart-card .lang {
      font-size: 16px;
      font-weight: 700;
      color: #10b981;
      margin-bottom: 8px;
    }
    .quickstart-card .desc {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 12px;
    }
    .quickstart-card code {
      display: block;
      background: #0f172a;
      border-radius: 6px;
      padding: 10px;
      font-size: 11px;
      color: #94a3b8;
      font-family: 'Fira Code', 'Monaco', monospace;
      overflow-x: auto;
      white-space: pre;
    }
    .quickstart-card .copy-btn {
      margin-top: 8px;
      font-size: 10px;
      color: #06b6d4;
      cursor: pointer;
      text-align: right;
    }

    /* Code snippet panel */
    .snippet-panel {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      margin-top: 16px;
      overflow: hidden;
    }
    .snippet-header {
      background: #0f172a;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #334155;
    }
    .snippet-lang-select {
      background: #1e293b;
      border: 1px solid #334155;
      color: #f1f5f9;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .snippet-content {
      padding: 16px;
      font-family: 'Fira Code', 'Monaco', monospace;
      font-size: 12px;
      color: #94a3b8;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="logo">VeriFace Edge</span>
      <span class="header-tag">API v1</span>
    </div>
    <div class="api-key-bar">
      <span class="api-key-label">API Key:</span>
      <input type="password" class="api-key-input" id="api-key-input" placeholder="vf_live_..." />
      <button onclick="saveApiKey()" style="background:#10b981;color:white;border:none;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;">Save</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('swagger')">API Reference</button>
    <button class="tab" onclick="switchTab('quickstart')">Quick Start</button>
    <button class="tab" onclick="switchTab('sdk')">SDK Examples</button>
  </div>

  <!-- Tab 1: Swagger UI -->
  <div id="tab-swagger" class="tab-content active">
    <div id="swagger-ui"></div>
  </div>

  <!-- Tab 2: Quick Start -->
  <div id="tab-quickstart" class="tab-content">
    <div class="quickstart">
      <h2>🚀 Quick Start — 5 Minutes to First Auth</h2>
      <div class="quickstart-grid">
        <div class="quickstart-card" onclick="copyCode('npx create-veriface-app my-auth-app')">
          <div class="lang">CLI Scaffold</div>
          <div class="desc">Scaffold a complete project with working auth flow</div>
          <code>npx create-veriface-app my-auth-app</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode('npm install @veriface/edge-sdk')">
          <div class="lang">Install SDK</div>
          <div class="desc">Or install the SDK in an existing project</div>
          <code>npm install @veriface/edge-sdk</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(curlExample)">
          <div class="lang">cURL</div>
          <div class="desc">Initialize a session via REST API</div>
          <code id="curl-snippet">curl -X POST https://api.veriface.io/api/session/init \\
  -H "Authorization: Bearer vf_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"tenantId":"tnt_...","flow":"authenticate"}'</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(tsExample)">
          <div class="lang">TypeScript</div>
          <div class="desc">Use the SDK in a TypeScript/JavaScript app</div>
          <code id="ts-snippet">import { VeriFace } from '@veriface/edge-sdk'

const vf = new VeriFace({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})

const result = await vf.authenticate(
  externalUserId: 'user_123'
)
console.log('Token:', result.authPayload?.token)</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(pythonExample)">
          <div class="lang">Python</div>
          <div class="desc">Server-side verification using requests</div>
          <code id="python-snippet">import requests

res = requests.post(
    'https://api.veriface.io/api/session/init',
    headers={'Authorization': 'Bearer vf_live_...'},
    json={'tenantId': 'tnt_...', 'flow': 'authenticate'}
)
session = res.json()
print('Session ID:', session['sessionId'])</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(goExample)">
          <div class="lang">Go</div>
          <div class="desc">Server-side integration in Go</div>
          <code id="go-snippet">resp, _ := http.Post(
    "https://api.veriface.io/api/session/init",
    "application/json",
    strings.NewReader(\`{"tenantId":"tnt_...","flow":"authenticate"}\`),
)
// Add Authorization header for production</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(rustExample)">
          <div class="lang">Rust</div>
          <div class="desc">High-performance server integration</div>
          <code id="rust-snippet">let client = reqwest::Client::new();
let resp = client
    .post("https://api.veriface.io/api/session/init")
    .bearer_auth("vf_live_...")
    .json(&json!({"tenantId":"tnt_...","flow":"authenticate"}))
    .send().await?;</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(javaExample)">
          <div class="lang">Java</div>
          <div class="desc">Enterprise Java integration</div>
          <code id="java-snippet">HttpClient client = HttpClient.newHttpClient();
HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("https://api.veriface.io/api/session/init"))
    .header("Authorization", "Bearer vf_live_...")
    .POST(BodyPublishers.ofString(
        "{\\"tenantId\\":\\"tnt_...\\",\\"flow\\":\\"authenticate\\"}"))
    .build();</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
        <div class="quickstart-card" onclick="copyCode(dartExample)">
          <div class="lang">Dart (Flutter)</div>
          <div class="desc">Mobile app integration</div>
          <code id="dart-snippet">final res = await http.post(
  Uri.parse('https://api.veriface.io/api/session/init'),
  headers: {'Authorization': 'Bearer vf_live_...'},
  body: jsonEncode({
    'tenantId': 'tnt_...',
    'flow': 'authenticate',
  }),
);</code>
          <div class="copy-btn">Click to copy →</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 3: SDK Examples -->
  <div id="tab-sdk" class="tab-content">
    <div class="quickstart">
      <h2>📦 SDK Examples by Platform</h2>

      <div class="snippet-panel">
        <div class="snippet-header">
          <span style="color:#10b981;font-size:12px;font-weight:600;">Web SDK (React)</span>
          <select class="snippet-lang-select" onchange="changeSdkExample(this.value)">
            <option value="react">React</option>
            <option value="vue">Vue</option>
            <option value="vanilla">Vanilla JS</option>
            <option value="web-component">Web Component</option>
          </select>
        </div>
        <div class="snippet-content" id="sdk-snippet-content">${reactSdkExample}</div>
      </div>

      <div class="snippet-panel">
        <div class="snippet-header">
          <span style="color:#06b6d4;font-size:12px;font-weight:600;">React Native</span>
        </div>
        <div class="snippet-content">${rnSdkExample}</div>
      </div>

      <div class="snippet-panel">
        <div class="snippet-header">
          <span style="color:#a855f7;font-size:12px;font-weight:600;">iOS (Swift)</span>
        </div>
        <div class="snippet-content">${swiftSdkExample}</div>
      </div>

      <div class="snippet-panel">
        <div class="snippet-header">
          <span style="color:#f59e0b;font-size:12px;font-weight:600;">Android (Kotlin)</span>
        </div>
        <div class="snippet-content">${kotlinSdkExample}</div>
      </div>

      <div class="snippet-panel">
        <div class="snippet-header">
          <span style="color:#10b981;font-size:12px;font-weight:600;">Flutter (Dart)</span>
        </div>
        <div class="snippet-content">${flutterSdkExample}</div>
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    // OpenAPI spec
    const spec = ${spec};

    // Initialize Swagger UI
    const ui = SwaggerUIBundle({
      spec: spec,
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'BaseLayout',
      requestInterceptor: (req) => {
        // Inject API key from localStorage
        const apiKey = localStorage.getItem('veriface_api_key');
        if (apiKey && req.url.includes('api.veriface.io')) {
          req.headers['Authorization'] = 'Bearer ' + apiKey;
        }
        return req;
      },
    });

    // Tab switching
    function switchTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('.tab[onclick*=\\'' + tabId + '\\']').classList.add('active');
      document.getElementById('tab-' + tabId).classList.add('active');
    }

    // API key management
    function saveApiKey() {
      const key = document.getElementById('api-key-input').value;
      if (key) {
        localStorage.setItem('veriface_api_key', key);
        alert('API key saved! Try any endpoint below — it will be sent automatically.');
      }
    }

    // Load saved API key
    (function() {
      const saved = localStorage.getItem('veriface_api_key');
      if (saved) document.getElementById('api-key-input').value = saved;
    })();

    // Copy code
    function copyCode(text) {
      if (typeof text === 'string') {
        navigator.clipboard.writeText(text);
      } else {
        navigator.clipboard.writeText(text.innerText || text.textContent || '');
      }
    }

    // SDK example switching
    const sdkExamples = {
      react: ${JSON.stringify(reactSdkExample)},
      vue: ${JSON.stringify(vueSdkExample)},
      vanilla: ${JSON.stringify(vanillaSdkExample)},
      'web-component': ${JSON.stringify(webComponentExample)},
    };

    function changeSdkExample(lang) {
      document.getElementById('sdk-snippet-content').textContent = sdkExamples[lang] || '';
    }
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Code snippet templates
// ---------------------------------------------------------------------------

const curlExample = `curl -X POST https://api.veriface.io/api/session/init \\
  -H "Authorization: Bearer vf_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"tenantId":"tnt_...","flow":"authenticate"}'`

const tsExample = `import { VeriFace } from '@veriface/edge-sdk'

const vf = new VeriFace({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})

const result = await vf.authenticate(
  externalUserId: 'user_123'
)
console.log('Token:', result.authPayload?.token)`

const pythonExample = `import requests

res = requests.post(
    'https://api.veriface.io/api/session/init',
    headers={'Authorization': 'Bearer vf_live_...'},
    json={'tenantId': 'tnt_...', 'flow': 'authenticate'}
)
session = res.json()
print('Session ID:', session['sessionId'])`

const goExample = `resp, _ := http.Post(
    "https://api.veriface.io/api/session/init",
    "application/json",
    strings.NewReader(\`{"tenantId":"tnt_...","flow":"authenticate"}\`),
)
// Add Authorization header for production`

const rustExample = `let client = reqwest::Client::new();
let resp = client
    .post("https://api.veriface.io/api/session/init")
    .bearer_auth("vf_live_...")
    .json(&json!({"tenantId":"tnt_...","flow":"authenticate"}))
    .send().await?;`

const javaExample = `HttpClient client = HttpClient.newHttpClient();
HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("https://api.veriface.io/api/session/init"))
    .header("Authorization", "Bearer vf_live_...")
    .POST(BodyPublishers.ofString(
        "{\\"tenantId\\":\\"tnt_...\\",\\"flow\\":\\"authenticate\\"}"))
    .build();`

const dartExample = `final res = await http.post(
  Uri.parse('https://api.veriface.io/api/session/init'),
  headers: {'Authorization': 'Bearer vf_live_...'},
  body: jsonEncode({
    'tenantId': 'tnt_...',
    'flow': 'authenticate',
  }),
);`

const reactSdkExample = `import { useFaceAuth } from '@veriface/edge-sdk/react'

function App() {
  const { status, result, start, cancel } = useFaceAuth({
    tenantId: 'tnt_...',
    apiKey: 'vf_live_...',
  })

  return (
    <div>
      <button onClick={start}>Verify Identity</button>
      {status === 'capturing' && <p>Look at the camera...</p>}
      {result?.success && <p>✅ Verified! Token: {result.token}</p>}
    </div>
  )
}`

const vueSdkExample = `<template>
  <div>
    <button @click="start">Verify Identity</button>
    <p v-if="status === 'capturing'">Look at the camera...</p>
    <p v-if="result?.success">✅ Verified!</p>
  </div>
</template>

<script setup>
import { useVeriFace } from '@veriface/edge-sdk/vue'

const { status, result, start } = useVeriFace({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})
</script>`

const vanillaSdkExample = `import { VeriFace } from '@veriface/edge-sdk'

const vf = new VeriFace({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})

document.getElementById('verify-btn').addEventListener('click', async () => {
  const result = await vf.authenticate(externalUserId: 'user_123')
  if (result.success) {
    console.log('Token:', result.authPayload.token)
  }
})`

const webComponentExample = `<!-- Drop-in HTML element — no framework needed -->
<script type="module" src="https://cdn.veriface.io/v1/face-auth.js"></script>

<face-auth
  tenant-id="tnt_..."
  api-key="vf_live_..."
  flow="authenticate"
  external-user-id="user_123"
></face-auth>

<script>
const el = document.querySelector('face-auth')
el.addEventListener('veriface:success', (e) => {
  console.log('Token:', e.detail.token)
})
el.addEventListener('veriface:failure', (e) => {
  console.error('Failed:', e.detail.code)
})
</script>`

const rnSdkExample = `import { VeriFaceView } from '@veriface/edge-react-native'

function App() {
  return (
    <VeriFaceView
      tenantId="tnt_..."
      apiKey="vf_live_..."
      flow="authenticate"
      externalUserId="user_123"
      onSuccess={(result) => console.log('Token:', result.token)}
      onFailure={(error) => console.error('Failed:', error)}
    />
  )
}`

const swiftSdkExample = `import VeriFaceEdge

let client = VeriFaceClient(config: VeriFaceConfig(
    tenantId: "tnt_...",
    apiKey: "vf_live_...",
    apiBaseUrl: URL(string: "https://api.veriface.io")!
))

Task {
    do {
        let result = try await client.authenticate(externalUserId: "user_123")
        print("Token: \\(result.token ?? "")")
    } catch {
        print("Auth failed: \\(error)")
    }
}`

const kotlinSdkExample = `import io.veriface.sdk.VeriFaceClient
import io.veriface.sdk.api.VeriFaceConfig

val client = VeriFaceClient(
    context = applicationContext,
    config = VeriFaceConfig(
        tenantId = "tnt_...",
        apiKey = "vf_live_...",
    )
)

// Call from a coroutine
val result = client.authenticate(externalUserId = "user_123")
println("Token: ${'$'}{result.token}")`

const flutterSdkExample = `import 'package:veriface_edge/veriface_edge.dart';

VeriFaceWidget(
  config: VeriFaceConfig(
    tenantId: 'tnt_...',
    apiKey: 'vf_live_...',
  ),
  flow: 'authenticate',
  externalUserId: 'user_123',
  onSuccess: (result) => print('Token: ${'$'}{result.token}'),
  onFailure: (error) => print('Failed: ${'$'}{error}'),
)`
