const state = {
  config: null,
  selectedExperienceId: null,
  selectedOccasionId: null
};

const dollars = cents => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: Number(cents || 0) % 100 === 0 ? 0 : 2,
  maximumFractionDigits: Number(cents || 0) % 100 === 0 ? 0 : 2
}).format((Number(cents) || 0) / 100);

const shortDateTime = iso => new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
}).format(new Date(iso));

const el = id => document.getElementById(id);

const heroActionWords = [
  { label: "Pour", color: "#f6c445" },
  { label: "Spin", color: "#16a3a8" },
  { label: "Splatter", color: "#f04f7f" }
];

const occasionOptions = [
  {
    id: "just-for-fun",
    label: "Just something fun to do",
    summary: "A bright, low-pressure outing when you want plans that feel different."
  },
  {
    id: "date-night",
    label: "Date night",
    summary: "Make something together, laugh through the messy part, and leave with a story."
  },
  {
    id: "anniversary",
    label: "Anniversary",
    summary: "A colorful way to celebrate without doing the same dinner reservation again."
  },
  {
    id: "birthday",
    label: "Birthday",
    summary: "Built for photos, friends, family, and a take-home piece made by the guest of honor."
  },
  {
    id: "corporate-team",
    label: "Corporate event / team building",
    summary: "A hosted creative session for coworkers, teams, schools, clubs, and groups."
  }
];

