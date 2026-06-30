const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const STORE_FILE = path.join(__dirname, "..", "data", "store.json");

function cents(value) {
  return Math.round(Number(value || 0));
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function hashGiftCardCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim().toUpperCase()).digest("hex");
}

async function main() {
  const store = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));

  await prisma.siteSetting.upsert({
    where: { key: "business" },
    update: { value: store.business || {} },
    create: { key: "business", value: store.business || {} }
  });

  await prisma.siteSetting.upsert({
    where: { key: "site" },
    update: { value: store.site || {} },
    create: { key: "site", value: store.site || {} }
  });

  await prisma.siteSetting.upsert({
    where: { key: "settings" },
    update: { value: store.settings || {} },
    create: { key: "settings", value: store.settings || {} }
  });

  for (const resource of store.resources || []) {
    await prisma.resource.upsert({
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
    await prisma.addOn.upsert({
      where: { id: addOn.id },
      update: {
        name: addOn.name,
        description: addOn.description || null,
        priceCents: cents(addOn.priceCents),
        isActive: addOn.isActive !== false,
        metadata: addOn
      },
      create: {
        id: addOn.id,
        name: addOn.name,
        description: addOn.description || null,
        priceCents: cents(addOn.priceCents),
        isActive: addOn.isActive !== false,
        metadata: addOn
      }
    });
  }

  for (const experience of store.experiences || []) {
    await prisma.experience.upsert({
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
        reservationFeeCents: cents(experience.reservationFeeCents),
        basePriceCents: cents(experience.basePriceCents),
        imageUrl: experience.imageUrl || null,
        isPublic: experience.isPublic !== false,
        isPrivateEligible: Boolean(experience.isPrivateEligible),
        displayOrder: Number(experience.displayOrder || 0),
        projects: experience.projects || [],
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
        reservationFeeCents: cents(experience.reservationFeeCents),
        basePriceCents: cents(experience.basePriceCents),
        imageUrl: experience.imageUrl || null,
        isPublic: experience.isPublic !== false,
        isPrivateEligible: Boolean(experience.isPrivateEligible),
        displayOrder: Number(experience.displayOrder || 0),
        projects: experience.projects || [],
        includedItems: experience.includedItems || [],
        policies: experience.policies || {},
        metadata: experience
      }
    });

    for (const addOnId of experience.addOnIds || []) {
      await prisma.experienceAddOn.upsert({
        where: { experienceId_addOnId: { experienceId: experience.id, addOnId } },
        update: {},
        create: { experienceId: experience.id, addOnId }
      });
    }
  }

  for (const media of store.site?.media || []) {
    await prisma.mediaAsset.upsert({
      where: { id: media.id || slug(media.title) },
      update: {
        type: media.type === "video" ? "VIDEO" : "IMAGE",
        title: media.title || "Media asset",
        url: media.url,
        placement: media.placement || "gallery",
        source: media.source || "seed",
        driveFileId: media.driveFileId || null,
        metadata: media
      },
      create: {
        id: media.id || slug(media.title),
        type: media.type === "video" ? "VIDEO" : "IMAGE",
        title: media.title || "Media asset",
        url: media.url,
        placement: media.placement || "gallery",
        source: media.source || "seed",
        driveFileId: media.driveFileId || null,
        metadata: media
      }
    });
  }

  for (const discount of store.discounts || []) {
    await prisma.discount.upsert({
      where: { id: discount.id },
      update: {
        code: String(discount.code || discount.id).toUpperCase(),
        name: discount.name || discount.code || discount.id,
        type: discount.type === "fixed" ? "FIXED" : discount.type === "add_on" ? "ADD_ON" : "PERCENT",
        value: Number(discount.value || discount.percentOff || discount.amountCents || 0),
        status: discount.status || "active",
        startsAt: discount.startsAt ? new Date(discount.startsAt) : null,
        expiresAt: discount.expiresAt ? new Date(discount.expiresAt) : null,
        usageLimit: discount.usageLimit || null,
        perCustomerLimit: discount.perCustomerLimit || null,
        minimumSubtotalCents: discount.minimumSubtotalCents || null,
        eligibleExperienceIds: discount.eligibleExperienceIds || [],
        eligibleAddOnIds: discount.eligibleAddOnIds || [],
        stackable: Boolean(discount.stackable),
        metadata: discount
      },
      create: {
        id: discount.id,
        code: String(discount.code || discount.id).toUpperCase(),
        name: discount.name || discount.code || discount.id,
        type: discount.type === "fixed" ? "FIXED" : discount.type === "add_on" ? "ADD_ON" : "PERCENT",
        value: Number(discount.value || discount.percentOff || discount.amountCents || 0),
        status: discount.status || "active",
        startsAt: discount.startsAt ? new Date(discount.startsAt) : null,
        expiresAt: discount.expiresAt ? new Date(discount.expiresAt) : null,
        usageLimit: discount.usageLimit || null,
        perCustomerLimit: discount.perCustomerLimit || null,
        minimumSubtotalCents: discount.minimumSubtotalCents || null,
        eligibleExperienceIds: discount.eligibleExperienceIds || [],
        eligibleAddOnIds: discount.eligibleAddOnIds || [],
        stackable: Boolean(discount.stackable),
        metadata: discount
      }
    });
  }

  for (const giftCard of store.giftCards || []) {
    const code = String(giftCard.code || "").trim().toUpperCase();
    if (!code) continue;
    await prisma.giftCard.upsert({
      where: { codeHash: hashGiftCardCode(code) },
      update: {
        displayCode: code,
        codeLast4: code.slice(-4),
        status: giftCard.status === "void" ? "VOID" : giftCard.status === "inactive" ? "INACTIVE" : giftCard.status === "redeemed" ? "REDEEMED" : "ACTIVE",
        issuedCents: cents(giftCard.issuedCents || giftCard.balanceCents),
        balanceCents: cents(giftCard.balanceCents),
        holderName: giftCard.holderName || null,
        holderEmail: giftCard.holderEmail || null,
        holderPhone: giftCard.holderPhone || null,
        note: giftCard.note || null,
        expiresAt: giftCard.expiresAt ? new Date(giftCard.expiresAt) : null
      },
      create: {
        id: giftCard.id,
        codeHash: hashGiftCardCode(code),
        displayCode: code,
        codeLast4: code.slice(-4),
        status: giftCard.status === "void" ? "VOID" : giftCard.status === "inactive" ? "INACTIVE" : giftCard.status === "redeemed" ? "REDEEMED" : "ACTIVE",
        issuedCents: cents(giftCard.issuedCents || giftCard.balanceCents),
        balanceCents: cents(giftCard.balanceCents),
        holderName: giftCard.holderName || null,
        holderEmail: giftCard.holderEmail || null,
        holderPhone: giftCard.holderPhone || null,
        note: giftCard.note || null,
        expiresAt: giftCard.expiresAt ? new Date(giftCard.expiresAt) : null
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
