# GTM Flow — Founder Outreach Engine

A complete go-to-market loop in one app: **source B2B founders/owners globally → craft & personalize email → send → track open / click / reply performance.**

## What it does

| Stage | Page | Backed by |
|-------|------|-----------|
| Source | **Find Founders** — filter by geography, company size, role, industry, keywords | Apollo.io API (`APOLLO_API_KEY`) → falls back to realistic sample data |
| Craft | **Mail Templates** — editor with `{{merge_fields}}` and live preview | — |
| Send | **Campaigns** — build a campaign from selected founders, review the email, send | Resend (`RESEND_API_KEY`) → simulates sends without a key |
| Track | **Campaign detail + Dashboard** — sent / delivered / opened / clicked / replied, funnel chart | Tracking pixel, click redirect, Resend webhook, manual reply marking |

## Runs out of the box

With **no keys at all**, the app is fully usable: it serves sample founders, simulates sends, and flows recipients through the delivery→open→reply pipeline so you can demo the entire GTM loop. Add keys to make each layer real.

## Environment variables

Copy `.env.example` to `.env.local` and fill what you have:

- `APOLLO_API_KEY` — live founder sourcing. Without it, sample leads are generated.
- `RESEND_API_KEY` + `EMAIL_FROM` — real email sending from a verified domain.
- `DATABASE_URL` — Neon Postgres connection string for persistence. Without it, an in-memory store (seeded) is used — great locally, but resets on serverless cold starts.
- `NEXT_PUBLIC_APP_URL` — your deployed origin (used to build tracking pixel + click links).
- `RESEND_WEBHOOK_SECRET` — optional, for the delivered/bounced webhook.

## Local dev

```bash
npm install
npm run dev
# http://localhost:3000
```

## Tracking model

- **Opens** — invisible 1×1 pixel at `/api/track/open/[recipientId]`.
- **Clicks** — links in the body are rewritten through `/api/track/click/[recipientId]?url=…` then 302-redirected.
- **Delivered / bounced** — Resend webhook → `/api/webhooks/resend` (point a Resend webhook at `{APP_URL}/api/webhooks/resend`).
- **Replies** — detected out-of-band (inbound mailbox / IMAP poll) and posted to `/api/recipients/[id]/event`, or marked manually in the campaign view.

## Deploy (Vercel)

Connect the repo to Vercel, add the env vars above, deploy. Use Neon for `DATABASE_URL`.
