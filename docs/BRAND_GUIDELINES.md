# VeriFace Edge — Brand Guidelines

**Version**: 1.0.0
**Last updated**: 2026-08-07
**Classification**: Public

---

## 1. Brand Identity

### Mission
Make biometric authentication so private that even we can't see your face.

### Personality
- **Precise** — military-grade security, no ambiguity
- **Private** — privacy is not a feature, it's the architecture
- **Premium** — enterprise-grade, not consumer-grade
- **Edge-native** — computation belongs on the device, not the server

### Voice
- Technical but accessible
- Confident, not arrogant
- Security-first, never alarmist
- Concise. Every word earns its place.

---

## 2. Logo

### Logo Mark
The VeriFace mark is a **hexagonal shield** containing an abstract **face silhouette** with a **biometric scan line** and a **lock indicator**.

**Symbolism**:
- **Hexagonal shield** — security + structural integrity (hexagon = strongest tessellating shape)
- **Face silhouette** — biometric identity
- **Scan line** — edge AI computation (the scan happens on-device)
- **Lock** — cryptographic guarantee (zero-knowledge)

### Variants

| Variant | Usage | File |
|---------|-------|------|
| **Full color** | Default — websites, app headers, light backgrounds | `logo.svg` |
| **Full color + wordmark** | Primary brand lockup — landing pages, emails | `logo-full.svg` |
| **Monochrome** | Single-color contexts (etching, embroidery, dark/light variants) | `logo-mono.svg` |
| **Favicon** | Browser tabs (simplified 16x16) | `favicon.svg` |

### Clear Space
Minimum clear space = **height of the logo mark** on all sides.

### Minimum Sizes
- **Logo mark**: 20px (digital), 15pt (print)
- **Full lockup**: 120px wide (digital), 90pt (print)

### Don'ts
- ❌ Don't stretch or skew
- ❌ Don't recolor outside brand palette
- ❌ Don't add drop shadows or outer glows
- ❌ Don't place on busy backgrounds without sufficient contrast
- ❌ Don't animate the logo mark (the scan line inside is static — the brand isn't about motion)

---

## 3. Color Palette

### Primary Brand Colors

| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| **VeriFace Emerald** | `#10b981` | 16, 185, 129 | Primary — success, active states, CTA gradients |
| **VeriFace Cyan** | `#06b6d4` | 6, 182, 212 | Secondary — info, links, gradient midpoint |
| **VeriFace Blue** | `#3b82f6` | 59, 130, 246 | Accent — depth, gradient endpoint |

### Extended Palette

| Color | Hex | Usage |
|-------|-----|-------|
| **Slate 950** | `#020617` | Background (darkest) |
| **Slate 900** | `#0f172a` | Background (primary) |
| **Slate 800** | `#1e293b` | Surface (cards) |
| **Slate 400** | `#94a3b8` | Secondary text |
| **Slate 100** | `#f1f5f9` | Primary text (dark mode) |
| **Amber 400** | `#f59e0b` | Warning |
| **Red 400** | `#ef4444` | Error / destructive |
| **Purple 400** | `#8b5cf6` | Advanced / enterprise features |

### Gradient
The VeriFace gradient flows **emerald → cyan → blue** at 135°:
```css
background: linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%);
```

### Contrast Ratios
- Primary text on Slate 950: **18.4:1** (AAA)
- Secondary text on Slate 950: **7.2:1** (AAA)
- Emerald on Slate 950: **8.9:1** (AAA)
- All interactive elements meet WCAG AAA contrast standards.

---

## 4. Typography

### Primary Typeface: Geist Sans
- **Foundry**: Vercel (open source)
- **Usage**: Headings, body text, UI elements
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold)

### Monospace: Geist Mono
- **Usage**: Code blocks, technical data, API keys, hashes, timestamps
- **Weights**: 400, 500

### Type Scale

