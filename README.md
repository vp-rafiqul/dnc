# DNC Screening

A local Do Not Call screening demo with a Next.js App Router frontend, an Express API, Prisma, and PostgreSQL.

- `frontend/app` contains the routes. Page components live in `frontend/components`.
- `backend/src/modules` contains the authentication, access management, API key, and screening modules, with separate controllers, middleware, services, and repositories where applicable.
- `backend/prisma` contains the Prisma schema and PostgreSQL migrations. `backend/src/db` contains the Prisma client factory and the fictional registry seed. The active snapshot and the lookup event are read and recorded together.

## Start locally

Use Node.js 22.18 or newer, pnpm, and PostgreSQL 17 or newer. The Compose file can start a local PostgreSQL instance if Docker is available.

1. Check `backend/.env` and `frontend/.env`. If either file is missing, copy its sibling `.env.example`. Set a random `JWT_SECRET` of at least 32 bytes and a 12–128 character `ADMIN_PASSWORD`. Generate distinct values for `API_KEY_ENCRYPTION_SECRET` and `HISTORY_SEARCH_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Keep these values stable to preserve saved key access and phone searches. The local workspace was initialized with generated credentials in `backend/.env`.
2. Set the backend `DATABASE_URL`, `HOST`, `PORT`, and `FRONTEND_ORIGIN`, and the frontend `HOST`, `PORT`, and `API_ENDPOINT`. The default backend origin is `http://127.0.0.1:4000`, and `FRONTEND_ORIGIN` must match the browser URL's origin, which defaults to `http://127.0.0.1:3000`. Restart development or rebuild the frontend after changing these settings.
3. Start PostgreSQL with `docker compose --env-file backend/.env up -d --wait`, or use an existing PostgreSQL database matching `DATABASE_URL`. The Compose database settings use the `POSTGRES_*` variables from `backend/.env`.
4. Run `pnpm install --frozen-lockfile`, then `pnpm db:setup`.
5. Start both apps with `pnpm dev`. Open [the local app](http://127.0.0.1:3000) and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

Both apps use strict TypeScript. Run `pnpm typecheck` to check the workspace or `pnpm build` to check the backend and build the frontend. Node runs the backend TypeScript directly.

The setup command seeds the first Super Admin on an empty database. Changing the env password later does not change the existing account. Set `COOKIE_SECURE=true` when serving over HTTPS. The local defaults bind both servers and the Compose database to loopback.

### Windows PowerShell

If the terminal cannot run `pnpm`, use the project launcher from the repository root. It uses workspace-local Node.js and the pinned pnpm version when provisioned. On a fresh checkout, install Node.js with npm so the launcher can run pnpm through `npx.cmd`.

```powershell
.\pnpm.cmd install --frozen-lockfile
.\pnpm.cmd db:setup
.\pnpm.cmd dev
```

## Database migration and seed

For an existing PostgreSQL server, create a dedicated database (for example, `CREATE DATABASE dnc;`) if it does not already exist, then point `DATABASE_URL` to it.

- `pnpm db:generate` generates Prisma Client from `backend/prisma/schema.prisma`.
- `pnpm db:migrate` runs Prisma Migrate to apply pending migrations in `backend/prisma/migrations`.
- `pnpm db:seed` runs the Prisma seed to load the synthetic registry and create the first Super Admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- `pnpm db:setup` generates the client, deploys migrations, and then seeds. Re-running setup preserves existing accounts and does not duplicate the seed records.

When upgrading a database that already ran the five legacy SQL migrations, run `pnpm db:baseline` once before `pnpm db:setup`. Baselining records the existing schema in Prisma's migration history. For a fresh database, run `pnpm db:setup` directly.

## Manage access

1. As Super Admin, create a role under **Roles**. Choose each page and each function independently. For example, enable **Screening** plus **Check a number in the workspace**.
2. Use **Users** to create a user with that role. The built-in Super Admin is protected. Delegated user managers can assign only custom roles within their own permissions.
3. To let a user issue an API key, grant **API keys**, **Create own API keys**, and **Check a number through the API**. Grant list and revoke permissions separately. A machine key can only call the screening endpoint, and requests use the owner's current permissions.

### Reseller accounts

1. As Super Admin, open **Users** and choose **New reseller**. The reseller signs in with the account you create.
2. As the reseller, open **Roles** and create a role with the screening, history, and API key permissions your users need.
3. Open **Users**, create a user with that role, or use **Manage** to change the role of an existing user in your reseller account.

Each reseller manages only their own users and roles. Only a Super Admin can create other reseller accounts and see the users and roles across resellers. The Super Admin can deactivate a reseller's login separately from the reseller's users.

## Seller onboarding and SAN verification

Before verified coverage starts, a seller registers its FTC Subscription Account Number (SAN), chooses and pays for coverage, signs an authorization, and a reviewer confirms the SAN with the FTC.

1. **Sign-up.** Sellers create their own account at `/register` (linked from the sign-in page). The new account gets the built-in self-service **Seller** role (`page.seller` + `seller.manage`), which a Super Admin can edit under **Roles**.
2. **Seller profile** (`page.seller` + `seller.manage`, reseller-assignable). The seller enters the legal name, organization ID, SAN and authorized representative. The API encrypts the SAN with AES-256-GCM under the active key in `SAN_ENCRYPTION_KEYS` and stores only the last four characters for display. The SAN's format never implies verification.
3. **Coverage and payment.** The seller picks **All of America**, whole **states**, or specific **area codes**, and a **monthly** or **yearly** cycle.
   - The price is the sum of each selected area code's price. Each code uses its own price if an admin set one, otherwise the default ($5/month or $60/year to start). A state includes all of its available area codes; All of America includes every available area code.
   - The subscription starts as `AWAITING_PAYMENT`. The seller pays by **card** (Stripe Checkout) or **bank transfer** (admin bank instructions plus a `DNC-…` reference). They can switch method or cancel while it is unpaid.
   - A successful payment moves the subscription to `PENDING` in the verification queue. Card payments are confirmed by the Stripe webhook, or by the API checking the session when the seller returns from Checkout. Bank transfers are confirmed by staff under **Billing**.
   - Coverage is not granted at payment time. The paid month or year starts when the subscription is first verified.
4. **Billing admin** (`page.billing` + `billing.manage`, Super Admin–grantable only). Staff manage default prices, bank instructions, states, area codes (availability and optional price per code), and payments. They confirm a bank transfer with an optional bank reference, or reject a payment with a reason. 12 starter area codes and all 50 states plus DC are seeded; add the rest under **Billing**.
5. **Seller authorization.** The seller signs electronically, choosing the permitted scope, an expiration date (at most 400 days), and a revocation channel (in the workspace or by email). The evidence object records the consent text version and SHA-256 hash, the typed signature, the account, IP address and user agent. When the seller revokes it in the workspace, verified coverage ends immediately and the subscription becomes `REVIEW_REQUIRED`.
6. **Seller verification** (`page.seller_review` + `sellers.review`, Super Admin–grantable only). A reviewer looks the seller up in the FTC service-provider client. They record the confirmation reference, the check date, whether the identity, SAN period and area codes match, the SAN period dates and the confirmed area codes. Revealing the full SAN and every decision are logged with the reviewer's identity. Reviewers cannot verify a seller profile they own.
   - **Verify & activate.** For a paid request, the form starts with every check set to Confirmed, the SAN dates and the check date filled in, and the FTC reference optional. One click verifies the area codes and starts the paid period, recorded as the reviewer's attestation. Changing a check to Unclear sends the request to review; Does not match or Reject rejects it.
   - **Reseller access.** When a self-registered seller has a verified subscription, their account moves to the built-in **Reseller** role. That role covers screening, history, API keys, the seller profile, and managing their own users and roles. If no verified subscription remains (expired, revoked, sent back for review or rejected), the account moves back to the **Seller** role, and API keys stop working because they use the owner's current permissions. Accounts that an admin made resellers are never changed. Each change is recorded in the seller's audit log.
   - Any mismatch, or an explicit rejection, results in `REJECTED`.
   - Any unclear check, missing evidence, an ended period, or a missing or expired authorization results in `REVIEW_REQUIRED`.
   - Only a paid subscription with complete, confirmed evidence results in `VERIFIED`. One transaction writes the verified subscription, the verification record and the area-code coverage. Coverage ends at the earliest of the SAN period end, the paid-through date and the authorization expiry.
7. **Scheduled maintenance** runs in the API every 5 minutes.
   - It delivers renewal notices (60, 30 and 7 days before the end), authorization-expiry notices and periodic review reminders (every 90 days) in the app.
   - It expires subscriptions and coverage at the verified SAN end date or the paid-through date.
   - It moves verified subscriptions whose authorization lapsed to `REVIEW_REQUIRED`.

   Renewals are new subscription requests. Changing the legal name, organization ID or SAN also sends verified subscriptions back to review.

Generate the key with `node -e "console.log('v1:' + require('node:crypto').randomBytes(32).toString('base64url'))"`. To rotate it, put the new key first, for example `SAN_ENCRYPTION_KEYS=v2:NEW,v1:OLD`. Keep the older key so existing SANs can still be decrypted. In production, load these keys from a managed key service (KMS) rather than a plain env file.

### Card payments with Stripe

Set `STRIPE_SECRET_KEY` (a `sk_test_…` key while testing) in `backend/.env` to offer card payments; without it, sellers see bank transfer only. Restart the backend after changing `.env`.

- **In-app card form.** With `STRIPE_PUBLISHABLE_KEY` set, the card form and any 3D Secure challenge open inside the seller page through Stripe.js Embedded Checkout (`ui_mode: embedded_page`), so the seller never leaves the app. Without a publishable key, sellers are redirected to the Stripe-hosted Checkout page and back.
- **Card only, with 3D Secure.** Checkout sessions allow only cards. `STRIPE_THREE_D_SECURE` defaults to `any`, so Stripe asks for 3D Secure whenever the card supports it. Set it to `automatic` to authenticate only when the bank requires it, or `challenge` to always show a challenge.
- **No webhook required.** When the embedded form completes, or the seller returns from hosted Checkout, the page polls `POST /api/seller/billing/payments/:id/refresh` for up to 30 seconds. Each poll reads the session from Stripe and marks the payment paid once Stripe confirms it. If the seller closes the tab before returning, they can press **Check payment status** later.
- **Test cards.** `4242 4242 4242 4242` (no authentication) and `4000 0027 6000 3184` (always shows a 3D Secure challenge), with any future expiry date and any CVC.
- **Local currency.** If Adaptive Pricing is on in your Stripe account, Checkout may offer a local currency. The session still settles in USD, so the amount check is unaffected.

Webhooks are optional. To add them, set `STRIPE_WEBHOOK_SECRET` and point a Stripe webhook (or `stripe listen --forward-to 127.0.0.1:4000/api/billing/stripe/webhook`) at `POST /api/billing/stripe/webhook` with the `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired` events. Each billing period is a one-time payment: sellers pay again for the next period after a renewal notice.

This demo does not call an FTC API, send email notices, charge recurring payments automatically, or restrict screening to verified coverage yet.

## Try a lookup

| Number | Synthetic result |
| --- | --- |
| `+1 (212) 555-0100` | Federal and NY match |
| `(305) 555-0123` | State-only match in FL and TX |
| `(415) 555-0134` | No match |

The attached FTC materials informed the sample result shape. The bundled records are fictional and do not incorporate the complaint or merger CSV rows. Seller SAN verification, FTC data ingestion, billing, and bulk exports are outside this demo.

## Screening API

Call the backend directly on port `4000` with your API key:

```http
POST http://127.0.0.1:4000/api/v1/screening/check
X-API-Key: YOUR_API_KEY
Content-Type: application/json

{"phone":"+1 (212) 555-0100"}
```

Invalid or revoked keys return `401`, missing screening permission returns `403`, invalid phone input returns `400`, and an unavailable snapshot returns `503`.

For signed-in workspace requests such as `GET /api/keys`, use `Authorization: Bearer ACCESS_TOKEN`. The workspace receives the session JWT as `accessToken` from `POST /api/auth/login`.

The response contains `phone` in +1 format, `exists`, `federalMatch`, `stateMatches`, `source`, `generation`, `publishedAt`, and `checkedAt`. A synthetic result cannot be used to determine whether a number may be called.

Each API key defaults to 60 requests per calendar minute, including keys created before the rate-limit migration. Under **API keys**, authorized users can set **Requests per minute** when creating a key or use **Edit limit** for an active key. Super Admins can grant **Customize rate limits on own API keys** to other roles. An edit takes effect immediately and counts requests already made in the current minute.

**View details** shows a key's prefix, status, dates, and rate limit. Users with **Copy own API keys** can copy active keys with an encrypted value. Older keys stored only as hashes require a replacement to use this feature. Revocation removes the saved secret.

Screening responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining`. When a key reaches its limit, the API returns `429` and a `Retry-After` header with the number of seconds until the next minute.

## History and reports

History defaults to 10 rows per page, with options for 25, 50, and 100. You can combine a date range, channel, and any contiguous digits from a phone number. Dates include the entire selected day in the browser's time zone. Older lookups without phone search tokens can only be searched by their visible last four digits.

CSV, Excel, and PDF downloads include every matching row across all pages. Reports mask phone numbers and label their timestamps in UTC. History and downloads are scoped to the signed-in user.
