import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type FortnoxStatePayload = {
  userId: string;
  exp: number;
  nonce: string;
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createFortnoxState(userId: string, secret: string) {
  const payload: FortnoxStatePayload = {
    userId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyFortnoxState(state: string, secret: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Ogiltig Fortnox-state.");

  const expected = signPayload(encodedPayload, secret);
  if (!signaturesMatch(signature, expected)) {
    throw new Error("Ogiltig Fortnox-state.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as FortnoxStatePayload;
  if (!payload.userId || !payload.exp || payload.exp < Date.now()) {
    throw new Error("Fortnox-inloggningen hann gå ut. Starta kopplingen igen.");
  }

  return payload;
}