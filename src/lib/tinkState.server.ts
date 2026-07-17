import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type TinkStatePayload = { userId: string; exp: number; nonce: string };

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const unb64 = (v: string) => Buffer.from(v, "base64url").toString("utf8");
const sign = (p: string, secret: string) =>
  createHmac("sha256", secret).update(p).digest("base64url");

export function createTinkState(userId: string, secret: string) {
  const payload: TinkStatePayload = {
    userId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const enc = b64(JSON.stringify(payload));
  return `${enc}.${sign(enc, secret)}`;
}

export function verifyTinkState(state: string, secret: string) {
  const [enc, sig] = state.split(".");
  if (!enc || !sig) throw new Error("Ogiltig Tink-state.");
  const expected = sign(enc, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new Error("Ogiltig Tink-state.");
  const payload = JSON.parse(unb64(enc)) as TinkStatePayload;
  if (!payload.userId || !payload.exp || payload.exp < Date.now())
    throw new Error("Tink-inloggningen hann gå ut. Starta kopplingen igen.");
  return payload;
}
