# iranexpedia.ir — License API (Vercel)

This folder is the **backend only**. The Chrome extension in `/WAchromeExtension` is separate and is not built by Vercel.

## Local run

```bash
cd server
npm install
npm start
```

- Health: `GET http://localhost:3000/api/health`
- Verify: `POST http://localhost:3000/api/license/verify` with `{ "key": "IRAN-DEMO-0001" }`

## Deploy to Vercel (auto from GitHub)

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com) → **Add New Project** → import the GitHub repo.
3. Important settings:
   - **Root Directory:** `server`
   - Framework Preset: Other
   - Build Command: leave empty (or `npm install`)
   - Output: handled by `api/index.js`
4. Deploy. Each push to `main` will auto-redeploy **only this server**.
5. Copy your URL, e.g. `https://your-app.vercel.app`

### Optional private licenses on Vercel

Project → Settings → Environment Variables:

- Name: `LICENSES_JSON`
- Value: full JSON array of licenses (same shape as `licenses.json`)

If set, env overrides `licenses.json`.

## Extension config

In the extension popup, set **آدرس سرور** to:

`https://your-app.vercel.app`

Then activate a license key.

## Add licenses

Edit `server/licenses.json` and push, or update `LICENSES_JSON` in Vercel env.
