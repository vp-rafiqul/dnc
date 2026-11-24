# DNC Screening

A local Do Not Call screening demo with a Next.js App Router frontend, an Express API, and PostgreSQL.

- `frontend/app` contains the routes. Page components live in `frontend/components`.
- `backend/src/modules` contains the authentication, access management, API key, and screening modules, with separate controllers, middleware, services, and repositories where applicable.
- `backend/src/db` contains PostgreSQL migrations and fictional federal and state entries. The active snapshot and the lookup event are read and recorded together.

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

- `pnpm db:migrate` applies new SQL files in `backend/src/db/migrations` and records them in `schema_migrations`.
- `pnpm db:seed` loads the synthetic registry and creates the first Super Admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- `pnpm db:setup` runs both in one transaction. Re-running either command preserves existing accounts and does not duplicate the seed records.

## Manage access

1. As Super Admin, create a role under **Roles**. Choose each page and each function independently. For example, enable **Screening** plus **Check a number in the workspace**.
2. Use **Users** to create a user with that role. The built-in Super Admin is protected. Delegated user managers can assign only custom roles within their own permissions.
3. To let a user issue an API key, grant **API keys**, **Create own API keys**, and **Check a number through the API**. Grant list and revoke permissions separately. A machine key can only call the screening endpoint, and requests use the owner's current permissions.

### Reseller accounts

1. As Super Admin, open **Users** and choose **New reseller**. The reseller signs in with the account you create.
2. As the reseller, open **Roles** and create a role with the screening, history, and API key permissions your users need.
3. Open **Users**, create a user with that role, or use **Manage** to change the role of an existing user in your reseller account.

Each reseller manages only their own users and roles. Only a Super Admin can create other reseller accounts and see the users and roles across resellers. The Super Admin can deactivate a reseller's login separately from the reseller's users.

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

History defaults to 10 rows per page, with options for 25, 50, and 100. You can combine a date range, channel, and any contiguous digits from a phone number. Dates include the entire selected day in the browser's time zone. Lookups from before migration 004 can only be searched by their visible last four digits.

CSV, Excel, and PDF downloads include every matching row across all pages. Reports mask phone numbers and label their timestamps in UTC. History and downloads are scoped to the signed-in user.