const weekdayOptions = [
  ["0", "Sun"],
  ["1", "Mon"],
  ["2", "Tue"],
  ["3", "Wed"],
  ["4", "Thu"],
  ["5", "Fri"],
  ["6", "Sat"]
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function selectedExperience() {
  return state.config.experiences.find(experience => experience.id === state.selectedExperienceId);
}

function selectedOccasion() {
  return occasionOptions.find(occasion => occasion.id === state.selectedOccasionId);
}

function selectedAddOns() {
  return [...document.querySelectorAll("[data-addon]:checked")].map(input => input.value);
}

function selectedProject() {
  const input = document.querySelector("[data-project]:checked");
  return input ? input.value : "";
}

function addOnsForExperience(experience) {
  return state.config.addOns.filter(addOn => experience.addOnIds.includes(addOn.id));
}

function isPerGuest(experience) {
  return experience.pricingType === "per_guest";
}

function usesGroupWaiver(experience) {
  return ["group-events", "private-events"].includes(experience.id);
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function setValue(id, value) {
  const node = el(id);
  if (node) node.value = value;
}

function renderHeroCopy(copy, occasions = []) {
  const target = el("heroText");
  if (!target) return;

  target.innerHTML = `
    <strong class="hero-promise">${copy}</strong>
  `;
}

function renderOccasionTicker(occasions = []) {
  const target = el("occasionTicker");
  if (!target) return;

  const occasionItems = occasions.map(item => item.trim()).filter(Boolean);
  const labels = occasionItems.length ? occasionItems : ["Date nights", "Birthdays", "Team building"];
  const group = labels.map(item => `<span>${item}</span>`).join("");
  target.innerHTML = `
    <div class="occasion-track" aria-hidden="true">
      <div>${group}</div>
      <div>${group}</div>
    </div>
  `;
}

function renderSharedBrand() {
  const logoUrl = state.config.site.hero.logoUrl || "/assets/spin-art-logo.png";
  if (el("navLogo")) el("navLogo").src = logoUrl;
}

function renderLandingBrand() {
  const { site } = state.config;
  setText("heroHeadline", site.hero.headline);
  renderHeroCopy(site.hero.copy, site.hero.occasions || []);
  renderOccasionTicker(site.hero.occasions || []);

  if (el("heroLogo")) el("heroLogo").src = site.hero.logoUrl || "/assets/spin-art-logo.png";
  initHeroMediaRotator();

  const firstExperience = state.config.experiences[0];
  if (firstExperience) {
    setText("heroBookingTitle", firstExperience.name);
    setText(
      "heroBookingMeta",
      `${firstExperience.durationMinutes} minutes | ${firstExperience.minGuests}-${firstExperience.maxGuests} guests | from ${dollars(firstExperience.basePriceCents)}`
    );
  }
}

function heroMediaItems() {
  const { site } = state.config;
  const items = [
    { type: "image", url: site.hero.imageUrl, title: "Hero image" },
    ...(site.media || [])
  ].filter(item => (
    item.url &&
    item.type !== "video" &&
    item.id !== "tumbler-process" &&
    item.url !== "/assets/spin-art-gallery-extra-01-web.jpg"
  ));

  return items.filter((item, index, all) => (
    all.findIndex(candidate => candidate.url === item.url) === index
  ));
}

function showHeroMedia(item) {
  const heroMedia = el("heroMedia");
  const heroVideo = el("heroVideo");
  if (!heroMedia || !heroVideo || !item) return;

  if (item.type === "video") {
    if (heroVideo.getAttribute("src") !== item.url) {
      heroVideo.src = item.url;
    }
    heroVideo.hidden = false;
    heroVideo.play().catch(() => {});
    heroMedia.style.opacity = 0;
    return;
  }

  heroMedia.style.backgroundImage = `url("${item.url}")`;
  heroMedia.style.opacity = 1;
  heroVideo.pause();
  heroVideo.hidden = true;
}

function initHeroMediaRotator() {
  const items = heroMediaItems();
  if (!items.length) return;

  let index = 0;
  showHeroMedia(items[index]);

  if (items.length < 2) return;
  window.setInterval(() => {
    index = (index + 1) % items.length;
    showHeroMedia(items[index]);
  }, 5200);
}

function initHeroActionWord() {
  const target = el("heroActionWord");
  if (!target) return;

  let index = 0;
  const updateWord = () => {
    const word = heroActionWords[index % heroActionWords.length];
    target.textContent = word.label;
    target.style.color = word.color;
    index += 1;
  };

  updateWord();
  window.setInterval(updateWord, 1700);
}

function renderMediaStrip() {
  const target = el("mediaStrip");
  if (!target) return;

  const media = state.config.site.media || [];
  const expandedMedia = [...media, ...media].slice(0, 6);
  target.innerHTML = expandedMedia.map(item => {
    const mediaEl = item.type === "video"
      ? `<video src="${item.url}" autoplay muted loop playsinline></video>`
      : `<img src="${item.url}" alt="">`;
    return `
      <article class="media-tile">
        ${mediaEl}
        <span>${item.title}</span>
      </article>
    `;
  }).join("");
}

function renderExperienceCards() {
  const target = el("experienceCards");
  if (!target) return;

  target.innerHTML = state.config.experiences.map(experience => `
    <a class="experience-card" href="/book.html?experience=${encodeURIComponent(experience.id)}" style="--experience-image: url('${experience.imageUrl}')" aria-label="Book ${experience.name}">
      <img src="${experience.imageUrl}" alt="">
      <div>
        <span class="ticket-kicker">${experience.durationMinutes} min | reservation fee ${isPerGuest(experience) ? `${dollars(experience.depositCents)} / guest` : `${dollars(experience.depositCents)}`}</span>
        <h3>${experience.name}</h3>
        <p>${experience.summary}</p>
        <div class="ticket-footer">
          <strong>${experience.minGuests}-${experience.maxGuests} guests</strong>
          <span class="tile-cue">Book this</span>
        </div>
      </div>
    </a>
  `).join("");
}

function renderOccasionPage() {
  const experience = selectedExperience();
  const target = el("occasionOptions");
  if (!experience || !target) return;

  setText("occasionExperienceName", experience.name);
  setText("occasionExperienceSummary", experience.summary);
  setText("occasionExperienceMeta", `${experience.durationMinutes} min | ${isPerGuest(experience) ? `${dollars(experience.basePriceCents)} / guest` : `${dollars(experience.basePriceCents)} base`}`);

  const visual = el("occasionVisual");
  if (visual) visual.style.backgroundImage = `url("${experience.imageUrl}")`;

  target.innerHTML = occasionOptions.map(occasion => `
    <a class="occasion-card" href="/book.html?experience=${encodeURIComponent(experience.id)}&occasion=${encodeURIComponent(occasion.id)}">
      <strong>${occasion.label}</strong>
    </a>
  `).join("");
}

function renderContentSections() {
  const content = el("contentSections");
  const faq = el("faqList");

  if (content) {
    content.innerHTML = state.config.site.sections.map(section => `
      <article class="content-block">
        <p class="eyebrow">${section.id.replaceAll("-", " ")}</p>
        <h2>${section.title}</h2>
        <p>${section.body}</p>
      </article>
    `).join("");
  }

  if (faq) {
    faq.innerHTML = state.config.site.faqs.map(item => `
      <div class="faq-item">
        <h3>${item.question}</h3>
        <p>${item.answer}</p>
      </div>
    `).join("");
  }
}

function calculateTotal() {
  const experience = selectedExperience();
  const guestInput = el("guestInput");
  const guests = Number(guestInput ? guestInput.value : 0);
  if (!experience) return 0;

  const addOnTotal = selectedAddOns().reduce((sum, addOnId) => {
    const addOn = state.config.addOns.find(item => item.id === addOnId);
    return sum + (addOn ? addOn.priceCents : 0);
  }, 0);

  const projectId = selectedProject();
  const project = (experience.projectOptions || []).find(item => item.id === projectId);
  const projectTotal = project ? Number(project.priceCents || 0) : 0;
  const base = isPerGuest(experience)
    ? experience.basePriceCents * guests
    : experience.basePriceCents;
  return base + (projectTotal + addOnTotal) * guests;
}

function calculateTax(subtotalCents) {
  const rate = Number(state.config?.settings?.taxRateBps || 0);
  return Math.round((Number(subtotalCents) || 0) * rate / 10000);
}

function pricingBreakdown() {
  const subtotal = calculateTotal();
  const tax = calculateTax(subtotal);
  const total = subtotal + tax;
  const dueNowSubtotal = amountDueNowSubtotal();
  const dueNowTax = calculateTax(dueNowSubtotal);
  const dueNow = dueNowSubtotal + dueNowTax;
  return {
    subtotal,
    tax,
    total,
    dueNowSubtotal,
    dueNowTax,
    dueNow,
    balance: Math.max(0, total - dueNow)
  };
}

function reservationFeeTotal() {
  const experience = selectedExperience();
  const guestInput = el("guestInput");
  const guests = Number(guestInput ? guestInput.value : 0);
  if (!experience) return 0;
  return isPerGuest(experience)
    ? experience.depositCents * guests
    : experience.depositCents;
}

function amountDueNowSubtotal() {
  return el("paymentMode")?.value === "pay_full"
    ? calculateTotal()
    : reservationFeeTotal();
}

function updatePrice() {
  const pricePill = el("pricePill");
  if (!pricePill || !selectedExperience()) return;
  const breakdown = pricingBreakdown();
  pricePill.textContent = `${dollars(breakdown.dueNow)} due now incl. tax | ${dollars(breakdown.total)} total`;
}

function renderExperiencePicker() {
  const target = el("experienceList");
  if (!target) return;

  target.innerHTML = state.config.experiences.map(experience => `
    <button type="button" class="experience-option ${experience.id === state.selectedExperienceId ? "active" : ""}" data-experience-id="${experience.id}">
      <img src="${experience.imageUrl}" alt="">
      <span class="experience-option-copy">
        <strong>${experience.name}</strong>
        <span>${experience.summary}</span>
        <span>${experience.durationMinutes} min | reservation fee ${dollars(experience.depositCents)}${isPerGuest(experience) ? " per guest" : ""}</span>
      </span>
    </button>
  `).join("");

  document.querySelectorAll("[data-experience-id]").forEach(button => {
    button.addEventListener("click", async () => {
      state.selectedExperienceId = button.dataset.experienceId;
      renderExperiencePicker();
      renderOccasionField();
      renderProjectOptions();
      renderAddOns();
      renderWaiverFields();
      renderBookingIntro();
      syncGuestBounds();
      await loadAvailability();
      updatePrice();
    });
  });
}

function renderBookingIntro() {
  const experience = selectedExperience();
  if (!experience) return;

  const occasion = selectedOccasion();
  setText("bookingIntroTitle", experience.name);
  setText(
    "bookingIntroCopy",
    `${occasion ? `${occasion.label}: ` : ""}${experience.summary} ${experience.durationMinutes} minutes | ${experience.minGuests}-${experience.maxGuests} guests | reservation fee ${dollars(experience.depositCents)}.`
  );

  const image = el("bookingIntroImage");
  if (image) image.src = experience.imageUrl;
}

function renderOccasionField() {
  const target = el("occasionInput");
  if (!target) return;

  target.innerHTML = [
    `<option value="">Select occasion</option>`,
    ...occasionOptions.map(occasion => `<option value="${occasion.id}">${occasion.label}</option>`),
    `<option value="other">Other</option>`
  ].join("");
  target.value = state.selectedOccasionId || "";
}

function renderProjectOptions() {
  const target = el("projectList");
  const experience = selectedExperience();
  if (!target || !experience) return;

  const projects = experience.projectOptions || [];
  target.innerHTML = projects.length ? projects.map((project, index) => `
    <label class="choice-card">
      <input type="radio" name="projectOption" data-project value="${project.id}" ${index === 0 ? "checked" : ""}>
      <span>
        <strong>${project.name}</strong>
        <small>${project.description}${project.priceCents ? ` | +${dollars(project.priceCents)}` : ""}</small>
      </span>
    </label>
  `).join("") : "<p>Project options will be confirmed with the studio.</p>";

  document.querySelectorAll("[data-project]").forEach(input => {
    input.addEventListener("change", updatePrice);
  });
}

function renderAddOns() {
  const target = el("addonList");
  if (!target) return;

  const experience = selectedExperience();
  const addOns = addOnsForExperience(experience);
  target.innerHTML = addOns.length ? addOns.map(addOn => `
    <label class="addon choice-card">
      <input type="checkbox" data-addon value="${addOn.id}">
      <span><strong>${addOn.name} | ${dollars(addOn.priceCents)}</strong><br>${addOn.description}</span>
    </label>
  `).join("") : "<p>No add-ons for this experience.</p>";

  document.querySelectorAll("[data-addon]").forEach(input => {
    input.addEventListener("change", updatePrice);
  });
}

function renderWaiverFields() {
  const target = el("waiverFields");
  const experience = selectedExperience();
  if (!target || !experience) return;

  if (usesGroupWaiver(experience)) {
    target.innerHTML = `
      <label class="waiver-check">
        <input type="checkbox" id="waiverInput" required>
        <span>I understand every participant must complete a waiver before the experience. A parent or guardian must sign for minors.</span>
      </label>
    `;
    return;
  }

  const guestCount = Math.max(1, Number(el("guestInput")?.value || experience.minGuests || 1));
  target.innerHTML = Array.from({ length: guestCount }, (_, index) => {
    const number = index + 1;
    return `
      <article class="participant-waiver-card" data-waiver-card="${index}">
        <h3>Participant ${number}</h3>
        <div class="field-grid waiver-grid">
          <label>
            Participant name
            <input type="text" data-waiver-field="participantName" autocomplete="name" required>
          </label>
          <label>
            Date of birth
            <input type="date" data-waiver-field="participantDateOfBirth" required>
          </label>
          <label>
            Participant type
            <select data-waiver-field="participantType" required>
              <option value="adult">Adult participant</option>
              <option value="minor">Minor participant - parent/guardian signing</option>
            </select>
          </label>
          <label>
            Street address
            <input type="text" data-waiver-field="street" autocomplete="street-address" required>
          </label>
          <label>
            City
            <input type="text" data-waiver-field="city" autocomplete="address-level2" required>
          </label>
          <label>
            State
            <input type="text" data-waiver-field="state" autocomplete="address-level1" maxlength="2" required>
          </label>
          <label>
            ZIP
            <input type="text" data-waiver-field="zip" autocomplete="postal-code" required>
          </label>
        </div>
        <div class="field-grid waiver-guardian-fields" data-guardian-fields hidden>
          <label>
            Parent/guardian name
            <input type="text" data-waiver-field="guardianName" autocomplete="name">
          </label>
          <label>
            Relationship to minor
            <input type="text" data-waiver-field="guardianRelationship">
          </label>
        </div>
        <div class="waiver-copy">
          <p>I understand this is a hands-on paint experience with wet paint, splatter, movement, tools, and studio surfaces that may be slippery or messy.</p>
          <p>I agree to follow staff instructions, wear provided protective gear when required, and accept responsibility for personal belongings and clothing.</p>
        </div>
        <label class="waiver-check">
          <input type="checkbox" data-waiver-field="riskAccepted" required>
          <span>I acknowledge the activity risks and agree to participate safely.</span>
        </label>
        <label class="waiver-check">
          <input type="checkbox" data-waiver-field="photoReleaseAccepted">
          <span>Spin Art Raleigh may use photos or videos from this visit for marketing. I can ask staff not to photograph this participant.</span>
        </label>
        <label>
          Type full name as signature
          <input type="text" data-waiver-field="signature" required>
        </label>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-waiver-card]").forEach(card => {
    const participantType = card.querySelector("[data-waiver-field='participantType']");
    const guardianFields = card.querySelector("[data-guardian-fields]");
    const syncGuardianFields = () => {
      const isMinor = participantType.value === "minor";
      guardianFields.hidden = !isMinor;
      guardianFields.querySelectorAll("input").forEach(input => {
        input.required = isMinor;
      });
    };
    participantType.addEventListener("change", syncGuardianFields);
    syncGuardianFields();
  });
}

function participantWaivers() {
  return [...document.querySelectorAll("[data-waiver-card]")].map(card => {
    const value = field => card.querySelector(`[data-waiver-field='${field}']`)?.value.trim() || "";
    const checked = field => Boolean(card.querySelector(`[data-waiver-field='${field}']`)?.checked);
    return {
      type: "individual",
      participantName: value("participantName"),
      participantDateOfBirth: value("participantDateOfBirth"),
      participantType: value("participantType") || "adult",
      address: {
        street: value("street"),
        city: value("city"),
        state: value("state"),
        zip: value("zip")
      },
      guardianName: value("guardianName"),
      guardianRelationship: value("guardianRelationship"),
      riskAccepted: checked("riskAccepted"),
      photoReleaseAccepted: checked("photoReleaseAccepted"),
      signature: value("signature")
    };
  });
}

function syncGuestBounds() {
  const experience = selectedExperience();
  const guestInput = el("guestInput");
  if (!experience || !guestInput) return;

  guestInput.min = experience.minGuests;
  guestInput.max = experience.maxGuests;
  guestInput.value = Math.max(experience.minGuests, Number(guestInput.value || experience.minGuests));
}

async function loadAvailability() {
  const dateInput = el("dateInput");
  const timeInput = el("timeInput");
  const experience = selectedExperience();
  if (!dateInput || !timeInput || !dateInput.value || !experience) return;

  const payload = await api(`/api/availability?experienceId=${encodeURIComponent(experience.id)}&date=${encodeURIComponent(dateInput.value)}`);
  const available = payload.slots.filter(slot => slot.isAvailable);
  timeInput.innerHTML = available.length
    ? available.map(slot => `<option value="${slot.time}">${slot.time} | ${slot.remaining} spots</option>`).join("")
    : "<option value=\"\">No available times</option>";
}

async function submitBooking(event) {
  event.preventDefault();
  const experience = selectedExperience();
  setText("bookingStatus", "Reserving...");
  renderPaymentPanel(null, null);

  try {
    const payload = {
      experienceId: experience.id,
      date: el("dateInput").value,
      time: el("timeInput").value,
      guestCount: Number(el("guestInput").value),
      addOnIds: selectedAddOns(),
      projectId: selectedProject(),
      projectName: document.querySelector("[data-project]:checked")?.closest("label")?.querySelector("strong")?.textContent || "",
      occasion: selectedOccasion()?.label || (el("occasionInput")?.value === "other" ? "Other" : ""),
      occasionId: state.selectedOccasionId || el("occasionInput")?.value || "",
      waiverAccepted: usesGroupWaiver(experience)
        ? Boolean(el("waiverInput")?.checked)
        : participantWaivers().every(waiver => waiver.riskAccepted && waiver.signature),
      waiver: usesGroupWaiver(experience) ? {
        type: "group_acknowledgement",
        accepted: Boolean(el("waiverInput")?.checked)
      } : null,
      waivers: usesGroupWaiver(experience) ? [] : participantWaivers(),
      paymentMode: el("paymentMode").value,
      customer: {
        name: el("nameInput").value,
        email: el("emailInput").value,
        phone: el("phoneInput").value
      },
      notes: el("notesInput").value
    };

    const result = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.payment?.status === "pending") {
      setText(
        "bookingStatus",
        `Almost there. Complete payment to confirm ${result.booking.experienceName} for ${shortDateTime(result.booking.startsAt)}.`
      );
      renderPaymentPanel(result.payment, result.booking);
    } else {
      setText(
        "bookingStatus",
        `Confirmed ${result.booking.experienceName} for ${shortDateTime(result.booking.startsAt)}.`
      );
    }
    event.target.reset();
    setDefaultDate();
    syncGuestBounds();
    renderProjectOptions();
    renderAddOns();
    renderWaiverFields();
    await loadAvailability();
  } catch (error) {
    setText("bookingStatus", error.message);
  }
}

function renderPaymentPanel(payment, booking) {
  const target = el("paymentPanel");
  if (!target) return;

  if (!payment || !booking) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }

  const isMock = payment.provider === "mock";
  target.hidden = false;
  target.innerHTML = `
    <div>
      <p class="eyebrow">Checkout</p>
      <h3>${dollars(payment.amountCents)} due now</h3>
      <p>${dollars(payment.subtotalCents)} subtotal + ${dollars(payment.taxCents)} tax. ${booking.balanceCents ? `${dollars(booking.balanceCents)} remaining balance can be paid in store.` : "Paid in full after checkout."}</p>
    </div>
    ${isMock
      ? `<button type="button" data-mock-pay="${payment.id}">Complete mock payment</button>`
      : `<a class="button-link" href="${payment.checkoutUrl}">Continue to Square</a>`}
  `;

  target.querySelector("[data-mock-pay]")?.addEventListener("click", async buttonEvent => {
    const button = buttonEvent.currentTarget;
    button.disabled = true;
    button.textContent = "Processing...";
    try {
      const result = await api(`/api/payments/${button.dataset.mockPay}/mock-confirm`, { method: "POST" });
      setText(
        "bookingStatus",
        `Payment complete. ${result.booking.experienceName} is confirmed for ${shortDateTime(result.booking.startsAt)}.`
      );
      renderPaymentPanel(null, null);
      await loadAvailability();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Complete mock payment";
      setText("bookingStatus", error.message);
    }
  });
}

function setDefaultDate() {
  const dateInput = el("dateInput");
  if (!dateInput) return;
  const date = new Date();
  date.setDate(date.getDate() + 1);
  dateInput.value = date.toISOString().slice(0, 10);
}

function hydrateAdminContentFields() {
  const { site } = state.config;
  setValue("editHeadline", site.hero.headline);
  setValue("editCopy", site.hero.copy);
  setValue("editImage", site.hero.imageUrl);
  setValue("editVideo", site.hero.videoUrl || "");
  setValue("editLogo", site.hero.logoUrl || "");
}

async function loadAdmin() {
  const admin = await api("/api/admin");
  const bookings = admin.bookings;
  const payments = admin.payments || [];
  const target = el("adminBookings");
  if (!target) return;

  const confirmed = bookings.filter(booking => !["cancelled", "failed"].includes(booking.status)).length;
  const unsigned = bookings.filter(booking => booking.waiverStatus !== "signed" && booking.status !== "cancelled").length;
  const revenue = bookings
    .filter(booking => ["paid", "checked_in", "completed", "confirmed"].includes(booking.status))
    .reduce((sum, booking) => sum + Number(booking.amountDueNowCents || booking.depositCents || 0), 0);
  const pendingPayments = payments.filter(payment => payment.status === "pending").length;

  if (el("adminStats")) {
    el("adminStats").innerHTML = `
      <div class="admin-stat"><strong>${confirmed}</strong><span>active bookings</span></div>
      <div class="admin-stat"><strong>${pendingPayments}</strong><span>pending payments</span></div>
      <div class="admin-stat"><strong>${unsigned}</strong><span>waivers to review</span></div>
      <div class="admin-stat"><strong>${dollars(revenue)}</strong><span>paid online</span></div>
    `;
  }

  target.innerHTML = bookings.length ? bookings.map(booking => `
    <article class="booking-row">
      <header>
        <strong>${booking.customer.name}</strong>
        <small>${booking.status.replaceAll("_", " ")}</small>
      </header>
      <div>
        ${booking.experienceName}<br>
        <small>${shortDateTime(booking.startsAt)} | ${booking.guestCount} guests | ${dollars(booking.totalCents)} total</small><br>
        ${booking.projectName ? `<small>Project: ${booking.projectName}</small><br>` : ""}
        ${booking.occasion ? `<small>Occasion: ${booking.occasion}</small><br>` : ""}
        <small>Payment: ${(booking.paymentStatus || booking.status).replaceAll("_", " ")} | Due now: ${dollars(booking.amountDueNowCents || booking.depositCents)} | Tax: ${dollars(booking.taxCents || 0)} | Balance: ${dollars(booking.balanceCents)}</small><br>
        <small>Waiver: ${booking.waiverStatus.replaceAll("_", " ")}</small>
      </div>
      <div class="booking-actions">
        <button type="button" data-booking="${booking.id}" data-status="checked_in">Check in</button>
        <button type="button" data-booking="${booking.id}" data-waiver="signed">Mark waiver signed</button>
        <button type="button" data-booking="${booking.id}" data-status="cancelled">Cancel</button>
      </div>
    </article>
  `).join("") : "<p>No bookings yet.</p>";

  document.querySelectorAll("[data-booking]").forEach(button => {
    button.addEventListener("click", async () => {
      const body = button.dataset.status
        ? { status: button.dataset.status }
        : { waiverStatus: button.dataset.waiver };
      await api(`/api/bookings/${button.dataset.booking}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await loadAdmin();
    });
  });
}

