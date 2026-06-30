const crypto = require("crypto");
const { getPrisma } = require("./prisma");

const COOKIE_NAME = "spinart_session";
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 7);
const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const BOOTSTRAP_TOKEN = process.env.AUTH_BOOTSTRAP_TOKEN || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      cookies[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function cookieHeader(name, value, options = {}) {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", cookieHeader(COOKIE_NAME, token, { maxAge: SESSION_MAX_AGE_SECONDS }));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", cookieHeader(COOKIE_NAME, "", { maxAge: 0, expires: new Date(0) }));
}

function hashPassword(password, salt = base64Url(crypto.randomBytes(16))) {
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("base64");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(expectedHash, "base64");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function publicStaffUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: String(user.role || "EMPLOYEE").toLowerCase(),
    isActive: user.isActive
  };
}

async function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;

  const prisma = getPrisma();
  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { staffUser: true }
  });

  if (!session || session.expiresAt.getTime() <= Date.now() || !session.staffUser?.isActive) {
    if (session) await prisma.staffSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return publicStaffUser(session.staffUser);
}

async function createSession(res, user) {
  const prisma = getPrisma();
  const token = base64Url(crypto.randomBytes(32));
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.staffSession.create({
    data: {
      staffUserId: user.id,
      tokenHash: hashToken(token),
      expiresAt
    }
  });
  await prisma.staffUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });
  setSessionCookie(res, token);
}

async function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    await getPrisma().staffSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  clearSessionCookie(res);
}

async function authenticate(email, password) {
  const user = await getPrisma().staffUser.findUnique({
    where: { email: String(email || "").trim().toLowerCase() }
  });
  if (!user || !user.isActive || !verifyPassword(password, user.passwordSalt, user.passwordHash)) return null;
  return user;
}

async function staffCount() {
  return getPrisma().staffUser.count();
}

async function createStaffUser({ name, email, password, role = "EMPLOYEE" }) {
  const { salt, hash } = hashPassword(password);
  return getPrisma().staffUser.create({
    data: {
      name: String(name || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      role,
      passwordSalt: salt,
      passwordHash: hash
    }
  });
}

function canBootstrap(req, payload = {}) {
  if (BOOTSTRAP_TOKEN) return String(payload.bootstrapToken || req.headers["x-bootstrap-token"] || "") === BOOTSTRAP_TOKEN;
  return !IS_PRODUCTION;
}

function hasRole(user, roles) {
  if (!user) return false;
  const allowed = new Set(roles.map(role => String(role).toLowerCase()));
  return allowed.has(String(user.role || "").toLowerCase());
}

module.exports = {
  authenticate,
  canBootstrap,
  clearSessionCookie,
  createSession,
  createStaffUser,
  destroySession,
  getSessionUser,
  hasRole,
  publicStaffUser,
  staffCount
};
