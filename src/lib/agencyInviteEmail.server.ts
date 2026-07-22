// Server-only helper: send agency-client invite emails via Resend API.
import { buildAgencyInviteEmail, type AgencyInviteEmailContent } from "./agencyInviteEmailTemplate";

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Pejl <alerts@pejl.io>";

export type AgencyInviteEmailInput = AgencyInviteEmailContent & { to: string };

export async function sendAgencyInviteEmail({ to, ...content }: AgencyInviteEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[agencyInviteEmail] Missing RESEND_API_KEY");
    return { ok: false as const, error: "missing_keys" };
  }

  const { subject, html } = buildAgencyInviteEmail(content);

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[agencyInviteEmail] Resend ${res.status}: ${body}`);
      return { ok: false as const, error: `resend_${res.status}` };
    }
    return { ok: true as const };
  } catch (err) {
    console.error("[agencyInviteEmail] fetch failed", err);
    return { ok: false as const, error: "fetch_failed" };
  }
}
