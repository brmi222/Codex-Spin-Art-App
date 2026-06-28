# Spin Art Raleigh Booking

A configurable booking app foundation for Spin Art Raleigh. It is intentionally single-business, but content, media, experiences, add-ons, policies, and availability live in data instead of being hard-coded into UI components.

## Run locally

```powershell
npm start
```

Then open:

```text
http://localhost:4280
```

Routes:

- `/` public landing page
- `/book.html` customer booking flow
- `/admin.html` staff/admin console

If Node is only available through the Codex bundled runtime, run:

```powershell
& 'C:\Users\brian\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

## Drip CRM sync

Set these environment variables before starting the server to send new booking customers to Drip:

```powershell
$env:DRIP_API_TOKEN = "your-drip-api-token"
$env:DRIP_ACCOUNT_ID = "your-drip-account-id"
$env:DRIP_BOOKING_TAG = "Spin Art Booking"
npm start
```

When configured, `POST /api/bookings` will:

- create or update the Drip subscriber,
- tag them with `DRIP_BOOKING_TAG`,
- store booking details as Drip custom fields,
- and record a `Created a booking` Drip event.

There is also a direct CRM handoff endpoint:

```http
POST /api/crm/customers
Content-Type: application/json

{
  "source": "manual_api",
  "customer": {
    "name": "Jane Example",
    "email": "jane@example.com",
    "phone": "919-555-0100"
  },
  "notes": "Asked about a birthday party"
}
```

If Drip credentials are not configured, booking creation still succeeds and the CRM response is marked as skipped.

## What is included

- Public booking flow
- Configurable experiences, pricing, images, included items, and add-ons
- Date/time availability based on resource capacity
- Guest count validation
- Booking creation
- Drip CRM subscriber/event sync
- Admin view of bookings
- Staff actions for check-in, waiver status, and cancellation
- Editable hero content from the admin panel
- Branded local media assets with image/video-ready configuration
- JSON-backed repository for early iteration

## Current data model

The seed data lives in `data/store.json`.

Primary records:

- `business`: brand, contact, timezone
- `site`: hero, page sections, FAQs
- `resources`: bookable capacity such as studio floor or party zone
- `experiences`: packages, pricing, duration, limits, add-ons, and availability rules
- `addOns`: optional upsells
- `policies`: cancellation and waiver language
- `bookings`: customer reservations
- `holds`: reserved for checkout holds

## Media strategy

Current media assets live in `public/assets` and are referenced from `site.hero`, `site.media`, and each `experience.imageUrl`.

When Google Drive media access is available, use Drive as the source library and sync approved web-ready files into local or hosted asset storage. Keep Drive metadata on each media record so assets remain traceable:

```json
{
  "id": "studio-spin-video",
  "type": "video",
  "title": "Studio spin loop",
  "url": "/assets/studio-spin-loop.mp4",
  "source": "google-drive",
  "driveFileId": "..."
}
```

Use short, compressed `.mp4` or `.webm` loops for the hero video and optimized `.jpg`/`.webp` images for experience cards.

## Production architecture path

This starter is designed so the storage and payment layers can be upgraded without changing the product model.

Recommended production stack:

- Next.js or Remix for the public/admin app
- PostgreSQL for bookings, resources, customers, waivers, payments, and audit logs
- Prisma or Drizzle as the data access layer
- Stripe Checkout or Payment Intents for deposits and balance payments
- Stripe webhooks for payment confirmation and refunds
- Resend or Postmark for email
- Twilio for SMS reminders
- S3-compatible storage for waiver PDFs and media uploads
- Sentry for error monitoring
- Trigger.dev, Inngest, or a queue worker for reminders and follow-ups

## Booking engine notes

Availability should stay resource-based. A private party, team event, or drop-in session is not just a calendar event; it consumes capacity on a bookable resource.

The production version should use database transactions when confirming bookings:

1. Customer selects a slot.
2. App creates a short-lived hold.
3. Customer checks out.
4. Stripe webhook confirms payment.
5. App confirms booking inside a transaction after rechecking capacity.
6. Confirmation, waiver, and reminder jobs are scheduled.

## Next build steps

1. Replace JSON storage with PostgreSQL tables.
2. Add admin authentication and staff roles.
3. Add Stripe deposits and webhook confirmation.
4. Add waiver signing and waiver document versioning.
5. Add email/SMS templates and scheduled reminders.
6. Add media upload support for editable page and experience images.
7. Add cancellation and reschedule self-service links.
