require("dotenv/config");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readStore, writeStore, USE_DATABASE } = require("./lib/storeRepository");
const {
  authenticate,
  canBootstrap,
  createSession,
  createStaffUser,
  destroySession,
  getSessionUser,
  hasRole,
  publicStaffUser,
  staffCount
} = require("./lib/auth");
const {
  createSquareCardPayment,
  createSquarePaymentLink,
  isSquareConfigured,
  isSquareEmbeddedConfigured
} = require("./lib/squarePayments");

const PORT = Number(process.env.PORT || 4280);
const PUBLIC_DIR = path.join(__dirname, "public");
const HOLD_MINUTES = 12;
const DRIP_API_BASE = "https://api.getdrip.com/v2";
const DRIP_API_TOKEN = process.env.DRIP_API_TOKEN || "";
const DRIP_ACCOUNT_ID = process.env.DRIP_ACCOUNT_ID || "";
const DRIP_USER_AGENT = process.env.DRIP_USER_AGENT || "Spin Art Raleigh Booking (local)";
const DRIP_BOOKING_TAG = process.env.DRIP_BOOKING_TAG || "Spin Art Booking";
const DRIP_SYNC_ENABLED = Boolean(DRIP_API_TOKEN && DRIP_ACCOUNT_ID);
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "mock";
const SQUARE_APP_ID = process.env.SQUARE_APP_ID || "";
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || "";
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || "";
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox";
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
const DEFAULT_TAX_RATE_BPS = 725;
const APPOINTMENT_MINUTES = 60;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4"
};

const ADMIN_API_PATHS = [
  "/api/admin",
  "/api/admin/media",
  "/api/admin/gift-cards",
  "/api/admin/gift-cards/import",
  "/api/config"
];

const EMPLOYEE_API_PATHS = [
  "/api/employee/day",
  "/api/employee/bookings"
];

const uploadTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function pathMatches(pathname, protectedPath) {
  return pathname === protectedPath || pathname.startsWith(`${protectedPath}/`);
}

function protectedApiRoles(req, url) {
  if (url.pathname.startsWith("/api/auth")) return null;
  if (ADMIN_API_PATHS.some(pathname => pathMatches(url.pathname, pathname))) {
    if (req.method === "GET" && url.pathname === "/api/config") return null;
    return ["owner", "admin"];
  }
  if (EMPLOYEE_API_PATHS.some(pathname => pathMatches(url.pathname, pathname))) return ["owner", "admin", "employee"];
  if (url.pathname.startsWith("/api/bookings/") && req.method === "PATCH") return ["owner", "admin", "employee"];
  return null;
}

function redirectTargetForRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (["owner", "admin"].includes(normalized)) return "/admin.html";
  return "/employee.html";
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}

