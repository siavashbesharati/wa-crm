# Obfuscated extension build

## Source (edit here)
`WAchromeExtension/` — readable source

## Dist (give this to users / load in Chrome)
`WAchromeExtension-dist/` — obfuscated build

## Build

```bash
npm install
npm run build:ext
```

Then in Chrome:
1. `chrome://extensions`
2. Load unpacked
3. Select `WAchromeExtension-dist`

## Create a license (hash + expiry)

```bash
npm run license:gen -- --key "IRAN-CUSTOMER-001" --expires "2026-12-31T23:59:59Z" --label "ali"
```

Paste the printed object into `license-config.js` → `entries`, then rebuild.

Demo key (already hardcoded hash): `IRAN-DEMO-2026` (expires 2026-12-31)

## Notes
- Expiry is checked against **web UTC time** (not only PC clock)
- Obfuscation slows casual reading; it is not unbreakable protection