async function saveContent() {
  setText("contentStatus", "Saving...");
  const updatedSite = {
    ...state.config.site,
    hero: {
      ...state.config.site.hero,
      headline: el("editHeadline").value,
      copy: el("editCopy").value,
      imageUrl: el("editImage").value,
      videoUrl: el("editVideo").value,
      logoUrl: el("editLogo").value
    }
  };

  state.config = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ site: updatedSite })
  });

  renderSharedBrand();
  hydrateAdminContentFields();
  setText("contentStatus", "Saved.");
}

async function saveSchedule() {
  state.config = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      resources: state.config.resources,
      schedule: state.config.schedule
    })
  });
  setText("scheduleStatus", "Schedule saved.");
}

function hydrateScheduleForms() {
  const resourceOptions = state.config.resources.map(resource => `<option value="${resource.id}">${resource.name}</option>`).join("");
  const experienceOptions = state.config.experiences.map(experience => `<option value="${experience.id}">${experience.name}</option>`).join("");
  if (el("ruleResource")) el("ruleResource").innerHTML = resourceOptions;
  if (el("blackoutResource")) el("blackoutResource").innerHTML = resourceOptions;
  if (el("ruleExperience")) el("ruleExperience").innerHTML = experienceOptions;
  if (el("ruleDays")) {
    el("ruleDays").innerHTML = weekdayOptions.map(([value, label]) => `
      <label class="weekday-choice">
        <input type="checkbox" value="${value}" ${["0", "1", "2", "3", "4", "5", "6"].includes(value) ? "checked" : ""}>
        <span>${label}</span>
      </label>
    `).join("");
  }
}

