const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getPrisma } = require("./prisma");

const DATA_FILE = path.join(__dirname, "..", "data", "store.json");
const DEFAULT_TAX_RATE_BPS = 725;
const USE_DATABASE = Boolean(process.env.DATABASE_URL);

function jsonClone(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function money(value) {
  return Math.round(Number(value || 0));
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashGiftCardCode(code) {
  return crypto.createHash("sha256").update(normalizeCode(code)).digest("hex");
}

function readJsonStore() {
  const store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return normalizeStore(store);
}

function writeJsonStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function normalizeStore(store) {
  store.settings = {
    currency: "USD",
    taxRateBps: DEFAULT_TAX_RATE_BPS,
    taxLabel: "Wake County sales tax",
    ...(store.settings || {})
  };
  store.resources = Array.isArray(store.resources) ? store.resources : [];
  store.experiences = Array.isArray(store.experiences) ? store.experiences : [];
  store.addOns = Array.isArray(store.addOns) ? store.addOns : [];
  store.bookings = Array.isArray(store.bookings) ? store.bookings : [];
  store.payments = Array.isArray(store.payments) ? store.payments : [];
  store.discounts = Array.isArray(store.discounts) ? store.discounts : [];
  store.giftCards = Array.isArray(store.giftCards) ? store.giftCards : [];
  store.holds = Array.isArray(store.holds) ? store.holds : [];
  store.schedule = {
    minNoticeMinutes: Number(store.schedule?.minNoticeMinutes ?? 60),
    availabilityRules: Array.isArray(store.schedule?.availabilityRules) ? store.schedule.availabilityRules : [],
    blackouts: Array.isArray(store.schedule?.blackouts) ? store.schedule.blackouts : []
  };
  return store;
}

function rowMetadata(row, fallback = {}) {
  return jsonClone(row.metadata, fallback) || fallback;
}

function toBookingStatus(status) {
  const normalized = String(status || "confirmed").toLowerCase();
  const map = {
    draft: "PENDING",
    pending: "PENDING",
    pending_payment: "PENDING",
    paid: "CONFIRMED",
    confirmed: "CONFIRMED",
    checked_in: "CHECKED_IN",
    in_progress: "IN_PROGRESS",
    drying: "DRYING",
    ready_for_pickup: "READY_FOR_PICKUP",
    completed: "COMPLETED",
    cancelled: "CANCELLED",
    no_show: "NO_SHOW",
    failed: "FAILED"
  };
  return map[normalized] || "CONFIRMED";
}

function fromBookingStatus(status, fallback = "confirmed") {
  const map = {
    PENDING: "pending_payment",
    CONFIRMED: "confirmed",
    CHECKED_IN: "checked_in",
    IN_PROGRESS: "in_progress",
    DRYING: "drying",
    READY_FOR_PICKUP: "ready_for_pickup",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    NO_SHOW: "no_show",
    FAILED: "failed"
  };
  return map[status] || fallback;
}

function toPaymentStatus(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (["paid", "pay_in_store"].includes(normalized)) return normalized === "paid" ? "PAID" : "PENDING";
  if (normalized === "partially_paid") return "PARTIALLY_PAID";
  if (normalized === "failed") return "FAILED";
  if (normalized === "refunded") return "REFUNDED";
  if (normalized === "partially_refunded") return "PARTIALLY_REFUNDED";
  if (normalized === "voided") return "VOIDED";
  return "PENDING";
}

function fromPaymentStatus(status, fallback = "pending") {
  const map = {
    PENDING: "pending",
    PAID: "paid",
    PARTIALLY_PAID: "partially_paid",
    FAILED: "failed",
    REFUNDED: "refunded",
    PARTIALLY_REFUNDED: "partially_refunded",
    VOIDED: "voided"
  };
  return map[status] || fallback;
}

function toPaymentProvider(provider) {
  const normalized = String(provider || "mock").toLowerCase();
  if (normalized === "square") return "SQUARE";
  if (normalized === "external_pos") return "EXTERNAL_POS";
  if (normalized === "gift_card") return "GIFT_CARD";
  if (normalized === "manual") return "MANUAL";
  return "MOCK";
}

function toDiscountType(discount) {
  const type = String(discount?.type || "").toLowerCase();
  if (type === "fixed") return "FIXED";
  if (type === "add_on") return "ADD_ON";
  return "PERCENT";
}

function toGiftCardStatus(status) {
  const normalized = String(status || "active").toLowerCase();
  if (normalized === "inactive") return "INACTIVE";
  if (normalized === "redeemed") return "REDEEMED";
  if (normalized === "void") return "VOID";
  return "ACTIVE";
}

function fromGiftCardStatus(status) {
  const map = { ACTIVE: "active", INACTIVE: "inactive", REDEEMED: "redeemed", VOID: "void" };
  return map[status] || "active";
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function readDatabaseStore() {
  const prisma = getPrisma();
  const [
    settingsRows,
    resources,
    experiences,
    addOns,
    bookings,
    payments,
    discounts,
    giftCards
  ] = await Promise.all([
    prisma.siteSetting.findMany(),
    prisma.resource.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.experience.findMany({ include: { addOns: true }, orderBy: { displayOrder: "asc" } }),
    prisma.addOn.findMany({ orderBy: { name: "asc" } }),
    prisma.booking.findMany({ include: { customer: true }, orderBy: { startsAt: "asc" } }),
    prisma.payment.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.discount.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.giftCard.findMany({ include: { ledgerEntries: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } })
  ]);

  const settingMap = Object.fromEntries(settingsRows.map(row => [row.key, row.value]));
  return normalizeStore({
    business: settingMap.business || {},
    site: settingMap.site || {},
    settings: settingMap.settings || {},
    policies: settingMap.policies || {},
    schedule: settingMap.schedule || {},
    holds: settingMap.holds || [],
    resources: resources.map(row => ({
      ...rowMetadata(row),
      id: row.id,
      name: row.name,
      calendarLabel: row.calendarLabel || row.name,
      capacity: row.capacity,
      capacityMode: row.capacityMode,
      capacityUnit: row.capacityUnit || undefined,
      isExclusive: row.isExclusive,
      isEmployeeVisible: row.isEmployeeVisible,
      displayOrder: row.displayOrder
    })),
    experiences: experiences.map(row => ({
      ...rowMetadata(row),
      id: row.id,
      resourceId: row.resourceId,
      name: row.name,
      slug: row.slug,
      shortDescription: row.shortDescription || undefined,
      description: row.description || undefined,
      durationMinutes: row.durationMinutes,
      bufferMinutes: row.bufferMinutes,
      minGuests: row.minGuests,
      maxGuests: row.maxGuests,
      reservationFeeCents: row.reservationFeeCents,
      basePriceCents: row.basePriceCents,
      imageUrl: row.imageUrl || undefined,
      isPublic: row.isPublic,
      isPrivateEligible: row.isPrivateEligible,
      displayOrder: row.displayOrder,
      projects: row.projects || rowMetadata(row).projects,
      includedItems: row.includedItems || rowMetadata(row).includedItems,
      policies: row.policies || rowMetadata(row).policies,
      addOnIds: row.addOns.map(item => item.addOnId)
    })),
    addOns: addOns.map(row => ({
      ...rowMetadata(row),
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      priceCents: row.priceCents,
      isActive: row.isActive
    })),
    bookings: bookings.map(row => {
      const metadata = rowMetadata(row);
      return {
        ...metadata,
        id: row.id,
        status: metadata.status || fromBookingStatus(row.status),
        paymentStatus: metadata.paymentStatus || fromPaymentStatus(row.paymentStatus),
        experienceId: row.experienceId,
        resourceId: row.resourceId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        guestCount: row.guestCount,
        occasion: row.occasion || metadata.occasion || "",
        projectId: row.projectId || metadata.projectId || "",
        projectName: row.projectName || metadata.projectName || "",
        paymentMode: row.paymentMode || metadata.paymentMode || "",
        subtotalCents: row.subtotalCents,
        discountCents: row.discountCents,
        taxCents: row.taxCents,
        totalCents: row.totalCents,
        amountDueNowCents: row.amountDueNowCents,
        balanceCents: row.balanceDueCents,
        giftCardCents: row.giftCardCents,
        waiverStatus: row.waiverStatus,
        notes: row.notes || "",
        customer: metadata.customer || (row.customer ? {
          name: row.customer.name,
          email: row.customer.email || "",
          phone: row.customer.phone || ""
        } : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    }),
    payments: payments.map(row => {
      const metadata = rowMetadata(row);
      return {
        ...metadata,
        id: row.id,
        bookingId: row.bookingId || metadata.bookingId,
        provider: metadata.provider || String(row.provider || "MOCK").toLowerCase(),
        status: metadata.status || fromPaymentStatus(row.status),
        amountCents: row.amountCents,
        taxCents: row.taxCents,
        providerPaymentId: row.providerPaymentId || metadata.providerPaymentId,
        checkoutUrl: row.providerCheckoutUrl || metadata.checkoutUrl,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      };
    }),
    discounts: discounts.map(row => ({
      ...rowMetadata(row),
      id: row.id,
      code: row.code,
      name: row.name,
      type: rowMetadata(row).type || String(row.type).toLowerCase(),
      value: row.value,
      status: row.status,
      isActive: row.status !== "inactive",
      startsAt: toIso(row.startsAt),
      expiresAt: toIso(row.expiresAt),
      maxRedemptions: row.usageLimit || rowMetadata(row).maxRedemptions,
      minimumSubtotalCents: row.minimumSubtotalCents || 0,
      experienceIds: row.eligibleExperienceIds || [],
      addOnIds: row.eligibleAddOnIds || [],
      stackable: row.stackable
    })),
    giftCards: giftCards.map(row => ({
      id: row.id,
      code: row.displayCode || row.codeLast4,
      holderName: row.holderName || "",
      holderEmail: row.holderEmail || "",
      holderPhone: row.holderPhone || "",
      originalBalanceCents: row.issuedCents,
      balanceCents: row.balanceCents,
      status: fromGiftCardStatus(row.status),
      expiresAt: toIso(row.expiresAt),
      note: row.note || "",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      transactions: row.ledgerEntries.map(entry => ({
        id: entry.id,
        type: entry.type,
        amountCents: entry.amountCents,
        bookingId: entry.bookingId || "",
        source: entry.source || "",
        note: entry.note || "",
        createdAt: entry.createdAt.toISOString()
      }))
    }))
  });
}

async function upsertSiteSetting(tx, key, value) {
  await tx.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

async function writeDatabaseStore(store) {
  const prisma = getPrisma();
  await prisma.$transaction(async tx => {
    await upsertSiteSetting(tx, "business", store.business || {});
    await upsertSiteSetting(tx, "site", store.site || {});
    await upsertSiteSetting(tx, "settings", store.settings || {});
    await upsertSiteSetting(tx, "policies", store.policies || {});
    await upsertSiteSetting(tx, "schedule", store.schedule || {});
    await upsertSiteSetting(tx, "holds", store.holds || []);

    for (const resource of store.resources || []) {
      await tx.resource.upsert({
        where: { id: resource.id },
        update: {
          name: resource.name,
          calendarLabel: resource.calendarLabel || resource.name,
          capacity: Number(resource.capacity || 1),
          capacityMode: resource.capacityMode || "spots",
          capacityUnit: resource.capacityUnit || null,
          isExclusive: Boolean(resource.isExclusive),
          isEmployeeVisible: resource.isEmployeeVisible !== false,
          displayOrder: Number(resource.displayOrder || 0),
          metadata: resource
        },
        create: {
          id: resource.id,
          name: resource.name,
          calendarLabel: resource.calendarLabel || resource.name,
          capacity: Number(resource.capacity || 1),
          capacityMode: resource.capacityMode || "spots",
          capacityUnit: resource.capacityUnit || null,
          isExclusive: Boolean(resource.isExclusive),
          isEmployeeVisible: resource.isEmployeeVisible !== false,
          displayOrder: Number(resource.displayOrder || 0),
          metadata: resource
        }
      });
    }

    for (const addOn of store.addOns || []) {
      await tx.addOn.upsert({
        where: { id: addOn.id },
        update: {
          name: addOn.name,
          description: addOn.description || null,
          priceCents: money(addOn.priceCents),
          isActive: addOn.isActive !== false,
          metadata: addOn
        },
        create: {
          id: addOn.id,
          name: addOn.name,
          description: addOn.description || null,
          priceCents: money(addOn.priceCents),
          isActive: addOn.isActive !== false,
          metadata: addOn
        }
      });
    }

    for (const experience of store.experiences || []) {
      await tx.experience.upsert({
        where: { id: experience.id },
        update: {
          resourceId: experience.resourceId,
          name: experience.name,
          slug: experience.slug || experience.id,
          shortDescription: experience.shortDescription || experience.description || null,
          description: experience.description || null,
          durationMinutes: Number(experience.durationMinutes || 60),
          bufferMinutes: Number(experience.bufferMinutes || 0),
          minGuests: Number(experience.minGuests || 1),
          maxGuests: Number(experience.maxGuests || 1),
          reservationFeeCents: money(experience.reservationFeeCents || experience.depositCents),
          basePriceCents: money(experience.basePriceCents),
          imageUrl: experience.imageUrl || null,
          isPublic: experience.isPublic !== false,
          isPrivateEligible: Boolean(experience.isPrivateEligible),
          displayOrder: Number(experience.displayOrder || 0),
          projects: experience.projects || experience.projectOptions || [],
          includedItems: experience.includedItems || [],
          policies: experience.policies || {},
          metadata: experience
        },
        create: {
          id: experience.id,
          resourceId: experience.resourceId,
          name: experience.name,
          slug: experience.slug || experience.id,
          shortDescription: experience.shortDescription || experience.description || null,
          description: experience.description || null,
          durationMinutes: Number(experience.durationMinutes || 60),
          bufferMinutes: Number(experience.bufferMinutes || 0),
          minGuests: Number(experience.minGuests || 1),
          maxGuests: Number(experience.maxGuests || 1),
          reservationFeeCents: money(experience.reservationFeeCents || experience.depositCents),
          basePriceCents: money(experience.basePriceCents),
          imageUrl: experience.imageUrl || null,
          isPublic: experience.isPublic !== false,
          isPrivateEligible: Boolean(experience.isPrivateEligible),
          displayOrder: Number(experience.displayOrder || 0),
          projects: experience.projects || experience.projectOptions || [],
          includedItems: experience.includedItems || [],
          policies: experience.policies || {},
          metadata: experience
        }
      });
      for (const addOnId of experience.addOnIds || []) {
        await tx.experienceAddOn.upsert({
          where: { experienceId_addOnId: { experienceId: experience.id, addOnId } },
          update: {},
          create: { experienceId: experience.id, addOnId }
        });
      }
    }

    const media = Array.isArray(store.site?.media) ? store.site.media : [];
    for (const item of media) {
      await tx.mediaAsset.upsert({
        where: { id: item.id },
        update: {
          type: item.type === "video" ? "VIDEO" : "IMAGE",
          title: item.title || "Media asset",
          url: item.url,
          placement: item.placement || "gallery",
          source: item.source || null,
          driveFileId: item.driveFileId || null,
          metadata: item
        },
        create: {
          id: item.id,
          type: item.type === "video" ? "VIDEO" : "IMAGE",
          title: item.title || "Media asset",
          url: item.url,
          placement: item.placement || "gallery",
          source: item.source || null,
          driveFileId: item.driveFileId || null,
          metadata: item
        }
      });
    }

    for (const discount of store.discounts || []) {
      await tx.discount.upsert({
        where: { id: discount.id },
        update: {
          code: String(discount.code || discount.id).toUpperCase(),
          name: discount.name || discount.code || discount.id,
          type: toDiscountType(discount),
          value: Number(discount.value || discount.valuePercent || discount.valueCents || 0),
          status: discount.isActive === false ? "inactive" : discount.status || "active",
          startsAt: toDate(discount.startsAt),
          expiresAt: toDate(discount.expiresAt),
          usageLimit: discount.maxRedemptions || discount.usageLimit || null,
          perCustomerLimit: discount.perCustomerLimit || null,
          minimumSubtotalCents: discount.minimumSubtotalCents || null,
          eligibleExperienceIds: discount.experienceIds || discount.eligibleExperienceIds || [],
          eligibleAddOnIds: discount.addOnIds || discount.eligibleAddOnIds || [],
          stackable: Boolean(discount.stackable),
          metadata: discount
        },
        create: {
          id: discount.id,
          code: String(discount.code || discount.id).toUpperCase(),
          name: discount.name || discount.code || discount.id,
          type: toDiscountType(discount),
          value: Number(discount.value || discount.valuePercent || discount.valueCents || 0),
          status: discount.isActive === false ? "inactive" : discount.status || "active",
          startsAt: toDate(discount.startsAt),
          expiresAt: toDate(discount.expiresAt),
          usageLimit: discount.maxRedemptions || discount.usageLimit || null,
          perCustomerLimit: discount.perCustomerLimit || null,
          minimumSubtotalCents: discount.minimumSubtotalCents || null,
          eligibleExperienceIds: discount.experienceIds || discount.eligibleExperienceIds || [],
          eligibleAddOnIds: discount.addOnIds || discount.eligibleAddOnIds || [],
          stackable: Boolean(discount.stackable),
          metadata: discount
        }
      });
    }

    for (const card of store.giftCards || []) {
      const code = normalizeCode(card.code);
      if (!code) continue;
      await tx.giftCard.upsert({
        where: { codeHash: hashGiftCardCode(code) },
        update: {
          displayCode: code,
          codeLast4: code.slice(-4),
          status: toGiftCardStatus(card.status),
          issuedCents: money(card.originalBalanceCents || card.issuedCents || card.balanceCents),
          balanceCents: money(card.balanceCents),
          holderName: card.holderName || null,
          holderEmail: card.holderEmail || null,
          holderPhone: card.holderPhone || null,
          note: card.note || null,
          expiresAt: toDate(card.expiresAt)
        },
        create: {
          id: card.id,
          codeHash: hashGiftCardCode(code),
          displayCode: code,
          codeLast4: code.slice(-4),
          status: toGiftCardStatus(card.status),
          issuedCents: money(card.originalBalanceCents || card.issuedCents || card.balanceCents),
          balanceCents: money(card.balanceCents),
          holderName: card.holderName || null,
          holderEmail: card.holderEmail || null,
          holderPhone: card.holderPhone || null,
          note: card.note || null,
          expiresAt: toDate(card.expiresAt)
        }
      });
    }

    for (const booking of store.bookings || []) {
      let customerId = null;
      if (booking.customer?.email || booking.customer?.phone || booking.customer?.name) {
        customerId = booking.customerId || booking.customer?.id || crypto.randomUUID();
        booking.customerId = customerId;
        await tx.customer.upsert({
          where: { id: customerId },
          update: {
            name: booking.customer.name || "Guest",
            email: booking.customer.email || null,
            phone: booking.customer.phone || null
          },
          create: {
            id: customerId,
            name: booking.customer.name || "Guest",
            email: booking.customer.email || null,
            phone: booking.customer.phone || null
          }
        });
      }

      await tx.booking.upsert({
        where: { id: booking.id },
        update: {
          customerId,
          experienceId: booking.experienceId,
          resourceId: booking.resourceId,
          status: toBookingStatus(booking.status),
          paymentStatus: toPaymentStatus(booking.paymentStatus),
          startsAt: new Date(booking.startsAt),
          endsAt: new Date(booking.endsAt),
          guestCount: Number(booking.guestCount || 1),
          capacityUnits: Number(booking.capacityUnits || 1),
          occasion: booking.occasion || null,
          projectId: booking.projectId || null,
          projectName: booking.projectName || null,
          paymentMode: booking.paymentMode || null,
          subtotalCents: money(booking.subtotalCents),
          discountCents: money(booking.discountCents),
          taxCents: money(booking.taxCents),
          totalCents: money(booking.totalCents),
          amountDueNowCents: money(booking.amountDueNowCents),
          balanceDueCents: money(booking.balanceCents),
          giftCardCents: money(booking.giftCardCents),
          waiverStatus: booking.waiverStatus || "not_sent",
          notes: booking.notes || null,
          internalNotes: booking.internalNotes || null,
          metadata: booking,
          cancelledAt: toDate(booking.cancelledAt),
          completedAt: toDate(booking.completedAt)
        },
        create: {
          id: booking.id,
          customerId,
          experienceId: booking.experienceId,
          resourceId: booking.resourceId,
          status: toBookingStatus(booking.status),
          paymentStatus: toPaymentStatus(booking.paymentStatus),
          startsAt: new Date(booking.startsAt),
          endsAt: new Date(booking.endsAt),
          guestCount: Number(booking.guestCount || 1),
          capacityUnits: Number(booking.capacityUnits || 1),
          occasion: booking.occasion || null,
          projectId: booking.projectId || null,
          projectName: booking.projectName || null,
          paymentMode: booking.paymentMode || null,
          subtotalCents: money(booking.subtotalCents),
          discountCents: money(booking.discountCents),
          taxCents: money(booking.taxCents),
          totalCents: money(booking.totalCents),
          amountDueNowCents: money(booking.amountDueNowCents),
          balanceDueCents: money(booking.balanceCents),
          giftCardCents: money(booking.giftCardCents),
          waiverStatus: booking.waiverStatus || "not_sent",
          notes: booking.notes || null,
          internalNotes: booking.internalNotes || null,
          metadata: booking,
          cancelledAt: toDate(booking.cancelledAt),
          completedAt: toDate(booking.completedAt)
        }
      });
    }

    for (const payment of store.payments || []) {
      await tx.payment.upsert({
        where: { id: payment.id },
        update: {
          bookingId: payment.bookingId || null,
          provider: toPaymentProvider(payment.provider),
          status: toPaymentStatus(payment.status),
          amountCents: money(payment.amountCents),
          taxCents: money(payment.taxCents),
          providerPaymentId: payment.providerPaymentId || null,
          providerCheckoutUrl: payment.checkoutUrl || null,
          metadata: payment
        },
        create: {
          id: payment.id,
          bookingId: payment.bookingId || null,
          provider: toPaymentProvider(payment.provider),
          status: toPaymentStatus(payment.status),
          amountCents: money(payment.amountCents),
          taxCents: money(payment.taxCents),
          providerPaymentId: payment.providerPaymentId || null,
          providerCheckoutUrl: payment.checkoutUrl || null,
          metadata: payment
        }
      });
    }

    for (const card of store.giftCards || []) {
      for (const entry of card.transactions || []) {
        await tx.giftCardLedgerEntry.upsert({
          where: { id: entry.id },
          update: {
            giftCardId: card.id,
            bookingId: entry.bookingId || null,
            type: entry.type || "adjustment",
            amountCents: money(entry.amountCents),
            balanceCents: money(entry.balanceCents || card.balanceCents),
            source: entry.source || null,
            note: entry.note || null
          },
          create: {
            id: entry.id,
            giftCardId: card.id,
            bookingId: entry.bookingId || null,
            type: entry.type || "adjustment",
            amountCents: money(entry.amountCents),
            balanceCents: money(entry.balanceCents || card.balanceCents),
            source: entry.source || null,
            note: entry.note || null
          }
        });
      }
    }
  }, {
    maxWait: 10_000,
    timeout: 60_000
  });
}

async function readStore() {
  if (!USE_DATABASE) return readJsonStore();
  return readDatabaseStore();
}

async function writeStore(store) {
  if (!USE_DATABASE) return writeJsonStore(store);
  return writeDatabaseStore(store);
}

module.exports = {
  USE_DATABASE,
  readStore,
  writeStore,
  readJsonStore,
  writeJsonStore
};