async function dripRequest(pathname, body, expectedStatuses = [200, 201, 204]) {
  if (!DRIP_SYNC_ENABLED) {
    return { skipped: true, reason: "Drip credentials are not configured." };
  }

  const response = await fetch(`${DRIP_API_BASE}/${encodeURIComponent(DRIP_ACCOUNT_ID)}${pathname}`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${DRIP_API_TOKEN}:`).toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": DRIP_USER_AGENT
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!expectedStatuses.includes(response.status)) {
    const message = payload.message || payload.error || `Drip request failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function buildDripSubscriber(customer, context = {}) {
  const { firstName, lastName } = splitName(customer.name);
  return compactObject({
    email: String(customer.email || "").trim().toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    phone: String(customer.phone || "").trim(),
    tags: [DRIP_BOOKING_TAG],
    custom_fields: compactObject({
      source: context.source || "booking_app",
      booking_id: context.bookingId,
      experience: context.experienceName,
      booking_status: context.status,
      starts_at: context.startsAt,
      guest_count: context.guestCount,
      total_cents: context.totalCents,
      occasion: context.occasion,
      project: context.projectName,
      notes: context.notes
    })
  });
}

async function syncCustomerToDrip(customer, context = {}) {
  const email = String(customer.email || "").trim();
  if (!email) throw new Error("Customer email is required for Drip sync.");

  const subscriber = buildDripSubscriber(customer, context);
  const result = await dripRequest("/subscribers", { subscribers: [subscriber] });
  if (result.skipped) return result;

  const eventProperties = compactObject({
    booking_id: context.bookingId,
    experience: context.experienceName,
    status: context.status,
    starts_at: context.startsAt,
    guest_count: context.guestCount,
    total_cents: context.totalCents,
    value: context.totalCents,
    occasion: context.occasion,
    project: context.projectName,
    source: context.source || "booking_app"
  });

  await dripRequest("/events", {
    events: [{
      email: subscriber.email,
      action: context.eventAction || "Created a booking",
      properties: eventProperties,
      occurred_at: context.occurredAt || new Date().toISOString()
    }]
  }, [204]);

  return { synced: true };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 30_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function slugify(value) {
  return String(value || "media")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "media";
}

function saveUploadedMedia(store, payload) {
  const title = String(payload.title || "Uploaded media").trim();
  const placement = String(payload.placement || "gallery").trim();
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Upload a valid media file.");

  const mimeType = match[1].toLowerCase();
  const extension = uploadTypes[mimeType];
  if (!extension) throw new Error("Supported uploads: JPG, PNG, WebP, GIF, MP4, and MOV.");

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("Upload file is empty.");
  if (bytes.length > 18_000_000) throw new Error("Upload media must be 18 MB or smaller.");

  const uploadsDir = path.join(PUBLIC_DIR, "assets", "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `${Date.now()}-${slugify(title)}${extension}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, bytes);

  const type = mimeType.startsWith("video/") ? "video" : "image";
  const media = {
    id: `upload-${Date.now()}`,
    type,
    title,
    url: `/assets/uploads/${filename}`,
    source: "admin-upload",
    uploadedAt: new Date().toISOString()
  };

  store.site = store.site || {};
  store.site.hero = store.site.hero || {};
  store.site.media = Array.isArray(store.site.media) ? store.site.media : [];

  if (placement === "hero-image") {
    if (type !== "image") throw new Error("Hero image must be an image file.");
    store.site.hero.imageUrl = media.url;
  } else if (placement === "hero-video") {
    if (type !== "video") throw new Error("Hero video must be a video file.");
    store.site.hero.videoUrl = media.url;
  } else if (placement === "logo") {
    if (type !== "image") throw new Error("Logo must be an image file.");
    store.site.hero.logoUrl = media.url;
  } else {
    store.site.media.unshift(media);
  }

  return media;
}

function publicStore(store) {
  const schedule = store.schedule || { availabilityRules: [], blackouts: [] };
  return {
    business: store.business,
    settings: {
      currency: store.settings?.currency || "USD",
      taxRateBps: Number(store.settings?.taxRateBps || DEFAULT_TAX_RATE_BPS),
      taxLabel: store.settings?.taxLabel || "Wake County sales tax",
      paymentProvider: PAYMENT_PROVIDER,
      square: {
        appId: SQUARE_APP_ID,
        locationId: SQUARE_LOCATION_ID,
        isConfigured: isSquareConfigured(),
        isEmbeddedConfigured: isSquareEmbeddedConfigured(),
        environment: SQUARE_ENVIRONMENT
      }
    },
    site: store.site,
    resources: store.resources,
    schedule: {
      minNoticeMinutes: Number(schedule.minNoticeMinutes ?? 60),
      availabilityRules: schedule.availabilityRules || [],
      blackouts: schedule.blackouts || []
    },
    experiences: store.experiences
      .filter(experience => experience.isPublic)
      .map(experience => ({
        ...experience,
        durationMinutes: APPOINTMENT_MINUTES,
        bufferMinutes: 0
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    addOns: store.addOns,
    policies: store.policies
  };
}

function startOfDay(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}:00`);
}

function minutesFromTime(timeString) {
  const [hours, minutes] = String(timeString || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function bookingEndsAt(startsAt) {
  return addMinutes(startsAt, APPOINTMENT_MINUTES);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function activeHolds(store) {
  const now = Date.now();
  return store.holds.filter(hold => new Date(hold.expiresAt).getTime() > now);
}

async function cleanupHolds(store) {
  const active = activeHolds(store);
  if (active.length !== store.holds.length) {
    store.holds = active;
    await writeStore(store);
  }
}

function bookedCapacityForSlot(store, experience, startsAt, endsAt, ignoreHoldId = null) {
  const resource = getResource(store, experience.resourceId);
  const activeStatuses = new Set(["pending_payment", "paid", "confirmed", "checked_in"]);
  const relevantBookings = store.bookings.filter(booking => (
    booking.resourceId === experience.resourceId &&
    activeStatuses.has(booking.status) &&
    rangesOverlap(new Date(booking.startsAt), new Date(booking.endsAt), startsAt, endsAt)
  ));

  const relevantHolds = activeHolds(store).filter(hold => (
    hold.id !== ignoreHoldId &&
    hold.resourceId === experience.resourceId &&
    rangesOverlap(new Date(hold.startsAt), new Date(hold.endsAt), startsAt, endsAt)
  ));

  if (resource?.capacityMode === "bookings") {
    return [...relevantBookings, ...relevantHolds].reduce((sum, item) => (
      sum + capacityUnitsForBooking(resource, item.guestCount, item.experienceId)
    ), 0);
  }

  if (resource?.isExclusive && (relevantBookings.length || relevantHolds.length)) {
    return resource.capacity;
  }

  return [...relevantBookings, ...relevantHolds].reduce((sum, item) => {
    const bookedExperience = getExperience(store, item.experienceId);
    return sum + capacityConsumedByBooking(resource, bookedExperience, item.guestCount);
  }, 0);
}

function bookedCapacityForResource(store, resource, startsAt, endsAt) {
  const activeStatuses = new Set(["pending_payment", "paid", "confirmed", "checked_in"]);
  const relevantBookings = store.bookings.filter(booking => (
    booking.resourceId === resource.id &&
    activeStatuses.has(booking.status) &&
    rangesOverlap(new Date(booking.startsAt), new Date(booking.endsAt), startsAt, endsAt)
  ));

  if (resource.capacityMode === "bookings") {
    return relevantBookings.reduce((sum, booking) => (
      sum + capacityUnitsForBooking(resource, booking.guestCount, booking.experienceId)
    ), 0);
  }
  if (resource.isExclusive && relevantBookings.length) return resource.capacity;
  return relevantBookings.reduce((sum, booking) => {
    const experience = getExperience(store, booking.experienceId);
    return sum + capacityConsumedByBooking(resource, experience, booking.guestCount);
  }, 0);
}

function capacityUnitsForBooking(resource, guestCount) {
  const unitGuestCapacity = Number(resource?.unitGuestCapacity || 0);
  if (unitGuestCapacity > 0) {
    return Math.max(1, Math.ceil(Number(guestCount || 0) / unitGuestCapacity));
  }
  return 1;
}

function capacityConsumedByBooking(resource, experience, guestCount) {
  const guests = Number(guestCount || 0);
  if (experience?.privateThresholdGuests && guests >= Number(experience.privateThresholdGuests)) {
    return Number(resource.capacity || guests);
  }
  if (resource?.capacityMode === "bookings") return capacityUnitsForBooking(resource, guests, experience?.id);
  return guests;
}

function requiredCapacityForBooking(resource, experience, guestCount) {
  return capacityConsumedByBooking(resource, experience, guestCount);
}

function billableGuestCount(resource, experience, guestCount) {
  const guests = Number(guestCount || 0);
  if (experience?.minimumBillableGuestsPerResourceUnit && resource?.unitGuestCapacity) {
    return Math.max(
      guests,
      capacityUnitsForBooking(resource, guests, experience.id) * Number(experience.minimumBillableGuestsPerResourceUnit)
    );
  }
  return guests;
}

function getResource(store, resourceId) {
  return store.resources.find(resource => resource.id === resourceId);
}

function getExperience(store, experienceId) {
  return store.experiences.find(experience => experience.id === experienceId);
}

function buildSlots(store, experienceId, dateString, options = {}) {
  const experience = getExperience(store, experienceId);
  const day = startOfDay(dateString);
  if (!experience || !day) return [];

  const resource = getResource(store, experience.resourceId);
  if (!resource) return [];
  const dayIndex = day.getDay();
  const schedule = store.schedule || { availabilityRules: [], blackouts: [] };
  const globalMinNotice = Number(schedule.minNoticeMinutes ?? 60);
  const rules = (schedule.availabilityRules || []).filter(rule => (
    rule.isActive !== false &&
    rule.resourceId === experience.resourceId &&
    (rule.experienceIds || []).includes(experience.id) &&
    (rule.daysOfWeek || []).includes(dayIndex)
  ));

  const blackoutRanges = (schedule.blackouts || []).filter(blackout => (
    blackout.resourceId === experience.resourceId &&
    (!blackout.experienceIds || !blackout.experienceIds.length || blackout.experienceIds.includes(experience.id)) &&
    blackout.date === dateString
  )).map(blackout => ({
    startsAt: toDateTime(dateString, blackout.startTime || "00:00"),
    endsAt: toDateTime(dateString, blackout.endTime || "23:59")
  }));

  const slots = [];
  for (const rule of rules) {
    const interval = Number(rule.slotIntervalMinutes || 30);
    const minNotice = globalMinNotice;
    const startMinute = minutesFromTime(rule.startTime);
    const endMinute = minutesFromTime(rule.endTime);
    for (let minute = startMinute; minute + APPOINTMENT_MINUTES <= endMinute; minute += interval) {
      const time = timeFromMinutes(minute);
      const startsAt = toDateTime(dateString, time);
      const endsAt = bookingEndsAt(startsAt);
      if (!options.ignoreMinNotice && startsAt.getTime() - Date.now() < minNotice * 60_000) continue;
      const isBlackout = blackoutRanges.some(range => rangesOverlap(startsAt, endsAt, range.startsAt, range.endsAt));
      const booked = bookedCapacityForSlot(store, experience, startsAt, endsAt);
      const remaining = isBlackout ? 0 : Math.max(0, resource.capacity - booked);
      const isBookable = remaining >= requiredCapacityForBooking(resource, experience, experience.minGuests);
      slots.push({
        time,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        remaining,
        resourceId: resource.id,
        ruleId: rule.id,
        isAvailable: !isBlackout && isBookable
      });
    }
  }

  return Object.values(slots.reduce((unique, slot) => {
    const existing = unique[slot.time];
    if (!existing || slot.remaining > existing.remaining) unique[slot.time] = slot;
    return unique;
  }, {})).sort((a, b) => a.time.localeCompare(b.time));
}

function money(cents) {
  return Math.round(Number(cents || 0));
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(money(cents) / 100);
}

function normalizeDiscountCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeGiftCardCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function publicDiscount(discount) {
  if (!discount) return null;
  return {
    id: discount.id,
    code: discount.code,
    name: discount.name,
    type: discount.type,
    valuePercent: discount.valuePercent || 0,
    valueCents: discount.valueCents || 0,
    discountCents: discount.discountCents || 0
  };
}

function discountAmountForSubtotal(discount, subtotalCents) {
  if (!discount) return 0;
  const subtotal = money(subtotalCents);
  if (discount.type === "percent") {
    return Math.min(subtotal, Math.round(subtotal * Number(discount.valuePercent || 0) / 100));
  }
  return Math.min(subtotal, money(discount.valueCents));
}

function validateDiscount(store, code, experience, subtotalCents) {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) return { discount: null };

  const discount = store.discounts.find(item => normalizeDiscountCode(item.code) === normalizedCode);
  if (!discount || discount.isActive === false) return { error: "Discount code is not valid." };

  const now = Date.now();
  if (discount.startsAt && new Date(discount.startsAt).getTime() > now) {
    return { error: "Discount code is not active yet." };
  }
  if (discount.expiresAt && new Date(discount.expiresAt).getTime() < now) {
    return { error: "Discount code has expired." };
  }
  if (Array.isArray(discount.experienceIds) && discount.experienceIds.length && !discount.experienceIds.includes(experience.id)) {
    return { error: "Discount code is not available for this experience." };
  }
  if (Number(discount.minimumSubtotalCents || 0) > money(subtotalCents)) {
    return { error: `Discount requires at least ${formatMoney(discount.minimumSubtotalCents)} before tax.` };
  }
  if (discount.maxRedemptions && Number(discount.usedCount || 0) >= Number(discount.maxRedemptions)) {
    return { error: "Discount code has reached its usage limit." };
  }

  const discountCents = discountAmountForSubtotal(discount, subtotalCents);
  if (discountCents <= 0) return { error: "Discount code does not apply to this order." };
  return { discount: { ...discount, code: normalizedCode, discountCents } };
}

function publicGiftCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    code: card.code,
    holderName: card.holderName || "",
    holderEmail: card.holderEmail || "",
    originalBalanceCents: money(card.originalBalanceCents),
    balanceCents: money(card.balanceCents),
    status: card.status || "active",
    expiresAt: card.expiresAt || "",
    note: card.note || "",
    createdAt: card.createdAt || "",
    transactions: Array.isArray(card.transactions) ? card.transactions : []
  };
}

function validateGiftCard(store, code, amountCents = 0) {
  const normalizedCode = normalizeGiftCardCode(code);
  if (!normalizedCode) return { giftCard: null, giftCardCents: 0 };

  const giftCard = store.giftCards.find(item => normalizeGiftCardCode(item.code) === normalizedCode);
  if (!giftCard || giftCard.status === "void") return { error: "Gift card is not valid." };
  if (giftCard.status === "inactive") return { error: "Gift card is not active yet." };
  if (giftCard.expiresAt && new Date(giftCard.expiresAt).getTime() < Date.now()) {
    return { error: "Gift card has expired." };
  }

  const balanceCents = money(giftCard.balanceCents);
  if (balanceCents <= 0) return { error: "Gift card has no remaining balance." };

  return {
    giftCard,
    giftCardCents: Math.min(balanceCents, Math.max(0, money(amountCents)))
  };
}

function recordGiftCardRedemption(store, booking, giftCard, amountCents, source = "booking") {
  const amount = Math.min(money(amountCents), money(giftCard.balanceCents));
  if (!giftCard || amount <= 0) return null;

  const now = new Date().toISOString();
  giftCard.balanceCents = Math.max(0, money(giftCard.balanceCents) - amount);
  giftCard.status = giftCard.balanceCents > 0 ? (giftCard.status || "active") : "redeemed";
  giftCard.transactions = Array.isArray(giftCard.transactions) ? giftCard.transactions : [];
  giftCard.transactions.push({
    id: crypto.randomUUID(),
    type: "redemption",
    amountCents: -amount,
    bookingId: booking.id,
    source,
    createdAt: now
  });

  const payment = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    provider: "gift_card",
    status: "paid",
    currency: store.settings?.currency || "USD",
    paymentMode: "gift_card",
    amountCents: amount,
    subtotalCents: amount,
    taxCents: 0,
    providerPaymentId: giftCard.code,
    checkoutUrl: null,
    squareLocationId: null,
    createdAt: now,
    updatedAt: now,
    paidAt: now
  };

  store.payments.push(payment);
  booking.paymentIds = Array.isArray(booking.paymentIds) ? booking.paymentIds : [];
  booking.paymentIds.push(payment.id);
  booking.giftCard = {
    id: giftCard.id,
    code: giftCard.code,
    amountCents: amount
  };
  booking.giftCardCents = amount;
  if (source !== "public_booking") {
    booking.balanceCents = Math.max(0, money(booking.balanceCents) - amount);
  }
  return payment;
}

function refundGiftCardForBooking(store, booking, reason = "payment_failed") {
  if (!booking?.giftCard?.id || !booking.giftCardCents) return;
  const giftCard = store.giftCards.find(item => item.id === booking.giftCard.id);
  if (!giftCard) return;
  const amount = money(booking.giftCardCents);
  const now = new Date().toISOString();
  giftCard.balanceCents = money(giftCard.balanceCents) + amount;
  giftCard.status = "active";
  giftCard.transactions = Array.isArray(giftCard.transactions) ? giftCard.transactions : [];
  giftCard.transactions.push({
    id: crypto.randomUUID(),
    type: "refund",
    amountCents: amount,
    bookingId: booking.id,
    source: reason,
    createdAt: now
  });
  booking.giftCardRefundedAt = now;
}

function giftCardFromPayload(payload, source = "admin") {
  const now = new Date().toISOString();
  const code = normalizeGiftCardCode(payload.code || crypto.randomBytes(4).toString("hex"));
  const balanceCents = money(Number(payload.balanceCents ?? Math.round(Number(payload.balance || 0) * 100)));
  if (!code) throw new Error("Gift card code is required.");
  if (balanceCents <= 0) throw new Error("Gift card balance must be greater than $0.");

  return {
    id: crypto.randomUUID(),
    code,
    holderName: String(payload.holderName || "").trim(),
    holderEmail: String(payload.holderEmail || "").trim(),
    holderPhone: String(payload.holderPhone || "").trim(),
    originalBalanceCents: money(Number(payload.originalBalanceCents ?? balanceCents)),
    balanceCents,
    status: payload.status || "active",
    expiresAt: payload.expiresAt || "",
    note: String(payload.note || "").trim(),
    source,
    createdAt: now,
    updatedAt: now,
    transactions: [{
      id: crypto.randomUUID(),
      type: source === "migration" ? "migration" : "issue",
      amountCents: balanceCents,
      note: String(payload.note || "").trim(),
      createdAt: now
    }]
  };
}

function parseGiftCardCsv(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [code, balance, holderName = "", holderEmail = "", holderPhone = "", note = ""] = line.split(",").map(item => item.trim());
      return { code, balance: Number(balance || 0), holderName, holderEmail, holderPhone, note };
    });
}

function calculateTotal(store, experience, guestCount, selectedAddOnIds = [], projectId = "", addOnItems = []) {
  const resource = getResource(store, experience.resourceId);
  const billableGuests = billableGuestCount(resource, experience, guestCount);
  const capacityUnits = capacityUnitsForBooking(resource, guestCount, experience.id);
  const addOnLineTotal = addOnItems.reduce((sum, item) => {
    const addOn = store.addOns.find(addOnItem => addOnItem.id === item.id);
    return sum + (addOn ? money(addOn.priceCents) * Math.max(0, Number(item.quantity || 0)) : 0);
  }, 0);
  const checkedAddOnTotal = selectedAddOnIds.reduce((sum, addOnId) => {
    const addOn = store.addOns.find(item => item.id === addOnId);
    return sum + (addOn ? money(addOn.priceCents) : 0);
  }, 0) * guestCount;
  const addOnTotal = addOnItems.length ? addOnLineTotal : checkedAddOnTotal;

  const project = (experience.projectOptions || []).find(item => item.id === projectId);
  const projectTotal = project ? money(project.priceCents) : 0;
  const projectMultiplier = project?.pricingScope === "per_station" ? capacityUnits : guestCount;
  const base = experience.pricingType === "per_guest"
    ? money(experience.basePriceCents) * billableGuests
    : money(experience.basePriceCents);

  return base + (projectTotal * projectMultiplier) + addOnTotal;
}

function calculateTax(store, subtotalCents) {
  const rate = Number(store.settings?.taxRateBps || DEFAULT_TAX_RATE_BPS);
  return Math.round(money(subtotalCents) * rate / 10_000);
}

function pricingBreakdown(store, experience, guestCount, selectedAddOnIds = [], projectId = "", paymentMode = "reservation_fee", addOnItems = [], discount = null, giftCard = null) {
  const subtotalCents = calculateTotal(store, experience, guestCount, selectedAddOnIds, projectId, addOnItems);
  const discountCents = discountAmountForSubtotal(discount, subtotalCents);
  const discountedSubtotalCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = calculateTax(store, discountedSubtotalCents);
  const totalCents = discountedSubtotalCents + taxCents;
  const resource = getResource(store, experience.resourceId);
  const billableGuests = billableGuestCount(resource, experience, guestCount);
  const reservationFeeSubtotalCents = experience.pricingType === "per_guest"
    ? money(experience.depositCents) * billableGuests
    : money(experience.depositCents);
  const amountDueNowSubtotalCents = paymentMode === "pay_full"
    ? discountedSubtotalCents
    : Math.min(reservationFeeSubtotalCents, discountedSubtotalCents);
  const amountDueNowTaxCents = calculateTax(store, amountDueNowSubtotalCents);
  const amountDueNowCents = amountDueNowSubtotalCents + amountDueNowTaxCents;
  const giftCardCents = giftCard ? Math.min(money(giftCard.balanceCents), amountDueNowCents) : 0;
  const paymentDueCents = Math.max(0, amountDueNowCents - giftCardCents);

  return {
    subtotalCents,
    discountCents,
    discountedSubtotalCents,
    taxCents,
    totalCents,
    reservationFeeSubtotalCents,
    amountDueNowSubtotalCents,
    amountDueNowTaxCents,
    amountDueNowCents,
    giftCardCents,
    paymentDueCents,
    balanceCents: Math.max(0, totalCents - amountDueNowCents)
  };
}

function publicPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    provider: payment.provider,
    status: payment.status,
    amountCents: payment.amountCents,
    subtotalCents: payment.subtotalCents,
    taxCents: payment.taxCents,
    currency: payment.currency,
    checkoutUrl: payment.checkoutUrl || null,
    checkoutMode: payment.checkoutMode || null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt || null
  };
}

async function createCheckoutPayment(store, booking, breakdown, req) {
  const now = new Date().toISOString();
  const provider = PAYMENT_PROVIDER === "square" && isSquareConfigured() ? "square" : "mock";
  const payment = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    provider,
    status: "pending",
    currency: store.settings?.currency || "USD",
    paymentMode: booking.paymentMode,
    amountCents: breakdown.paymentDueCents ?? breakdown.amountDueNowCents,
    subtotalCents: breakdown.amountDueNowSubtotalCents,
    taxCents: breakdown.amountDueNowTaxCents,
    providerPaymentId: null,
    checkoutUrl: provider === "mock" ? null : null,
    checkoutMode: provider === "square" && isSquareEmbeddedConfigured() ? "embedded" : provider === "square" ? "hosted" : "mock",
    squareLocationId: provider === "square" ? SQUARE_LOCATION_ID : null,
    createdAt: now,
    updatedAt: now
  };

  if (provider === "square") {
    const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
    await createSquarePaymentLink({ payment, booking, business: store.business, origin });
  }

  return payment;
}

function recordExternalPayment(store, booking, source = "employee_pos", amountOverrideCents = null) {
  const amountCents = Math.max(0, amountOverrideCents === null
    ? Number(booking.balanceCents || booking.totalCents || 0)
    : Number(amountOverrideCents || 0));
  const now = new Date().toISOString();
  const payment = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    provider: "external_pos",
    status: "paid",
    currency: store.settings?.currency || "USD",
    paymentMode: "external_pos",
    amountCents,
    subtotalCents: amountCents,
    taxCents: 0,
    providerPaymentId: `${source}_${crypto.randomUUID()}`,
    checkoutUrl: null,
    squareLocationId: null,
    createdAt: now,
    updatedAt: now,
    paidAt: now
  };

  store.payments.push(payment);
  booking.paymentIds = Array.isArray(booking.paymentIds) ? booking.paymentIds : [];
  booking.paymentIds.push(payment.id);
  booking.amountDueNowCents = Math.max(Number(booking.amountDueNowCents || 0), amountCents);
  booking.balanceCents = Math.max(0, Number(booking.balanceCents || 0) - amountCents);
  booking.paymentStatus = "paid";
  booking.status = ["pending_payment", "confirmed"].includes(booking.status) ? "paid" : booking.status;
  booking.paidAt = booking.paidAt || now;
  return payment;
}

function usesGroupWaiver(experience) {
  return ["group-events", "private-events"].includes(experience.id);
}

function validateBookingPayload(store, payload) {
  const experience = getExperience(store, payload.experienceId);
  if (!experience || !experience.isPublic) return "Choose a valid experience.";
  if (!payload.date || !payload.time) return "Choose a date and time.";

  const guestCount = Number(payload.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < experience.minGuests || guestCount > experience.maxGuests) {
    return `Guest count must be between ${experience.minGuests} and ${experience.maxGuests}.`;
  }

  if (!payload.customer || !payload.customer.name || !payload.customer.email) {
    return "Customer name and email are required.";
  }

  if (!payload.waiverAccepted) {
    return "Please accept the waiver requirement before reserving.";
  }

  if (!usesGroupWaiver(experience)) {
    const waiver = payload.waiver || {};
    const participants = Array.isArray(waiver.participants) ? waiver.participants : [];
    if (!waiver.signerName || !waiver.signature || !waiver.riskAccepted) {
      return "Complete the waiver acknowledgement before reserving.";
    }
    if (participants.length !== guestCount) {
      return "Add a participant name for each guest before reserving.";
    }
    for (const participant of participants) {
      if (!participant.name) return "Add each participant name before reserving.";
      if (participant.participantType === "minor" && !participant.guardianName) {
        return "Parent or guardian name is required for each minor.";
      }
    }
  }

  const projectOptions = experience.projectOptions || [];
  if (projectOptions.length) {
    const selectedProjectId = payload.projectId || projectOptions[0].id;
    if (!projectOptions.some(project => project.id === selectedProjectId)) {
      return "Choose a valid project option.";
    }
  }

  const allowedAddOns = new Set(experience.addOnIds);
  const selected = Array.isArray(payload.addOnIds) ? payload.addOnIds : [];
  if (selected.some(addOnId => !allowedAddOns.has(addOnId))) {
    return "One or more add-ons are not available for this experience.";
  }

  const slot = buildSlots(store, experience.id, payload.date).find(item => item.time === payload.time);
  const resource = getResource(store, experience.resourceId);
  const requiredCapacity = requiredCapacityForBooking(resource, experience, guestCount);
  const hasEnoughCapacity = slot?.remaining >= requiredCapacity;
  if (!slot || !slot.isAvailable || !hasEnoughCapacity) {
    return "That time is no longer available for the selected group size.";
  }

  return null;
}

function validateEmployeeBookingPayload(store, payload) {
  const experience = getExperience(store, payload.experienceId);
  if (!experience || !experience.isPublic) return "Choose a valid experience.";
  if (!payload.date || !payload.time) return "Choose a date and time.";

  const guestCount = Number(payload.guestCount);
  if (!Number.isInteger(guestCount) || guestCount < experience.minGuests || guestCount > experience.maxGuests) {
    return `Guest count must be between ${experience.minGuests} and ${experience.maxGuests}.`;
  }

  if (!payload.customer || !String(payload.customer.name || "").trim()) {
    return "Customer name is required.";
  }

  if (!["reservation_fee", "pay_full", "walk_in_end"].includes(payload.paymentChoice)) {
    return "Choose reservation fee, full balance, or walk-in pay at end before scheduling.";
  }

  const allowedAddOns = new Set(experience.addOnIds || []);
  const addOnItems = Array.isArray(payload.addOnItems) ? payload.addOnItems : [];
  for (const item of addOnItems) {
    const quantity = Number(item.quantity || 0);
    if (!allowedAddOns.has(item.id) || !Number.isInteger(quantity) || quantity < 0) {
      return "Choose valid add-ons and quantities for this experience.";
    }
  }

  const slot = buildSlots(store, experience.id, payload.date, { ignoreMinNotice: true }).find(item => item.time === payload.time);
  const resource = getResource(store, experience.resourceId);
  const requiredCapacity = requiredCapacityForBooking(resource, experience, guestCount);
  const hasEnoughCapacity = slot?.remaining >= requiredCapacity;
  if (!slot || !slot.isAvailable || !hasEnoughCapacity) {
    return "That time is no longer available for the selected group size.";
  }

  return null;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const user = USE_DATABASE ? await getSessionUser(req) : null;
    const count = USE_DATABASE ? await staffCount() : 0;
    return sendJson(res, 200, {
      user,
      needsBootstrap: USE_DATABASE && count === 0
    });
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!USE_DATABASE) {
      return sendJson(res, 503, { error: "Staff login requires DATABASE_URL." });
    }
    const payload = await parseBody(req);
    const user = await authenticate(payload.email, payload.password);
    if (!user) return sendJson(res, 401, { error: "Invalid email or password." });
    await createSession(res, user);
    return sendJson(res, 200, { user: publicStaffUser(user), redirectTo: redirectTargetForRole(user.role) });
  }

  if (url.pathname === "/api/auth/bootstrap" && req.method === "POST") {
    if (!USE_DATABASE) {
      return sendJson(res, 503, { error: "Staff login requires DATABASE_URL." });
    }
    const payload = await parseBody(req);
    if (await staffCount()) return sendJson(res, 409, { error: "Staff account already exists." });
    if (!canBootstrap(req, payload)) return sendJson(res, 403, { error: "Bootstrap is not enabled." });
    if (!payload.email || !payload.password || String(payload.password).length < 10) {
      return sendJson(res, 400, { error: "Create an owner account with an email and a password of at least 10 characters." });
    }
    const user = await createStaffUser({
      name: payload.name || "Owner",
      email: payload.email,
      password: payload.password,
      role: "OWNER"
    });
    await createSession(res, user);
    return sendJson(res, 201, { user: publicStaffUser(user), redirectTo: "/admin.html" });
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    if (USE_DATABASE) await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  const requiredRoles = protectedApiRoles(req, url);
  if (requiredRoles) {
    const user = USE_DATABASE ? await getSessionUser(req) : null;
    if (!hasRole(user, requiredRoles)) {
      return sendJson(res, user ? 403 : 401, { error: user ? "You do not have access to this area." : "Please sign in." });
    }
  }

  const store = await readStore();
  await cleanupHolds(store);

  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, publicStore(store));
  }

  if (req.method === "GET" && url.pathname === "/api/admin") {
    return sendJson(res, 200, {
      ...publicStore(store),
      bookings: store.bookings.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
      payments: store.payments,
      discounts: store.discounts,
      giftCards: store.giftCards.map(publicGiftCard).sort((a, b) => a.code.localeCompare(b.code)),
      holds: activeHolds(store)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/media") {
    try {
      const payload = await parseBody(req);
      const media = saveUploadedMedia(store, payload);
      await writeStore(store);
      return sendJson(res, 201, { media, config: publicStore(store) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/gift-cards") {
    try {
      const payload = await parseBody(req);
      const giftCard = giftCardFromPayload(payload, "admin");
      if (store.giftCards.some(item => normalizeGiftCardCode(item.code) === giftCard.code)) {
        return sendJson(res, 400, { error: "Gift card code already exists." });
      }
      store.giftCards.push(giftCard);
      await writeStore(store);
      return sendJson(res, 201, { giftCard: publicGiftCard(giftCard) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/gift-cards/import") {
    try {
      const payload = await parseBody(req);
      const rows = Array.isArray(payload.cards) ? payload.cards : parseGiftCardCsv(payload.csv);
      const existingCodes = new Set(store.giftCards.map(item => normalizeGiftCardCode(item.code)));
      const created = [];
      const skipped = [];
      rows.forEach((row, index) => {
        try {
          const giftCard = giftCardFromPayload(row, "migration");
          if (existingCodes.has(giftCard.code)) {
            skipped.push({ row: index + 1, code: giftCard.code, reason: "Duplicate code" });
            return;
          }
          existingCodes.add(giftCard.code);
          store.giftCards.push(giftCard);
          created.push(publicGiftCard(giftCard));
        } catch (error) {
          skipped.push({ row: index + 1, code: row.code || "", reason: error.message });
        }
      });
      await writeStore(store);
      return sendJson(res, 201, { created, skipped });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/gift-cards/preview") {
    const payload = await parseBody(req);
    const result = validateGiftCard(store, payload.code, payload.amountCents);
    if (result.error) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, {
      giftCard: publicGiftCard(result.giftCard),
      giftCardCents: result.giftCardCents
    });
  }

  if (req.method === "POST" && url.pathname === "/api/discounts/preview") {
    const payload = await parseBody(req);
    const experience = getExperience(store, payload.experienceId);
    if (!experience || !experience.isPublic) return sendJson(res, 400, { error: "Choose a valid experience." });
    const guestCount = Number(payload.guestCount || experience.minGuests);
    const addOnIds = Array.isArray(payload.addOnIds) ? payload.addOnIds : [];
    const addOnItems = Array.isArray(payload.addOnItems) ? payload.addOnItems : [];
    const projectOptions = experience.projectOptions || [];
    const projectId = String(payload.projectId || projectOptions[0]?.id || "").trim();
    const paymentMode = payload.paymentMode === "pay_full" ? "pay_full" : "reservation_fee";
    const subtotalCents = calculateTotal(store, experience, guestCount, addOnIds, projectId, addOnItems);
    const { discount, error } = validateDiscount(store, payload.discountCode, experience, subtotalCents);
    if (error) return sendJson(res, 400, { error });
    const breakdown = pricingBreakdown(store, experience, guestCount, addOnIds, projectId, paymentMode, addOnItems, discount);
    return sendJson(res, 200, { breakdown, discount: publicDiscount(discount) });
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    const experienceId = url.searchParams.get("experienceId");
    const date = url.searchParams.get("date");
    const ignoreMinNotice = url.searchParams.get("staff") === "1";
    return sendJson(res, 200, { slots: buildSlots(store, experienceId, date, { ignoreMinNotice }) });
  }

  if (req.method === "GET" && url.pathname === "/api/employee/day") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const schedule = store.schedule || { availabilityRules: [], blackouts: [] };
    const resources = store.resources
      .filter(resource => resource.isEmployeeVisible !== false)
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
    const startMinutes = Math.min(...(schedule.availabilityRules || []).map(rule => minutesFromTime(rule.startTime)), 10 * 60);
    const endMinutes = Math.max(...(schedule.availabilityRules || []).map(rule => minutesFromTime(rule.endTime)), 22 * 60);
    const rows = [];

    for (let minute = startMinutes; minute < endMinutes; minute += 30) {
      const time = timeFromMinutes(minute);
      const startsAt = toDateTime(date, time);
      const endsAt = addMinutes(startsAt, 30);
      rows.push({
        time,
        startsAt: startsAt.toISOString(),
        cells: resources.map(resource => {
          const booked = bookedCapacityForResource(store, resource, startsAt, endsAt);
          const bookings = store.bookings.filter(booking => (
            booking.resourceId === resource.id &&
            !["cancelled", "failed"].includes(booking.status) &&
            rangesOverlap(new Date(booking.startsAt), new Date(booking.endsAt), startsAt, endsAt)
          ));
          return {
            resourceId: resource.id,
            booked,
            available: Math.max(0, Number(resource.capacity || 0) - booked),
            capacity: Number(resource.capacity || 0),
            bookings
          };
        })
      });
    }

    return sendJson(res, 200, { date, resources, rows });
  }

  if (req.method === "POST" && url.pathname === "/api/employee/bookings") {
    const payload = await parseBody(req);
    const validationError = validateEmployeeBookingPayload(store, payload);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const experience = getExperience(store, payload.experienceId);
    const startsAt = toDateTime(payload.date, payload.time);
    const endsAt = bookingEndsAt(startsAt);
    const guestCount = Number(payload.guestCount);
    const projectOptions = experience.projectOptions || [];
    const projectId = String(payload.projectId || projectOptions[0]?.id || "").trim();
    const project = projectOptions.find(item => item.id === projectId);
    const projectName = String(payload.projectName || project?.name || "").trim();
    const addOnItems = (Array.isArray(payload.addOnItems) ? payload.addOnItems : [])
      .map(item => ({
        id: String(item.id || "").trim(),
        quantity: Math.max(0, Number(item.quantity || 0))
      }))
      .filter(item => item.id && item.quantity > 0);
    const addOnIds = addOnItems.map(item => item.id);
    const subtotalCents = calculateTotal(store, experience, guestCount, addOnIds, projectId, addOnItems);
    const discountResult = validateDiscount(store, payload.discountCode, experience, subtotalCents);
    if (discountResult.error) return sendJson(res, 400, { error: discountResult.error });
    const paymentChoice = ["reservation_fee", "pay_full", "walk_in_end"].includes(payload.paymentChoice)
      ? payload.paymentChoice
      : "walk_in_end";
    const paymentMode = paymentChoice === "pay_full" ? "pay_full" : "reservation_fee";
    const preliminaryBreakdown = pricingBreakdown(store, experience, guestCount, addOnIds, projectId, paymentMode, addOnItems, discountResult.discount);
    const collectNowCents = paymentChoice === "walk_in_end" ? 0 : preliminaryBreakdown.amountDueNowCents;
    const giftCardResult = validateGiftCard(store, payload.giftCardCode, collectNowCents);
    if (giftCardResult.error) return sendJson(res, 400, { error: giftCardResult.error });
    const breakdown = {
      ...preliminaryBreakdown,
      giftCardCents: giftCardResult.giftCardCents,
      amountDueNowCents: collectNowCents,
      paymentDueCents: Math.max(0, collectNowCents - giftCardResult.giftCardCents),
      balanceCents: Math.max(0, preliminaryBreakdown.totalCents - collectNowCents)
    };
    const isPaidInPos = payload.paymentStatus === "paid" && paymentChoice !== "walk_in_end";
    const now = new Date().toISOString();
    const externalPaymentCents = isPaidInPos ? breakdown.paymentDueCents : 0;

    const booking = {
      id: crypto.randomUUID(),
      status: "confirmed",
      source: "employee",
      paymentMode: paymentChoice,
      experienceId: experience.id,
      experienceName: experience.name,
      resourceId: experience.resourceId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guestCount,
      addOnIds,
      addOnItems,
      projectId,
      projectName,
      occasion: String(payload.occasion || "").trim(),
      occasionId: "",
      subtotalCents: breakdown.subtotalCents,
      discountCents: breakdown.discountCents,
      discount: publicDiscount(discountResult.discount),
      taxCents: breakdown.taxCents,
      totalCents: breakdown.totalCents,
      reservationFeeCents: breakdown.reservationFeeSubtotalCents,
      amountDueNowSubtotalCents: paymentChoice === "walk_in_end" ? 0 : breakdown.amountDueNowSubtotalCents,
      amountDueNowTaxCents: paymentChoice === "walk_in_end" ? 0 : breakdown.amountDueNowTaxCents,
      amountDueNowCents: breakdown.giftCardCents + externalPaymentCents,
      depositCents: 0,
      balanceCents: breakdown.totalCents,
      paymentStatus: "pay_in_store",
      paymentIds: [],
      giftCardCents: breakdown.giftCardCents,
      giftCard: null,
      waiverStatus: "not_sent",
      waiver: null,
      waivers: [],
      customer: {
        name: String(payload.customer.name).trim(),
        email: String(payload.customer.email || "").trim(),
        phone: String(payload.customer.phone || "").trim()
      },
      notes: String(payload.notes || "").trim(),
      createdAt: now,
      updatedAt: now
    };

    if (giftCardResult.giftCard && breakdown.giftCardCents > 0) {
      recordGiftCardRedemption(store, booking, giftCardResult.giftCard, breakdown.giftCardCents, "employee_booking");
    }
    if (isPaidInPos && externalPaymentCents > 0) recordExternalPayment(store, booking, "employee_pos", externalPaymentCents);
    if (booking.balanceCents <= 0) {
      booking.paymentStatus = "paid";
      booking.status = ["pending_payment", "confirmed"].includes(booking.status) ? "paid" : booking.status;
    }
    if (discountResult.discount) {
      const storedDiscount = store.discounts.find(item => item.id === discountResult.discount.id);
      if (storedDiscount) storedDiscount.usedCount = Number(storedDiscount.usedCount || 0) + 1;
    }
    store.bookings.push(booking);
    await writeStore(store);
    return sendJson(res, 201, { booking });
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const payload = await parseBody(req);
    const validationError = validateBookingPayload(store, payload);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const experience = getExperience(store, payload.experienceId);
    const startsAt = toDateTime(payload.date, payload.time);
    const endsAt = bookingEndsAt(startsAt);
    const guestCount = Number(payload.guestCount);
    const addOnIds = Array.isArray(payload.addOnIds) ? payload.addOnIds : [];
    const projectOptions = experience.projectOptions || [];
    const projectId = String(payload.projectId || projectOptions[0]?.id || "").trim();
    const project = projectOptions.find(item => item.id === projectId);
    const projectName = String(payload.projectName || project?.name || "").trim();
    const paymentMode = payload.paymentMode === "pay_full" ? "pay_full" : "reservation_fee";
    const subtotalCents = calculateTotal(store, experience, guestCount, addOnIds, projectId);
    const discountResult = validateDiscount(store, payload.discountCode, experience, subtotalCents);
    if (discountResult.error) return sendJson(res, 400, { error: discountResult.error });
    const preliminaryBreakdown = pricingBreakdown(store, experience, guestCount, addOnIds, projectId, paymentMode, [], discountResult.discount);
    const giftCardResult = validateGiftCard(store, payload.giftCardCode, preliminaryBreakdown.amountDueNowCents);
    if (giftCardResult.error) return sendJson(res, 400, { error: giftCardResult.error });
    const breakdown = pricingBreakdown(store, experience, guestCount, addOnIds, projectId, paymentMode, [], discountResult.discount, giftCardResult.giftCard);

    const acceptedAt = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(),
      status: breakdown.paymentDueCents > 0 ? "pending_payment" : "paid",
      source: "public",
      paymentMode: breakdown.giftCardCents ? `${paymentMode}_gift_card` : paymentMode,
      experienceId: experience.id,
      experienceName: experience.name,
      resourceId: experience.resourceId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guestCount,
      addOnIds,
      projectId,
      projectName,
      occasion: String(payload.occasion || "").trim(),
      occasionId: String(payload.occasionId || "").trim(),
      subtotalCents: breakdown.subtotalCents,
      discountCents: breakdown.discountCents,
      discount: publicDiscount(discountResult.discount),
      taxCents: breakdown.taxCents,
      totalCents: breakdown.totalCents,
      reservationFeeCents: breakdown.reservationFeeSubtotalCents,
      amountDueNowSubtotalCents: breakdown.amountDueNowSubtotalCents,
      amountDueNowTaxCents: breakdown.amountDueNowTaxCents,
      amountDueNowCents: breakdown.amountDueNowCents,
      depositCents: breakdown.amountDueNowCents,
      balanceCents: breakdown.balanceCents,
      paymentStatus: breakdown.paymentDueCents > 0 ? "pending" : "paid",
      paymentIds: [],
      giftCardCents: breakdown.giftCardCents,
      giftCard: null,
      waiverStatus: payload.waiverAccepted ? "accepted_online" : "not_sent",
      waiver: payload.waiver ? {
        ...payload.waiver,
        acceptedAt
      } : null,
      waivers: Array.isArray(payload.waivers)
        ? payload.waivers.map(waiver => ({ ...waiver, acceptedAt }))
        : [],
      customer: {
        name: String(payload.customer.name).trim(),
        email: String(payload.customer.email).trim(),
        phone: String(payload.customer.phone || "").trim()
      },
      notes: String(payload.notes || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let payment = null;
    if (giftCardResult.giftCard && breakdown.giftCardCents > 0) {
      recordGiftCardRedemption(store, booking, giftCardResult.giftCard, breakdown.giftCardCents, "public_booking");
    }
    if (breakdown.paymentDueCents > 0) {
      payment = await createCheckoutPayment(store, booking, breakdown, req);
      booking.paymentIds.push(payment.id);
      store.payments.push(payment);
    }

    if (discountResult.discount) {
      const storedDiscount = store.discounts.find(item => item.id === discountResult.discount.id);
      if (storedDiscount) storedDiscount.usedCount = Number(storedDiscount.usedCount || 0) + 1;
    }

    store.bookings.push(booking);
    await writeStore(store);

    let crm = { skipped: true, reason: "Drip credentials are not configured." };
    try {
      crm = await syncCustomerToDrip(booking.customer, {
        source: "public_booking",
        bookingId: booking.id,
        experienceName: booking.experienceName,
        status: booking.status,
        startsAt: booking.startsAt,
        guestCount: booking.guestCount,
        totalCents: booking.totalCents,
        occasion: booking.occasion,
        projectName: booking.projectName,
        notes: booking.notes,
        occurredAt: booking.createdAt
      });
    } catch (error) {
      crm = { synced: false, error: error.message };
      console.error("Drip sync failed:", error.message);
    }

    return sendJson(res, 201, { booking, payment: publicPayment(payment), crm });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/payments/") && url.pathname.endsWith("/mock-confirm")) {
    const paymentId = url.pathname.split("/")[3];
    const payment = store.payments.find(item => item.id === paymentId);
    if (!payment) return sendJson(res, 404, { error: "Payment not found." });
    if (payment.provider !== "mock") return sendJson(res, 400, { error: "This payment is not using the mock provider." });

    const booking = store.bookings.find(item => item.id === payment.bookingId);
    if (!booking) return sendJson(res, 404, { error: "Booking not found." });

    const now = new Date().toISOString();
    payment.status = "paid";
    payment.providerPaymentId = `mock_${crypto.randomUUID()}`;
    payment.paidAt = now;
    payment.updatedAt = now;
    booking.status = "paid";
    booking.paymentStatus = "paid";
    booking.paidAt = now;
    booking.updatedAt = now;

    await writeStore(store);
    return sendJson(res, 200, { booking, payment: publicPayment(payment) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/payments/") && url.pathname.endsWith("/mock-fail")) {
    const paymentId = url.pathname.split("/")[3];
    const payment = store.payments.find(item => item.id === paymentId);
    if (!payment) return sendJson(res, 404, { error: "Payment not found." });
    if (payment.provider !== "mock") return sendJson(res, 400, { error: "This payment is not using the mock provider." });

    const booking = store.bookings.find(item => item.id === payment.bookingId);
    const now = new Date().toISOString();
    payment.status = "failed";
    payment.updatedAt = now;
    if (booking) {
      refundGiftCardForBooking(store, booking, "mock_payment_failed");
      booking.status = "failed";
      booking.paymentStatus = "failed";
      booking.updatedAt = now;
    }

    await writeStore(store);
    return sendJson(res, 200, { booking, payment: publicPayment(payment) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/payments/") && url.pathname.endsWith("/square-card")) {
    const paymentId = url.pathname.split("/")[3];
    const payment = store.payments.find(item => item.id === paymentId);
    if (!payment) return sendJson(res, 404, { error: "Payment not found." });
    if (payment.provider !== "square") return sendJson(res, 400, { error: "This payment is not using Square." });
    if (payment.status === "paid") return sendJson(res, 200, { booking: store.bookings.find(item => item.id === payment.bookingId), payment: publicPayment(payment) });

    const booking = store.bookings.find(item => item.id === payment.bookingId);
    if (!booking) return sendJson(res, 404, { error: "Booking not found." });

    const payload = await parseBody(req);
    try {
      await createSquareCardPayment({
        payment,
        booking,
        sourceId: payload.sourceId
      });

      const now = new Date().toISOString();
      payment.status = "paid";
      payment.paidAt = now;
      payment.updatedAt = now;
      booking.status = "paid";
      booking.paymentStatus = "paid";
      booking.paidAt = now;
      booking.updatedAt = now;

      await writeStore(store);
      return sendJson(res, 200, { booking, payment: publicPayment(payment) });
    } catch (error) {
      payment.status = "pending";
      payment.updatedAt = new Date().toISOString();
      payment.lastError = error.message || "Square payment failed.";
      booking.paymentStatus = "pending";
      booking.status = "pending_payment";
      booking.updatedAt = payment.updatedAt;
      await writeStore(store);
      return sendJson(res, error.status || 502, { error: error.message || "Square payment failed." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/square/webhook") {
    return sendJson(res, 200, {
      received: true,
      configured: Boolean(SQUARE_WEBHOOK_SIGNATURE_KEY),
      message: "Square webhook endpoint stub is ready; signature verification and event mapping will be enabled with Square credentials."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/crm/customers") {
    const payload = await parseBody(req);
    if (!payload.customer || !payload.customer.email) {
      return sendJson(res, 400, { error: "Customer email is required." });
    }

    try {
      const crm = await syncCustomerToDrip(payload.customer, {
        source: payload.source || "manual_api",
        eventAction: payload.eventAction || "Shared customer with CRM",
        notes: payload.notes
      });
      return sendJson(res, crm.skipped ? 202 : 200, { crm });
    } catch (error) {
      return sendJson(res, error.status || 502, {
        error: error.message,
        details: error.payload || null
      });
    }
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/bookings/")) {
    const bookingId = url.pathname.split("/").pop();
    const payload = await parseBody(req);
    const booking = store.bookings.find(item => item.id === bookingId);
    if (!booking) return sendJson(res, 404, { error: "Booking not found." });

    const allowedStatuses = new Set(["draft", "pending_payment", "paid", "failed", "confirmed", "checked_in", "completed", "cancelled", "no_show"]);
    if (payload.status && allowedStatuses.has(payload.status)) booking.status = payload.status;
    if (payload.waiverStatus && ["not_sent", "sent", "signed", "accepted_online"].includes(payload.waiverStatus)) {
      booking.waiverStatus = payload.waiverStatus;
    }
    if (payload.paymentStatus && ["pending", "pay_in_store", "paid", "failed", "refunded"].includes(payload.paymentStatus)) {
      booking.paymentStatus = payload.paymentStatus;
      if (payload.paymentStatus === "paid") {
        recordExternalPayment(store, booking);
      }
    }
    if (typeof payload.notes === "string") booking.notes = payload.notes.trim();
    booking.updatedAt = new Date().toISOString();

    await writeStore(store);
    return sendJson(res, 200, { booking });
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    const payload = await parseBody(req);
    if (payload.business) store.business = { ...store.business, ...payload.business };
    if (payload.site) store.site = { ...store.site, ...payload.site };
    if (Array.isArray(payload.resources)) store.resources = payload.resources;
    if (payload.schedule) store.schedule = {
      minNoticeMinutes: Number(payload.schedule.minNoticeMinutes ?? store.schedule?.minNoticeMinutes ?? 60),
      availabilityRules: Array.isArray(payload.schedule.availabilityRules) ? payload.schedule.availabilityRules : store.schedule?.availabilityRules || [],
      blackouts: Array.isArray(payload.schedule.blackouts) ? payload.schedule.blackouts : store.schedule?.blackouts || []
    };
    if (Array.isArray(payload.experiences)) store.experiences = payload.experiences;
    if (Array.isArray(payload.addOns)) store.addOns = payload.addOns;
    if (Array.isArray(payload.discounts)) store.discounts = payload.discounts;
    if (payload.policies) store.policies = { ...store.policies, ...payload.policies };
    await writeStore(store);
    return sendJson(res, 200, publicStore(store));
  }

  return sendJson(res, 404, { error: "Not found." });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (!path.extname(pathname)) pathname = `${pathname}.html`;

  if (USE_DATABASE && ["/admin.html", "/employee.html"].includes(pathname)) {
    const user = await getSessionUser(req);
    const requiredRoles = pathname === "/admin.html" ? ["owner", "admin"] : ["owner", "admin", "employee"];
    if (!hasRole(user, requiredRoles)) {
      return sendRedirect(res, `/login.html?next=${encodeURIComponent(pathname)}`);
    }
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Spin Art Booking running at http://localhost:${PORT}`);
});
