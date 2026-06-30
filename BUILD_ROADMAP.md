# Spin Art Raleigh Booking App Roadmap

## Product Goal

Build a public, scalable booking experience for Spin Art Raleigh that feels immersive and on-brand while making it easy for customers to reserve experiences, add upgrades, and arrive prepared.

The app should support public bookings, employee day-of operations, admin configuration, and a lightweight CRM for customer follow-up and repeat business.

## Core Public Website

- Immersive landing page using Spin Art Raleigh photos, videos, logo, color palette, and generated illustrations where useful.
- Clear experience selection for Splatter, Spin, Pour Art, Tumblers, Group Events, and Private Events.
- High-conversion hero copy that explains the offer quickly.
- Occasion-based messaging for date nights, birthdays, rainy days, girls' nights, family fun, corporate events, and team building.
- Gallery placed after the booking tiles so customers first understand what they can book.
- Mobile-first layout for customers booking from phones.
- Consistent calls to action across all pages.

## Booking Flow

- Experience selection with image, duration, price, and short description.
- Date and time availability picker.
- Guest count rules per experience.
- Reservation fee by experience that holds the station and serves as the deposit.
- Project/media selection during checkout, with the option to choose in studio.
- Add-ons and upgrades by experience.
- Waiver acknowledgement before booking can be reserved.
- Deposit/reservation-fee or approved hold option.
- Customer information capture.
- Occasion capture inside checkout for CRM, personalization, and abandoned-booking analytics.
- Notes field for birthday names, accessibility needs, questions, or special requests.
- Confirmation screen after booking.
- Email/SMS confirmation to customer.
- Internal notification to staff.

## Pricing Model

- Rename "Studio Fee" to a more customer-friendly term such as "Reservation Fee" or "Station Reservation".
- Reservation fee is due during booking and reserves the guest's station/time; it is not a free hold.
- Guests can pay the reservation fee only and pay for the art medium in store, or choose/pay for the medium up front.
- Add discount mechanism for admin-created promo codes, staff-entered discounts, percent-off, fixed-dollar discounts, and experience/add-on-specific eligibility.
- Track discount usage by code, customer, booking, date range, and source so promos can be measured instead of becoming mystery margin loss.
- Add guardrails for discounts: expiration dates, usage limits, minimum spend, eligible experiences, stackability rules, and permission requirements for employee-applied discounts.
- Spin and Splatter project choices: choose/pay in studio, 12x12 canvas, or 16x20 canvas. The 16x20 canvas should cost more than 12x12.
- Pour Art project choices: choose/pay in studio, 12in bear, unicorn, shoe, or basketball.
- Tumblers are 20oz, with black or white tumbler choice.
- Add-ons include glitter, additional paints/colors, and booking insurance.
- Tumblers include three colors by default, with more colors available as an upgrade.
- Backlog: dynamic pricing by demand, day/time, season, private-event type, and capacity utilization.
- Experiences are non-refundable.
- Booking Insurance allows up to two date/time changes before the reservation time. It remains valid for 6 months, then the reservation fee is forfeited.
- Final project/add-on prices need to be confirmed before production launch.

## Production Hosting

- Deploy Node app publicly on Railway or Render.
- Add custom domain.
- Use environment variables for secrets and production settings.
- Add production logging.
- Add uptime/error monitoring.
- Set up database backups.

## Database & Booking Safety

- Replace local `data/store.json` booking storage with Postgres.
- Store experiences, add-ons, resources, bookings, customers, payments, discounts, gift cards, gift-card ledger entries, and staff users in database tables.
- Store availability rules, blackout windows, special hours, resource capacity, and booking buffers in database tables.
- Add transaction-based booking creation to prevent double bookings.
- Add resource capacity checks for each time slot.
- Add booking statuses such as pending, confirmed, cancelled, refunded, completed, and no-show.
- Add audit timestamps for created, updated, cancelled, and completed bookings.
- Gift cards should be stored as secure ledger-backed value, not just a plain code in JSON. Store only hashed/redacted redemption codes, maintain immutable balance transactions, and audit every purchase, redemption, adjustment, refund, and void.

## Payments

- Use Square for deposits and payments, with a provider abstraction so local development can use a mock checkout.
- Apply Wake County, NC sales tax at 7.25%.
- Create payment records during checkout.
- Confirm bookings only after successful payment or approved hold.
- Store payment status, provider reference IDs, amount due now, tax, total, and balance due in store.
- Add Square checkout creation endpoint once production Square credentials are available.
- Add Square webhook signature verification and map paid, failed, refunded, and cancelled payment events back to bookings.
- Support refunds or partial refunds.
- Support pay-later/manual payment mode for private events or special cases.
- Add gift card purchase flow, redemption during checkout, and staff redemption from the employee view.
- Gift cards should behave like stored value/cash: require database-backed balances, secure code generation, fraud-resistant redemption checks, and clear reconciliation against Square/payment records.
- Discounts should apply before tax where legally appropriate; gift cards should apply as tender/payment after the taxable total is calculated.