function renderScheduleAdmin() {
  if (!el("resourceList")) return;
  const schedule = state.config.schedule || { availabilityRules: [], blackouts: [] };

  el("resourceList").innerHTML = state.config.resources.map(resource => `
    <article class="schedule-row">
      <div>
        <strong>${resource.name}</strong>
        <span>${resource.capacity} capacity | ${resource.isExclusive ? "exclusive" : "shared"} | ${resource.experienceIds.map(id => state.config.experiences.find(exp => exp.id === id)?.name || id).join(", ")}</span>
      </div>
    </article>
  `).join("");

  el("availabilityRuleList").innerHTML = (schedule.availabilityRules || []).map(rule => `
    <article class="schedule-row">
      <div>
        <strong>${rule.name}</strong>
        <span>${resourceName(rule.resourceId)} | ${(rule.experienceIds || []).map(experienceName).join(", ")} | ${daysLabel(rule.daysOfWeek)} | ${rule.startTime}-${rule.endTime} | every ${rule.slotIntervalMinutes} min | notice ${rule.minNoticeMinutes} min</span>
      </div>
      <button type="button" data-delete-rule="${rule.id}">Delete</button>
    </article>
  `).join("") || "<p>No availability rules yet.</p>";

  el("blackoutList").innerHTML = (schedule.blackouts || []).map(blackout => `
    <article class="schedule-row">
      <div>
        <strong>${blackout.date} | ${blackout.startTime}-${blackout.endTime}</strong>
        <span>${resourceName(blackout.resourceId)}${blackout.reason ? ` | ${blackout.reason}` : ""}</span>
      </div>
      <button type="button" data-delete-blackout="${blackout.id}">Delete</button>
    </article>
  `).join("") || "<p>No blackouts yet.</p>";

  document.querySelectorAll("[data-delete-rule]").forEach(button => {
    button.addEventListener("click", async () => {
      state.config.schedule.availabilityRules = state.config.schedule.availabilityRules.filter(rule => rule.id !== button.dataset.deleteRule);
      await saveSchedule();
      renderScheduleAdmin();
    });
  });

  document.querySelectorAll("[data-delete-blackout]").forEach(button => {
    button.addEventListener("click", async () => {
      state.config.schedule.blackouts = state.config.schedule.blackouts.filter(blackout => blackout.id !== button.dataset.deleteBlackout);
      await saveSchedule();
      renderScheduleAdmin();
    });
  });
}

