# Postgres Migration Plan

This project is moving from local JSON storage to Postgres. The first step is framework setup, not real customer-data migration.

## Current Supabase Project

- Project URL: `https://hrhqfevhmxumwxrsehtl.supabase.co`
- Keep the database password, service role key, and full connection string in `.env` only.
- The current repo has the initial Prisma migration SQL prepared in `prisma/migrations/20260630211000_init/migration.sql`.
- The Supabase CLI is optional for this app. It is not currently installed on this machine, so Prisma migrations are the primary path.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Replace the placeholder password in `DATABASE_URL`.
   - Example format: `postgresql://postgres:REAL_PASSWORD@db.hrhqfevhmxumwxrsehtl.supabase.co:5432/postgres?schema=public`
3. Generate Prisma client:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run db:generate
```

4. Create the first database migration:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run db:migrate -- --name init
```

5. Seed configuration/test data:

```powershell
npm.cmd run db:seed
```

## Migration Scope Now

- Create the production database schema.
- Seed app configuration such as experiences, resources, add-ons, discounts, media references, and site settings.
- Use test/demo bookings only while building.
- Do not import real customers, real gift card balances, or production booking history yet.
- The Node server uses Postgres automatically when `DATABASE_URL` is present. Without `DATABASE_URL`, it falls back to local `data/store.json`.
- Current runtime coverage includes config reads, availability reads, public bookings, employee bookings, payments, discounts, gift cards, holds, and admin config/media updates through the existing API shape.

## Staff Access

- Admin and employee pages require staff login when `DATABASE_URL` is present.
- The first visit to `/login.html` can create the first owner account if no staff users exist.
- In production, set `AUTH_BOOTSTRAP_TOKEN` before launch if the first-owner setup might be exposed publicly.
- Owner/admin roles can access the admin console; owner/admin/employee roles can access the employee calendar.

## Square Checkout

- Hosted Square checkout is wired through Square Payment Links when `PAYMENT_PROVIDER=square`.
- Required environment values:
  - `SQUARE_ENVIRONMENT`: `sandbox` or `production`
  - `SQUARE_LOCATION_ID`
  - `SQUARE_ACCESS_TOKEN`
  - `SQUARE_WEBHOOK_SIGNATURE_KEY`
  - `SQUARE_REDIRECT_BASE_URL`
- Local development can keep `PAYMENT_PROVIDER=mock`.
- Webhook event verification and payment-status mapping should be finished after live Square credentials are configured.

## Production Cutover Later

- Export real gift cards, customers, and booking records from the source system.
- Clean and map fields.
- Import into production Postgres with a one-time script.
- Verify gift card balances and booking counts.
- Freeze the legacy source during cutover.
