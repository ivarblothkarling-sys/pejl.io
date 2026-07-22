// Ren mall-funktion för byrå-inbjudningsmejlet — inga secrets eller fetch här,
// så den kan importeras av både serverkoden som faktiskt skickar mejlet
// (agencyInviteEmail.server.ts) och UI:t som visar en förhandsgranskning.

export type AgencyInviteEmailContent = {
  agencyName: string;
  clientName: string;
  acceptUrl: string;
};

export function buildAgencyInviteEmail({
  agencyName,
  clientName,
  acceptUrl,
}: AgencyInviteEmailContent) {
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
  return { subject, html };
}
