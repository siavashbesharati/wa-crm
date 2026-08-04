# Obfuscated extension build

## Source (edit here)
`WAchromeExtension/` — readable source

## Dist (give to users / load in Chrome)
`WAchromeExtension-dist/` — obfuscated build

## Build

```bash
npm install
npm run build:ext
```

Chrome → Load unpacked → select `WAchromeExtension-dist`

## Auth (OTP only)

Unlock requires live server session via `auth-gate.js`:
- enabled cloud config
- access token
- org id
- successful `/auth/me` (`status().connected` + `me.org`)

If the API is down, the extension stays locked.

## Obfuscation profiles

| Profile | Files | Protections |
|---------|--------|-------------|
| **HARD** | `auth-gate.js`, `cloud-bridge.js`, `content.js`, `background.js`, `popup.js`, `dashboard.js`, `crm-panel.js` | RC4 string array, control-flow flattening, dead-code injection, split strings, object-key transform |
| **MEDIUM** | `crm-store.js` | base64 string array, lighter flattening |

Verification conditions (enabled / token / org / `connected` / `/auth/me`) are enforced in both `cloud-bridge.js` and `auth-gate.js` (dual seal + integrity fingerprint).

No sensitive JS is copied plaintext into dist.

## Limits (be honest with customers)

Client-side Chrome extensions can always be patched by a determined attacker. Obfuscation raises cost; **server OTP + JWT revoke** is the real control plane.
