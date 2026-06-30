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

## Production Cutover Later

- Export real gift cards, customers, and booking records from the source system.
- Clean and map fields.
- Import into production Postgres with a one-time script.
- Verify gift card balances and booking counts.
- Freeze the legacy source during cutover.
