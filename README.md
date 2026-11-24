# DNC Screening

A local Do Not Call screening demo with a Next.js App Router frontend, an Express API, and PostgreSQL.

- `frontend/app` contains the routes. Page components live in `frontend/components`.
- `backend/src/modules` contains the authentication, access management, API key, and screening modules, with separate controllers, middleware, services, and repositories where applicable.
- `backend/src/db` contains PostgreSQL migrations and fictional federal and state entries. The active snapshot and the lookup event are read and recorded together.

## Start locally

Use Node.js 22 or newer, pnpm, and PostgreSQL 17 or newer. The Compose file can start a local PostgreSQL instance if Docker is available.

1. Check `backend/.env` and `frontend/.env`. If either file is missing, copy its sibling `.env.example`. Set a random `JWT_SECRET` of at least 32 bytes and a 12–128 character `ADMIN_PASSWORD`. The local workspace was initialized with generated credentials in `backend/.env`.
2. Set the backend `DATABASE_URL`, `HOST`, and `PORT`, and the frontend `HOST`, `PORT`, and `API_ENDPOINT`. The endpoint is the backend origin, for example `http://127.0.0.1:4000`. Restart development or rebuild production after changing it.
3. Start PostgreSQL with `docker compose --env-file backend/.env up -d --wait`, or use an existing PostgreSQL database matching `DATABASE_URL`. The Compose database settings use the `POSTGRES_*` variables from `backend/.env`.
4. Run `pnpm install --frozen-lockfile`, then `pnpm db:setup`.
5. Start both apps with `pnpm dev`. Open [the local app](http://127.0.0.1:3000) and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

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

- `pnpm db:migrate` applies the versioned SQL in `backend/src/db/migrations/001_initial.sql` and records it in `schema_migrations`.
- `pnpm db:seed` loads the synthetic registry and creates the first Super Admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- `pnpm db:setup` runs both in one transaction. Re-running either command preserves existing accounts and does not duplicate the seed records.

## Manage access

1. As Super Admin, create a role under **Roles**. Choose each page and each function independently. For example, enable **Screening** plus **Check a number in the workspace**.
2. Use **Users** to create a user with that role. The built-in Super Admin is protected. Delegated user managers can assign only custom roles within their own permissions.
3. To let a user issue an API key, grant **API keys**, **Create own API keys**, and **Check a number through the API**. Grant list and revoke permissions separately. A machine key can only call the screening endpoint, and requests use the owner's current permissions.

## Try a lookup

| Number | Synthetic result |
| --- | --- |
| `+1 (212) 555-0100` | Federal and NY match |
| `(305) 555-0123` | State-only match in FL and TX |
| `(415) 555-0134` | No match |

The attached FTC materials informed the sample result shape. The bundled records are fictional and do not incorporate the complaint or merger CSV rows. Seller SAN verification, FTC data ingestion, billing, and bulk exports are outside this demo.

## Screening API

Send `POST /api/v1/screening/check` with JSON and the `X-API-Key` header. The frontend proxies `/api` to its configured endpoint; clients can also call the backend directly. A missing or revoked key returns `401`, a key without screening permission returns `403`, and invalid phone input returns `400`. An unavailable snapshot returns `503`.

```http
POST /api/v1/screening/check
Content-Type: application/json
X-API-Key: YOUR_API_KEY

{"phone":"+1 (212) 555-0100"}
```

The response contains `phone` in +1 format, `exists`, `federalMatch`, `stateMatches`, `source`, `generation`, `publishedAt`, and `checkedAt`. History masks numbers and shows the signed-in user's most recent 50 successful checks. A synthetic result cannot be used to determine whether a number may be called.