function resourceName(resourceId) {
  return state.config.resources.find(resource => resource.id === resourceId)?.name || resourceId;
}

function experienceName(experienceId) {
  return state.config.experiences.find(experience => experience.id === experienceId)?.name || experienceId;
}

function daysLabel(days = []) {
  return days.map(day => weekdayOptions.find(([value]) => Number(value) === Number(day))?.[1] || day).join(", ");
}

function setDefaultEmployeeDate() {
  const dateInput = el("employeeDate");
  const appointmentDate = el("employeeAppointmentDate");
  const today = new Date().toISOString().slice(0, 10);
  if (dateInput) dateInput.value = today;
  if (appointmentDate) appointmentDate.value = today;
}

function employeeFormExperience() {
  const experienceId = el("employeeExperienceInput")?.value;
  return state.config.experiences.find(experience => experience.id === experienceId);
}

function hydrateEmployeeBookingForm() {
  const experienceInput = el("employeeExperienceInput");
  if (!experienceInput) return;

  experienceInput.innerHTML = state.config.experiences.map(experience => `
    <option value="${experience.id}">${experience.name}</option>
  `).join("");
  syncEmployeeGuestBounds();
}

function syncEmployeeGuestBounds() {
  const experience = employeeFormExperience();
  const guestInput = el("employeeGuestInput");
  if (!experience || !guestInput) return;
  guestInput.min = experience.minGuests;
  guestInput.max = experience.maxGuests;
  guestInput.value = Math.min(
    experience.maxGuests,
    Math.max(experience.minGuests, Number(guestInput.value || experience.minGuests))
  );
}

