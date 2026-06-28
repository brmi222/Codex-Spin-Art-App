const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4280);
const DATA_FILE = path.join(__dirname, "data", "store.json");
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
  ".mov": "video/quicktime"
};

function readStore() {
  const store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  store.settings = {
    currency: "USD",
    taxRateBps: DEFAULT_TAX_RATE_BPS,
    taxLabel: "Wake County sales tax",
    paymentProvider: PAYMENT_PROVIDER,
    ...(store.settings || {})
  };
  store.payments = Array.isArray(store.payments) ? store.payments : [];
  return store;
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
      if (body.length > 1_000_000) {
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

function publicStore(store) {
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
        isConfigured: Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID && SQUARE_ACCESS_TOKEN)
      }
    },
    site: store.site,
    resources: store.resources,
    schedule: store.schedule || { availabilityRules: [], blackouts: [] },
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

function cleanupHolds(store) {
  const active = activeHolds(store);
  if (active.length !== store.holds.length) {
    store.holds = active;
    writeStore(store);
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

function buildSlots(store, experienceId, dateString) {
  const experience = getExperience(store, experienceId);
  const day = startOfDay(dateString);
  if (!experience || !day) return [];

  const resource = getResource(store, experience.resourceId);
  if (!resource) return [];
  const dayIndex = day.getDay();
  const schedule = store.schedule || { availabilityRules: [], blackouts: [] };
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
    const minNotice = Number(rule.minNoticeMinutes || 0);
    const startMinute = minutesFromTime(rule.startTime);
    const endMinute = minutesFromTime(rule.endTime);
    for (let minute = startMinute; minute + APPOINTMENT_MINUTES <= endMinute; minute += interval) {
      const time = timeFromMinutes(minute);
      const startsAt = toDateTime(dateString, time);
      const endsAt = bookingEndsAt(startsAt);
      if (startsAt.getTime() - Date.now() < minNotice * 60_000) continue;
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

function calculateTotal(store, experience, guestCount, selectedAddOnIds = [], projectId = "") {
  const resource = getResource(store, experience.resourceId);
  const billableGuests = billableGuestCount(resource, experience, guestCount);
  const capacityUnits = capacityUnitsForBooking(resource, guestCount, experience.id);
  const addOnTotal = selectedAddOnIds.reduce((sum, addOnId) => {
    const addOn = store.addOns.find(item => item.id === addOnId);
    return sum + (addOn ? money(addOn.priceCents) : 0);
  }, 0);

  const project = (experience.projectOptions || []).find(item => item.id === projectId);
  const projectTotal = project ? money(project.priceCents) : 0;
  const projectMultiplier = project?.pricingScope === "per_station" ? capacityUnits : guestCount;
  const base = experience.pricingType === "per_guest"
    ? money(experience.basePriceCents) * billableGuests
    : money(experience.basePriceCents);

  return base + (projectTotal * projectMultiplier) + (addOnTotal * guestCount);
}

function calculateTax(store, subtotalCents) {
  const rate = Number(store.settings?.taxRateBps || DEFAULT_TAX_RATE_BPS);
  return Math.round(money(subtotalCents) * rate / 10_000);
}

function pricingBreakdown(store, experience, guestCount, selectedAddOnIds = [], projectId = "", paymentMode = "reservation_fee") {
  const subtotalCents = calculateTotal(store, experience, guestCount, selectedAddOnIds, projectId);
  const taxCents = calculateTax(store, subtotalCents);
  const totalCents = subtotalCents + taxCents;
  const resource = getResource(store, experience.resourceId);
  const billableGuests = billableGuestCount(resource, experience, guestCount);
  const reservationFeeSubtotalCents = experience.pricingType === "per_guest"
    ? money(experience.depositCents) * billableGuests
    : money(experience.depositCents);
  const amountDueNowSubtotalCents = paymentMode === "pay_full"
    ? subtotalCents
    : Math.min(reservationFeeSubtotalCents, subtotalCents);
  const amountDueNowTaxCents = calculateTax(store, amountDueNowSubtotalCents);
  const amountDueNowCents = amountDueNowSubtotalCents + amountDueNowTaxCents;

  return {
    subtotalCents,
    taxCents,
    totalCents,
    reservationFeeSubtotalCents,
    amountDueNowSubtotalCents,
    amountDueNowTaxCents,
    amountDueNowCents,
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
    createdAt: payment.createdAt,
    paidAt: payment.paidAt || null
  };
}

function createCheckoutPayment(store, booking, breakdown) {
  const now = new Date().toISOString();
  const provider = PAYMENT_PROVIDER === "square" && SQUARE_ACCESS_TOKEN ? "square" : "mock";
  return {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    provider,
    status: "pending",
    currency: store.settings?.currency || "USD",
    paymentMode: booking.paymentMode,
    amountCents: breakdown.amountDueNowCents,
    subtotalCents: breakdown.amountDueNowSubtotalCents,
    taxCents: breakdown.amountDueNowTaxCents,
    providerPaymentId: null,
    checkoutUrl: provider === "mock" ? null : null,
    squareLocationId: provider === "square" ? SQUARE_LOCATION_ID : null,
    createdAt: now,
    updatedAt: now
  };
}

function recordExternalPayment(store, booking, source = "employee_pos") {
  const amountCents = Math.max(0, Number(booking.balanceCents || booking.totalCents || 0));
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
  booking.balanceCents = 0;
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

  const slot = buildSlots(store, experience.id, payload.date).find(item => item.time === payload.time);
  const resource = getResource(store, experience.resourceId);
  const requiredCapacity = requiredCapacityForBooking(resource, experience, guestCount);
  const hasEnoughCapacity = slot?.remaining >= requiredCapacity;
  if (!slot || !slot.isAvailable || !hasEnoughCapacity) {
    return "That time is no longer available for the selected group size.";
  }

  return null;
}

async function handleApi(req, res, url) {
  const store = readStore();
  cleanupHolds(store);

  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, publicStore(store));
  }

  if (req.method === "GET" && url.pathname === "/api/admin") {
    return sendJson(res, 200, {
      ...publicStore(store),
      bookings: store.bookings.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
      payments: store.payments,
      holds: activeHolds(store)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/availability") {
    const experienceId = url.searchParams.get("experienceId");
    const date = url.searchParams.get("date");
    return sendJson(res, 200, { slots: buildSlots(store, experienceId, date) });
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
            !["cancelled", "failed", "no_show"].includes(booking.status) &&
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
    const breakdown = pricingBreakdown(store, experience, guestCount, [], projectId, "reservation_fee");
    const isPaidInPos = payload.paymentStatus === "paid";
    const now = new Date().toISOString();

    const booking = {
      id: crypto.randomUUID(),
      status: isPaidInPos ? "paid" : "confirmed",
      source: "employee",
      paymentMode: isPaidInPos ? "external_pos" : "pay_in_store",
      experienceId: experience.id,
      experienceName: experience.name,
      resourceId: experience.resourceId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      guestCount,
      addOnIds: [],
      projectId,
      projectName,
      occasion: String(payload.occasion || "").trim(),
      occasionId: "",
      subtotalCents: breakdown.subtotalCents,
      taxCents: breakdown.taxCents,
      totalCents: breakdown.totalCents,
      reservationFeeCents: breakdown.reservationFeeSubtotalCents,
      amountDueNowSubtotalCents: 0,
      amountDueNowTaxCents: 0,
      amountDueNowCents: isPaidInPos ? breakdown.totalCents : 0,
      depositCents: 0,
      balanceCents: isPaidInPos ? 0 : breakdown.totalCents,
      paymentStatus: isPaidInPos ? "paid" : "pay_in_store",
      paymentIds: [],
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

    if (isPaidInPos) recordExternalPayment(store, booking);
    store.bookings.push(booking);
    writeStore(store);
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
    const breakdown = pricingBreakdown(store, experience, guestCount, addOnIds, projectId, paymentMode);

    const acceptedAt = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(),
      status: breakdown.amountDueNowCents > 0 ? "pending_payment" : "paid",
      source: "public",
      paymentMode,
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
      taxCents: breakdown.taxCents,
      totalCents: breakdown.totalCents,
      reservationFeeCents: breakdown.reservationFeeSubtotalCents,
      amountDueNowSubtotalCents: breakdown.amountDueNowSubtotalCents,
      amountDueNowTaxCents: breakdown.amountDueNowTaxCents,
      amountDueNowCents: breakdown.amountDueNowCents,
      depositCents: breakdown.amountDueNowCents,
      balanceCents: breakdown.balanceCents,
      paymentStatus: breakdown.amountDueNowCents > 0 ? "pending" : "paid",
      paymentIds: [],
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
    if (breakdown.amountDueNowCents > 0) {
      payment = createCheckoutPayment(store, booking, breakdown);
      booking.paymentIds.push(payment.id);
      store.payments.push(payment);
    }

    store.bookings.push(booking);
    writeStore(store);

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

    writeStore(store);
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
      booking.status = "failed";
      booking.paymentStatus = "failed";
      booking.updatedAt = now;
    }

    writeStore(store);
    return sendJson(res, 200, { booking, payment: publicPayment(payment) });
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

    writeStore(store);
    return sendJson(res, 200, { booking });
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    const payload = await parseBody(req);
    if (payload.business) store.business = { ...store.business, ...payload.business };
    if (payload.site) store.site = { ...store.site, ...payload.site };
    if (Array.isArray(payload.resources)) store.resources = payload.resources;
    if (payload.schedule) store.schedule = {
      availabilityRules: Array.isArray(payload.schedule.availabilityRules) ? payload.schedule.availabilityRules : store.schedule?.availabilityRules || [],
      blackouts: Array.isArray(payload.schedule.blackouts) ? payload.schedule.blackouts : store.schedule?.blackouts || []
    };
    if (Array.isArray(payload.experiences)) store.experiences = payload.experiences;
    if (Array.isArray(payload.addOns)) store.addOns = payload.addOns;
    if (payload.policies) store.policies = { ...store.policies, ...payload.policies };
    writeStore(store);
    return sendJson(res, 200, publicStore(store));
  }

  return sendJson(res, 404, { error: "Not found." });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (!path.extname(pathname)) pathname = `${pathname}.html`;

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
      serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Spin Art Booking running at http://localhost:${PORT}`);
});