## Customer Emails & SMS

- Booking confirmation.
- Reminder before visit.
- Waiver or prep instructions if needed.
- Cancellation or reschedule confirmation.
- Post-visit follow-up.
- Review request.
- Rebooking or promo campaigns later.

## Employee View

- Today view showing all bookings by time.
- Check-in flow for arriving guests.
- Guest count and add-on visibility.
- Customer notes and special occasion details.
- Waiver/payment status.
- Quick status changes: checked in, in progress, drying, ready for pickup, completed, no-show.
- Pickup queue for items drying or boxed.
- Simple search by customer name, phone, email, or booking ID.
- Print or view packaging/pickup labels if needed.

## Admin View

- Dashboard with upcoming bookings, revenue, deposits, capacity, and operational alerts.
- Manage experiences, pricing, descriptions, images, durations, and guest limits.
- Manage add-ons and upsells.
- Manage discount codes, eligibility, usage limits, expiration dates, and promotion reporting.
- Manage gift card lookup, balance, purchase/redemption history, manual adjustments, and voids with admin permission controls.
- Manage availability rules by day, time window, slot interval, minimum notice, resource, and experience.
- Block off dates or time ranges.
- Manage private event holds.
- Manage staff users and permissions.
- View booking details and payment history.
- Cancel, reschedule, refund, or edit bookings.
- Content/media management for landing page, gallery, hero media, and experience images.

## Light CRM

- Customer profiles with contact info, visit history, notes, and preferences.
- Track occasions such as birthday, date night, corporate event, family visit, or school group.
- Tag customers and organizations.
- See lifetime spend and booking count.
- Follow-up reminders for leads and private events.
- Private event inquiry pipeline.
- Email list/export for marketing.
- Basic segmentation for birthdays, corporate/team building, repeat customers, and abandoned inquiries.

## Private & Group Events

- Inquiry flow for larger or custom events.
- Admin approval/quote flow.
- Optional contract or invoice step.
- Capacity and staff scheduling notes.
- Organization/company fields.
- Event contact separate from attendees.
- Internal checklist for setup needs, tables, party zone, favors, snacks, or custom requests.

## Security & Access

- Admin and employee login.
- Role-based permissions.
- Protect admin APIs.
- Secure payment webhook handling.
- Validate all booking input server-side.
- Rate-limit public booking endpoints.
- Keep customer/payment data minimal and secure.

## Operational Tools

- Calendar-style schedule.
- Availability management.
- Booking search.
- Pickup/drying status.
- Internal notes.
- Export bookings to CSV.
- Basic reporting by experience, date range, revenue, and add-ons.

## Scheduling Model

- Resources represent bookable capacity such as Spin Stations, Splatter Room, Pour Stations, Tumbler Stations, and Party Zone.
- Resources can be shared or exclusive. Shared resources allow overlapping bookings until capacity is reached; exclusive resources block overlapping bookings once reserved.
- Availability rules define weekly bookable windows by resource and experience.
- Rules include active days, start time, end time, slot interval, and minimum notice.
- Experiences keep their own duration, buffer time, minimum guests, and maximum guests.
- Blackouts block resource time for holidays, maintenance, staffing gaps, private holds, or special events.
- Slot generation combines rules, resource capacity, existing bookings, active holds, buffers, minimum notice, and blackouts.

## Analytics & Conversion

- Track booking funnel steps.
- Track abandoned booking flow.
- Track conversion by experience.
- Track add-on attach rate.
- Track discount code usage, campaign source, conversion lift, and margin impact.
- Track gift card sales, redemption rate, outstanding liability, and breakage.
- Track traffic source if marketing campaigns are used.
- Test hero messaging and CTA placement.
- Backlog: gamified "spin wheel" selector to help undecided visitors choose an offering, collect preference/occasion analytics, and optionally reveal a controlled promo.

## Near-Term Build Phases

### Phase 1: Public Booking MVP

- Polish current landing and booking flow.
- Move bookings to Postgres.
- Add transaction-safe availability.
- Deploy to Railway or Render.
- Add basic admin login.
- Add confirmation emails.

### Phase 2: Payments & Operations

- Add Stripe or Square deposits.
- Add employee day view.
- Add booking status workflow.
- Add reschedule/cancel tools.
- Add pickup/drying status.

### Phase 3: Admin Configuration

- Manage experiences, pricing, add-ons, and availability from admin UI.
- Manage page media and copy.
- Add blocked dates and private event holds.
- Add reporting dashboard.

### Phase 4: CRM & Growth

- Customer profiles.
- Visit history.
- Tags and occasions.
- Private event inquiry pipeline.
- Follow-up reminders and marketing exports.

## Open Decisions

- Railway vs Render for production hosting.
- Stripe vs Square for payments.
- Email provider: Resend, Postmark, SendGrid, or existing business email platform.
- SMS provider if reminders are needed.
- Whether private events should be instant-bookable, inquiry-only, or both.
- Whether staff needs mobile-only views, desktop views, or both.
- How much media/content should be editable by admins without code changes.