function resourceCapacityLabel(resource) {
  return `${resource.calendarLabel || resource.name} (${resource.capacity})`;
}

function resourceCapacityUnit(resource) {
  return resource.capacityUnit || (resource.capacityMode === "bookings" ? "bookings" : "spots");
}

function activeCellClass(cell) {
  if (cell.booked <= 0) return "is-open";
  if (cell.available <= 0) return "is-full";
  return "is-partial";
}

async function loadEmployeeDay() {
  const date = el("employeeDate")?.value || new Date().toISOString().slice(0, 10);
  const payload = await api(`/api/employee/day?date=${encodeURIComponent(date)}`);
  renderEmployeeCalendar(payload);
}

async function loadEmployeeAppointmentAvailability() {
  const experience = employeeFormExperience();
  const date = el("employeeAppointmentDate")?.value;
  const timeInput = el("employeeAppointmentTime");
  if (!experience || !date || !timeInput) return;

  const payload = await api(`/api/availability?experienceId=${encodeURIComponent(experience.id)}&date=${encodeURIComponent(date)}`);
  const available = payload.slots.filter(slot => slot.isAvailable);
  const resource = state.config.resources.find(item => item.id === experience.resourceId);
  const unit = resource ? resourceCapacityUnit(resource) : "slots";
  timeInput.innerHTML = available.length
    ? available.map(slot => `<option value="${slot.time}">${slot.time} | ${slot.remaining} ${unit} available</option>`).join("")
    : "<option value=\"\">No available times</option>";
}