| Element | Size (mobile) | Size (desktop) | Weight | Line Height |
|---------|---------------|----------------|--------|-------------|
| Display | 2.5rem (40px) | 4.5rem (72px) | 800 | 1.1 |
| H1 | 2rem (32px) | 3rem (48px) | 700 | 1.15 |
| H2 | 1.5rem (24px) | 2rem (32px) | 700 | 1.2 |
| H3 | 1.25rem (20px) | 1.5rem (24px) | 600 | 1.3 |
| Body | 0.875rem (14px) | 1rem (16px) | 400 | 1.6 |
| Small | 0.75rem (12px) | 0.875rem (14px) | 400 | 1.5 |
| Caption | 0.6875rem (11px) | 0.75rem (12px) | 500 | 1.4 |
| Code | 0.875rem (14px) | 0.875rem (14px) | 400 | 1.5 |

---

## 5. Spacing System

Based on a **4px grid**:

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps (icon to text) |
| `space-2` | 8px | Component internal padding |
| `space-3` | 12px | Default gap between elements |
| `space-4` | 16px | Card padding, section gaps |
| `space-6` | 24px | Large section gaps |
| `space-8` | 32px | Page section spacing |
| `space-12` | 48px | Hero spacing |
| `space-20` | 80px | Major section breaks |

---

## 6. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 6px | Badges, small inputs |
| `md` | 8px | Buttons, medium inputs |
| `lg` | 12px | Cards, dialogs |
| `xl` | 16px | Large containers |
| `2xl` | 20px | Hero cards |
| `full` | 9999px | Pills, avatars, circular elements |

---

## 7. Iconography

### Custom Icon Set
VeriFace uses a **purpose-built icon set** (`src/components/brand/Icons.tsx`) — not generic icon libraries.

**Design principles**:
- 24x24 viewBox
- 1.5px stroke width
- Round line caps and joins
- Current color inheritance
- Minimal — only essential lines

**Available icons** (24 total):
FaceScan, ShieldLock, Pulse, Fingerprint, Scan, Key, Lock, Unlock, CheckCircle, XCircle, Alert, Info, Eye, Zap, Cpu, Radio, Activity, UserPlus, LogIn, Trash, Download, Refresh, Command, Settings, Sun, Moon, Copy, Sparkles

### Usage
```tsx
import { FaceScanIcon, ShieldLockIcon } from '@/components/brand/Icons'

<FaceScanIcon className="w-5 h-5 text-emerald-400" />
```

---

## 8. Component Aesthetic

### Glassmorphism
All primary surfaces use true glassmorphism:
- `backdrop-blur-xl` (24px blur)
- `bg-white/[0.06]` (6% white overlay)
- `border border-white/[0.08]` (8% white border)
- Edge light refraction (135° gradient overlay)
- Noise texture (2% opacity)

### Motion
- **Spring physics** (React Spring) for interactive elements
- **GSAP** for scroll-triggered hero animations
- **CSS keyframes** for ambient animations (gradient orbs, shimmer)
- Duration: 200-300ms for interactions, 20-30s for ambient

---

## 9. Voice & Copy

### Do
- ✅ "The backend cannot reconstruct your face"
- ✅ "All biometric computation runs in your browser"
- ✅ "Zero-knowledge Pedersen commitment"
- ✅ "Military-grade security"

### Don't
- ❌ "We don't store your face" (imprecise — we DO store a commitment)
- ❌ "100% secure" (nothing is 100% secure)
- ❌ "Hack-proof" (hyperbolic)
- ❌ "AI-powered" (vague — say "edge AI" or "WebGPU neural inference")

---

## 10. File Inventory

```
public/brand/
├── logo.svg              # Full color mark (64x64)
├── logo-mono.svg         # Monochrome version
├── logo-full.svg         # Mark + wordmark (240x64)
├── favicon.svg           # Simplified 16x16
├── favicon.ico           # Multi-resolution ICO
├── favicon-16x16.png     # 16px PNG
├── favicon-32x32.png     # 32px PNG
├── apple-touch-icon.png  # 180px Apple touch icon
├── icon-192x192.png      # 192px PWA icon
├── icon-512x512.png      # 512px PWA icon
└── og-image.png          # 1200x630 Open Graph image
```
