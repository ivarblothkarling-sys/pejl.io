// Server-only helper: send agency-client invite emails via Resend API.
const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Pejl <alerts@pejl.io>";

export type AgencyInviteEmailInput = {
  to: string;
  agencyName: string;
  clientName: string;
  acceptUrl: string;
};

export async function sendAgencyInviteEmail({
  to,
  agencyName,
  clientName,
  acceptUrl,
}: AgencyInviteEmailInput) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[agencyInviteEmail] Missing RESEND_API_KEY");
    return { ok: false as const, error: "missing_keys" };
  }

  const subject = `${agencyName} har bjudit in dig till Pejl`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 16px">Du är inbjuden till Pejl</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px">
        <strong>${agencyName}</strong> har bjudit in dig (som <strong>${clientName}</strong>) att koppla ditt konto i Pejl så att de kan se din likviditetsprognos.
      </p>
      <a href="${acceptUrl}"
         style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
        Acceptera inbjudan →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin-top:32px">
        Om du inte förväntade dig det här mejlet kan du ignorera det.
      </p>
    </div>
  `;

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