function experienceForResource(resourceId) {
  const priority = ["spin", "tumblers", "splatter", "private-events", "group-events", "pour-art"];
  return priority
    .map(id => state.config.experiences.find(experience => experience.id === id))
    .find(experience => experience?.resourceId === resourceId) ||
    state.config.experiences.find(experience => experience.resourceId === resourceId);
}

function renderEmployeeCalendar(day) {
  const target = el("employeeCalendar");
  if (!target) return;

  target.style.setProperty("--resource-count", String(day.resources.length || 1));
  target.innerHTML = `
    <div class="employee-calendar-corner">Time</div>
    ${day.resources.map(resource => `
      <div class="employee-calendar-head">
        <strong>${resourceCapacityLabel(resource)}</strong>
        <span>${resourceCapacityUnit(resource)}</span>
      </div>
    `).join("")}
    ${day.rows.map(row => `
      <div class="employee-time">${row.time}</div>
      ${row.cells.map(cell => `
        <button type="button" class="employee-cell ${activeCellClass(cell)}" data-time="${row.time}" data-resource="${cell.resourceId}">
          <strong>${cell.booked}/${cell.capacity}</strong>
          <span>${cell.available} available</span>
        </button>
      `).join("")}
    `).join("")}
  `;

  target.querySelectorAll("[data-resource]").forEach(button => {
    button.addEventListener("click", () => {
      const row = day.rows.find(item => item.time === button.dataset.time);
      const resource = day.resources.find(item => item.id === button.dataset.resource);
      const cell = row?.cells.find(item => item.resourceId === button.dataset.resource);
      const experience = experienceForResource(button.dataset.resource);
      if (el("employeeAppointmentDate")) el("employeeAppointmentDate").value = day.date;
      if (experience && el("employeeExperienceInput")) {
        el("employeeExperienceInput").value = experience.id;
        syncEmployeeGuestBounds();
        loadEmployeeAppointmentAvailability().then(() => {
          if (el("employeeAppointmentTime")) el("employeeAppointmentTime").value = button.dataset.time;
        }).catch(error => setText("employeeBookingStatus", error.message));
      }
      renderEmployeeDetail(day.date, row, resource, cell);
    });
  });
}

function renderEmployeeDetail(date, row, resource, cell) {
  const target = el("employeeDetail");
  if (!target || !row || !resource || !cell) return;

  target.innerHTML = `
    <p class="eyebrow">${date} at ${row.time}</p>
    <h2>${resourceCapacityLabel(resource)}</h2>
    <div class="employee-detail-metric">
      <strong>${cell.booked}/${cell.capacity}</strong>
      <span>${cell.available} ${resourceCapacityUnit(resource)} available</span>
    </div>
    <div class="employee-detail-bookings">
      ${cell.bookings.length ? cell.bookings.map(booking => `
        <article>
          <header>
            <strong>${booking.customer.name}</strong>
            <small>${booking.status.replaceAll("_", " ")}</small>
          </header>
          <p>${booking.experienceName} | ${booking.guestCount} guests</p>
          ${booking.projectName ? `<p>Project: ${booking.projectName}</p>` : ""}
          ${booking.occasion ? `<p>Occasion: ${booking.occasion}</p>` : ""}
          <p>Payment: ${(booking.paymentStatus || booking.status).replaceAll("_", " ")} | Waiver: ${booking.waiverStatus.replaceAll("_", " ")}</p>
        </article>
      `).join("") : "<p>No bookings in this period.</p>"}
    </div>
  `;
}

