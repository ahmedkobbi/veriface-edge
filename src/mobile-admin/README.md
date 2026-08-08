# VeriFace Edge — Mobile Admin App

React Native (Expo) app for on-the-go tenant management.

## Features

| Feature | Description |
|---------|-------------|
| 🔐 Biometric Login | Face ID / Touch ID / device PIN required on launch |
| 📊 Dashboard | Real-time auth stats, usage, recent activity |
| 🔑 API Keys | List, create, revoke (with one-time key display) |
| 🛡️ Security | Fraud score, audit stream, security alerts |
| 💳 Billing | Plan status, invoices, upgrade (Stripe Checkout) |
| 🔔 Push Notifications | Security + billing + auth alerts |
| ⚙️ Settings | Profile, notification preferences, links |

## Security

- **Session**: Stored in `expo-secure-store` (encrypted Keychain/Keystore)
- **Biometric**: Face ID / Touch ID required on app launch
- **Auto-logout**: 5 minutes of inactivity → automatic sign out
- **Certificate pinning**: (future) via `expo-network`
- **No AsyncStorage**: No sensitive data in plaintext storage

## Setup

```bash
cd src/mobile-admin
npm install
npx expo start
```

Press `i` for iOS simulator or `a` for Android emulator.

## Building for Production

```bash
# iOS
npx expo build:ios

# Android
npx expo build:android
```

## Push Notification Setup

1. Create an Expo project at https://expo.dev
2. Get your project ID from the Expo dashboard
3. Update `projectId` in `services/NotificationService.ts`
4. The app automatically registers for push notifications on login

## Architecture

```
App.tsx                          — Root (auth gate + biometric)
├── navigation/
│   └── MainTabNavigator.tsx     — Bottom tabs (5 screens)
├── screens/
│   ├── AuthScreen.tsx           — Login + 2FA
│   ├── DashboardScreen.tsx      — Stats + recent activity
│   ├── ApiKeysScreen.tsx        — List + create + revoke
│   ├── SecurityScreen.tsx       — Fraud score + audit stream
│   ├── BillingScreen.tsx        — Plan + invoices + upgrade
│   └── SettingsScreen.tsx       — Profile + prefs + logout
└── services/
    ├── ApiService.ts            — HTTP client (session auth)
    └── NotificationService.ts   — Push notification registration
```
