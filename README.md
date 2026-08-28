# Slate

Guided executive-search workspace. Node 20, Express, JSON file store.

## Local

```bash
cp .env.example .env
# add ANTHROPIC_API_KEY
npm install
npm start
```

Open http://127.0.0.1:4173. Demo logins (local only): Abe `abe@slate.local` / `2468`, Mike `mike@slate.local` / `1357`.

`npm test` hits a running server (default `http://127.0.0.1:4173`).

## Railway (or similar)

1. New service from this repo. Start command is `npm start`. Health check: `/api/health`.
2. Variables:
   - `ANTHROPIC_API_KEY` (required for drafts and city research)
   - `CLAUDE_MODEL` / `CLAUDE_MODEL_PREMIUM` (optional)
   - `NODE_ENV=production` (Railway sets this)
3. Attach a **volume** and set `DATA_DIR` to the mount path (for example `/data`). Production will not start without this.
4. On first boot of an empty volume, set `SLATE_PIN_ABE` and `SLATE_PIN_MIKE`. Do not turn on `SHOW_DEMO_LOGINS`.
5. Keep a **single replica**. The store is one JSON file; two instances will overwrite each other.

The app binds `0.0.0.0` and uses `PORT` from the platform. Session cookies are `Secure` in production.
