# iranexpedia WhatsApp tools

## Folders

| Path | Purpose |
|---|---|
| `WAchromeExtension/` | Chrome extension (load unpacked in Chrome) |
| `server/` | License API for Vercel / local Node |

The extension and server are separate. Vercel should deploy **only** `server/`.

## Local license API

```bash
cd server
npm install
npm start
```

## Deploy API to Vercel (GitHub auto-deploy)

1. Push repo to GitHub
2. Vercel → Import repo
3. Set **Root Directory** to `server`
4. Deploy
5. In extension popup, set server URL to `https://YOUR_PROJECT.vercel.app`

Details: see [`server/README.md`](server/README.md)

## Extension

1. `chrome://extensions` → Load unpacked → select `WAchromeExtension`
2. Activate license against local or Vercel API
