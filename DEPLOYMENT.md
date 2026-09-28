# Deployment: Render API + Vercel client

This guide deploys the API on Render and the Vite single-page client on Vercel. No secrets belong in GitHub, `render.yaml`, `vercel.json`, or `client/.env.production.example`.

## Before pushing to GitHub

1. Review `git status` and verify that `server/.env` and `client/.env` are not staged. The root `.gitignore` excludes `.env` files.
2. Rotate any Stripe, MongoDB, SMTP, or other credentials that were pasted into chat, logs, screenshots, or tracked files. Use the replacement values only in the relevant hosting provider's secret settings.
3. Push the project to a GitHub repository yourself. This workspace has not initialized, committed, or pushed Git changes.

## MongoDB Atlas

1. Create a MongoDB Atlas cluster and a database user with a strong unique password.
2. Configure Atlas Network Access to allow Render to reach the cluster. Prefer Render's static outbound IP allowlist if available; otherwise use a deliberately chosen network policy and understand its exposure.
3. Copy the **Node.js driver** connection string, URL-encode special characters in the database user's password, and include a database name. Atlas clusters are replica sets, which support the transactions this app requires.
4. Keep the full URI private for the Render `MONGODB_URI` setting.

## Deploy the server to Render

1. In Render, choose **New → Blueprint** and connect the GitHub repository containing `render.yaml`. The Blueprint defines the API service with `server/` as its root, `npm ci --include=dev && npm run build` as its build, `npm start` as its start command, and `/health` as its health check.
2. Set the Blueprint's unsynchronized values in Render's environment settings:
   - `MONGODB_URI`: the Atlas replica-set URI.
   - `CLIENT_URL`: the final Vercel origin only, e.g. `https://consultbook-live.vercel.app` (comma-separate additional trusted client origins if needed).
   - `STRIPE_SECRET_KEY`: Stripe test secret for test deployments, or live secret only for a deliberate production launch.
   - `STRIPE_WEBHOOK_SECRET`: the signing secret for the Stripe endpoint created below.
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: provider settings; these may stay blank if confirmation emails aren't needed yet.
3. Deploy, then verify `https://YOUR-RENDER-SERVICE.onrender.com/health` returns `{"status":"ok",...}`.
4. Seed initial admin/customer/service data once, using Render's shell for the service or a secure one-off job:

   ```bash
   npm run seed
   ```

   Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CUSTOMER_EMAIL`, and `CUSTOMER_PASSWORD` as private Render environment variables before running the seed. Do not use the example passwords. Seed again only when you intentionally need to add missing starter records; it does not overwrite existing records.

## Deploy the client to Vercel

1. In Vercel, import the same GitHub repository.
2. Set **Root Directory** to `client`.
3. Vercel should detect Vite. `client/vercel.json` configures `npm run build`, output directory `dist`, and the SPA fallback to `index.html`. This file is inside the configured root so Vercel applies it to deep links such as `/admin` when the page is refreshed. The root `vercel.json` remains available if deploying with the repository root as the Vercel project root instead.
4. Set these Vercel environment variables for Production (and Preview if you want deploy previews to call the API):
   - `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com/api/v1`
   - `VITE_SOCKET_URL=https://YOUR-RENDER-SERVICE.onrender.com`
5. Deploy and note the final Vercel domain. Add that exact origin to Render's `CLIENT_URL`, then redeploy/restart the API so credentialed CORS uses the final origin.

The app uses an httpOnly refresh cookie. Production uses `SameSite=None; Secure` when `COOKIE_SECURE=true`; both client and API must use HTTPS, and CORS must allow the exact Vercel origin with credentials.

## Stripe webhooks

1. In Stripe, keep the intended mode selected (test mode for validation).
2. Add a webhook destination at `https://YOUR-RENDER-SERVICE.onrender.com/api/v1/webhooks/stripe`.
3. Select `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `payment_intent.payment_failed`.
4. Copy the endpoint signing secret into Render's `STRIPE_WEBHOOK_SECRET` and restart/redeploy the service.
5. Test checkout with Stripe test credentials and test cards. Do not use test webhook secrets with live mode or live keys with test mode.

## Production checklist

- `NODE_ENV=production`, `COOKIE_SECURE=true`, unique generated JWT secrets, and Atlas `MONGODB_URI` are set in Render.
- `CLIENT_URL` is the exact HTTPS Vercel origin; Vercel uses the Render HTTPS API/socket URLs.
- Test and live Stripe keys/webhook secrets are kept separate and match the selected Stripe mode.
- Seed credentials are replaced with private strong values before seeding; change or disable the seeded customer account if not needed.
- Render health check is green, logs show no startup errors, and a test booking reaches Checkout and confirms only after Stripe's webhook.
- Run locally before deploying changes: `npm run lint`, `npm test --workspace server`, `npm run build`, and `npm run format:check`.

Render's free instances may sleep and introduce cold starts; choose a plan with persistent availability for a production booking service. Verify the selected Render plan supports the persistent WebSocket connections required by Socket.IO.
