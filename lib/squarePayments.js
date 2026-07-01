const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || "";
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || "";
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox";
const SQUARE_API_VERSION = process.env.SQUARE_API_VERSION || "2026-06-18";
const SQUARE_BASE_URL = SQUARE_ENVIRONMENT === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";

function isSquareConfigured() {
  return Boolean(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);
}

function isSquareEmbeddedConfigured() {
  return Boolean(process.env.SQUARE_APP_ID && SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);
}

function squareMoney(amountCents, currency = "USD") {
  return {
    amount: Math.round(Number(amountCents || 0)),
    currency
  };
}

async function createSquarePaymentLink({ payment, booking, business, origin }) {
  if (!isSquareConfigured()) {
    throw new Error("Square credentials are not configured.");
  }

  const redirectBase = process.env.SQUARE_REDIRECT_BASE_URL || origin || "http://localhost:4280";
  const redirectUrl = `${redirectBase.replace(/\/$/, "")}/book.html?payment=${encodeURIComponent(payment.id)}&booking=${encodeURIComponent(booking.id)}`;
  const description = `${business?.name || "Spin Art Raleigh"} booking ${booking.id}`;

  const response = await fetch(`${SQUARE_BASE_URL}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION
    },
    body: JSON.stringify({
      idempotency_key: payment.id,
      description,
      quick_pay: {
        name: `${booking.experienceName || "Spin Art"} reservation`,
        price_money: squareMoney(payment.amountCents, payment.currency || "USD"),
        location_id: SQUARE_LOCATION_ID
      },
      checkout_options: {
        redirect_url: redirectUrl,
        ask_for_shipping_address: false
      },
      payment_note: description
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.errors?.[0]?.detail || payload.errors?.[0]?.code || `Square checkout failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const link = payload.payment_link || {};
  payment.providerPaymentId = link.id || payload.payment_link?.order_id || null;
  payment.squareOrderId = link.order_id || null;
  payment.checkoutUrl = link.url || null;
  payment.squarePaymentLink = link;
  return payment;
}

async function createSquareCardPayment({ payment, booking, sourceId }) {
  if (!isSquareConfigured()) {
    throw new Error("Square credentials are not configured.");
  }
  if (!sourceId) {
    throw new Error("Square card token is required.");
  }

  const description = `${booking.experienceName || "Spin Art"} reservation ${booking.id}`;
  const response = await fetch(`${SQUARE_BASE_URL}/v2/payments`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION
    },
    body: JSON.stringify({
      idempotency_key: `${payment.id}-${Date.now()}`,
      source_id: sourceId,
      amount_money: squareMoney(payment.amountCents, payment.currency || "USD"),
      location_id: SQUARE_LOCATION_ID,
      reference_id: payment.id.slice(0, 40),
      note: description,
      buyer_email_address: booking.customer?.email || undefined
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.errors?.[0]?.detail || payload.errors?.[0]?.code || `Square payment failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const squarePayment = payload.payment || {};
  payment.providerPaymentId = squarePayment.id || null;
  payment.squarePayment = squarePayment;
  return payment;
}

module.exports = {
  createSquarePaymentLink,
  createSquareCardPayment,
  isSquareEmbeddedConfigured,
  isSquareConfigured
};
