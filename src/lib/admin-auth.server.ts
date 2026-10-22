const COOKIE_NAME = "wpp_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function getAdminPassword(): string {
  return process.env["ADMIN_PASSWORD"] ?? "";
}

async function sign(value: string): Promise<string> {
  const password = getAdminPassword();
  if (!password) throw new Error("ADMIN_PASSWORD não está configurada.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function getCookie(request: Request): string | undefined {
  const value = request.headers.get("cookie") ?? "";
  return value
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
}

export async function isAdminRequest(request: Request): Promise<boolean> {
  if (!getAdminPassword()) return false;
  const token = getCookie(request);
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  const issuedAtNumber = Number(issuedAt);
  if (!issuedAt || !signature || !Number.isFinite(issuedAtNumber)) return false;
  if (
    Date.now() - issuedAtNumber > SESSION_MAX_AGE_SECONDS * 1000 ||
    issuedAtNumber > Date.now() + 60_000
  )
    return false;
  return constantTimeEqual(signature, await sign(issuedAt));
}

export async function createAdminSession(): Promise<string> {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${await sign(issuedAt)}`;
}

export function adminCookie(
  token: string,
  maxAge = SESSION_MAX_AGE_SECONDS,
  secure = true,
): string {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

export function adminLogoutCookie(secure = true): string {
  return adminCookie("", 0, secure);
}

export function isAdminPasswordConfigured(): boolean {
  return Boolean(getAdminPassword());
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const configured = getAdminPassword();
  if (!configured || !password) return false;
  return constantTimeEqual(password, configured);
}