async function submitEmployeeAppointment(event) {
  event.preventDefault();
  const experience = employeeFormExperience();
  setText("employeeBookingStatus", "Adding appointment...");

  try {
    const payload = {
      experienceId: experience.id,
      date: el("employeeAppointmentDate").value,
      time: el("employeeAppointmentTime").value,
      guestCount: Number(el("employeeGuestInput").value),
      customer: {
        name: el("employeeNameInput").value,
        phone: el("employeePhoneInput").value,
        email: el("employeeEmailInput").value
      },
      notes: el("employeeNotesInput").value
    };

    const result = await api("/api/employee/bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setText("employeeBookingStatus", `Added ${result.booking.experienceName} for ${shortDateTime(result.booking.startsAt)}.`);
    event.target.reset();
    setDefaultEmployeeDate();
    hydrateEmployeeBookingForm();
    await loadEmployeeAppointmentAvailability();
    await loadEmployeeDay();
  } catch (error) {
    setText("employeeBookingStatus", error.message);
  }
}

function selectedRuleDays() {
  return [...document.querySelectorAll("#ruleDays input:checked")].map(input => Number(input.value));
}

async function addAvailabilityRule(event) {
  event.preventDefault();
  state.config.schedule = state.config.schedule || { availabilityRules: [], blackouts: [] };
  state.config.schedule.availabilityRules.push({
    id: `rule-${Date.now()}`,
    name: el("ruleName").value.trim(),
    resourceId: el("ruleResource").value,
    experienceIds: [el("ruleExperience").value],
    daysOfWeek: selectedRuleDays(),
    startTime: el("ruleStart").value,
    endTime: el("ruleEnd").value,
    slotIntervalMinutes: Number(el("ruleInterval").value),
    minNoticeMinutes: Number(el("ruleNotice").value),
    isActive: true
  });
  await saveSchedule();
  event.target.reset();
  hydrateScheduleForms();
  renderScheduleAdmin();
}

async function addBlackout(event) {
  event.preventDefault();
  state.config.schedule = state.config.schedule || { availabilityRules: [], blackouts: [] };
  state.config.schedule.blackouts.push({
    id: `blackout-${Date.now()}`,
    resourceId: el("blackoutResource").value,
    date: el("blackoutDate").value,
    startTime: el("blackoutStart").value,
    endTime: el("blackoutEnd").value,
    reason: el("blackoutReason").value.trim()
  });
  await saveSchedule();
  event.target.reset();
  hydrateScheduleForms();
  renderScheduleAdmin();
}

async function initLanding() {
  renderLandingBrand();
  initHeroActionWord();
  renderMediaStrip();
  renderExperienceCards();
  renderContentSections();
}

async function initBooking() {
  const params = new URLSearchParams(window.location.search);
  const requestedExperience = params.get("experience");
  const requestedOccasion = params.get("occasion");
  if (requestedExperience && state.config.experiences.some(experience => experience.id === requestedExperience)) {
    state.selectedExperienceId = requestedExperience;
  }
  if (requestedOccasion && occasionOptions.some(occasion => occasion.id === requestedOccasion)) {
    state.selectedOccasionId = requestedOccasion;
  }

  setDefaultDate();
  setText("policyText", state.config.policies.cancellation);
  renderOccasionField();
  renderExperiencePicker();
  renderBookingIntro();
  renderProjectOptions();
  renderAddOns();
  renderWaiverFields();
  syncGuestBounds();
  updatePrice();
  await loadAvailability();

  el("dateInput").addEventListener("change", loadAvailability);
  el("guestInput").addEventListener("input", () => {
    updatePrice();
    renderWaiverFields();
  });
  el("paymentMode").addEventListener("change", updatePrice);
  el("occasionInput").addEventListener("change", () => {
    state.selectedOccasionId = el("occasionInput").value;
    renderBookingIntro();
  });
  el("bookingForm").addEventListener("submit", submitBooking);
}

async function initAdmin() {
  hydrateAdminContentFields();
  hydrateScheduleForms();
  await loadAdmin();
  renderScheduleAdmin();

  el("refreshAdmin").addEventListener("click", loadAdmin);
  el("saveContent").addEventListener("click", saveContent);
  el("availabilityRuleForm").addEventListener("submit", addAvailabilityRule);
  el("blackoutForm").addEventListener("submit", addBlackout);
}

async function initEmployee() {
  setDefaultEmployeeDate();
  hydrateEmployeeBookingForm();
  await loadEmployeeAppointmentAvailability();
  await loadEmployeeDay();
  el("employeeDate").addEventListener("change", loadEmployeeDay);
  el("employeeAppointmentDate").addEventListener("change", loadEmployeeAppointmentAvailability);
  el("employeeExperienceInput").addEventListener("change", async () => {
    syncEmployeeGuestBounds();
    await loadEmployeeAppointmentAvailability();
  });
  el("employeeGuestInput").addEventListener("input", syncEmployeeGuestBounds);
  el("employeeBookingForm").addEventListener("submit", submitEmployeeAppointment);
  el("refreshEmployee").addEventListener("click", loadEmployeeDay);
}

async function init() {
  state.config = await api("/api/config");
  state.selectedExperienceId = state.config.experiences[0].id;
  renderSharedBrand();

  const page = document.body.dataset.page;
  if (page === "occasion") {
    const params = new URLSearchParams(window.location.search);
    const requestedExperience = params.get("experience");
    if (requestedExperience && state.config.experiences.some(experience => experience.id === requestedExperience)) {
      state.selectedExperienceId = requestedExperience;
    }
    renderOccasionPage();
  }
  if (page === "landing") await initLanding();
  if (page === "booking") await initBooking();
  if (page === "admin") await initAdmin();
  if (page === "employee") await initEmployee();
}

init().catch(error => {
  document.body.innerHTML = `<main class="section"><h1>Could not load booking app</h1><p>${error.message}</p></main>`;
});
