# Access-checklista — onboarda en ny utvecklare

Följ i ordning. Punkt 1–2 räcker för att köra lokalt och pusha kod; 3–5 för fullt drift-läge.

## 1. Lovable workspace-access

Utan detta ser hen inte projektet i sidopanelen.

1. Logga in på https://lovable.dev som workspace-owner.
2. Klicka på workspace-loggan uppe till vänster → **Settings** → **People**.
3. Klicka **Invite member** → skriv `tikkanenco@gmail.com` → välj rollen **Editor** (eller Admin om hen ska hantera billing/secrets).
4. Hen får mejl med inbjudan → accepterar → syns nu i projektlistan.

Detta ger automatiskt:
- Åtkomst till Lovable Cloud (Supabase-backend).
- Åtkomst till Lovable AI Gateway (`LOVABLE_API_KEY`) för Claude-anrop.
- Åtkomst till alla runtime-secrets som är kopplade till projektet.

## 2. GitHub-koppling

Kan inte automatiseras — GitHub-appen kräver din OAuth-godkänning.

**Steg för Ivar (workspace-owner):**
1. Öppna projektet i Lovable → klicka **+** (plus) i chattinputen nere till vänster → **GitHub** → **Connect project**.
2. Auktorisera Lovable GitHub-appen på det GitHub-konto/org du vill lagra koden hos.
3. Klicka **Create Repository** → välj namn (t.ex. `pejl-cash-flow-buddy`) → skapa.
4. Två-vägs-syncen är nu aktiv: kod som skrivs i Lovable pushas direkt, och push från GitHub syncar tillbaka.

**Steg för att bjuda in Lucas:**
1. Gå till repot på github.com → **Settings** → **Collaborators and teams**.
2. Klicka **Add people** → skriv `tikkanenco` (eller hans GitHub-användarnamn) → välj rollen **Write** eller **Admin**.
3. Hen får mejl → accepterar → kan klona:
   ```bash
   git clone git@github.com:<org>/pejl-cash-flow-buddy.git
   cd pejl-cash-flow-buddy
   bun install
   bun run dev
   ```

**Rekommenderat arbetssätt:**
- Lucas jobbar i feature-branches lokalt, öppnar PR mot `main`.
- Undvik att båda editera samma fil samtidigt i Lovable + IDE — Lovable-editorn kan skriva över lokala ändringar innan de pushats.
- När Lovable-editorn används: låt den auto-sync köra klart innan lokal pull.

## 3. Connector-access

Runtime-connectors (Resend, m.fl.) delas separat från workspace-medlemskapet.

### Resend

Behövs för att skicka likviditetsvarningar. Utan detta funkar allt utom mejl.

1. Klicka på din workspace-logga (uppe till vänster utanför projektet) → **Connectors**.
2. Klicka på Resend-raden.
3. Öppna fliken **Permissions** (eller **Access / Members**).
4. Lägg till `tikkanenco@gmail.com` → spara.

## 4. Tredjepartsprovider-nycklar

Dessa är secrets, inte connectors — de nås automatiskt av alla workspace-medlemmar via env-vars i server-kod. Ingen extra delning behövs, men Lucas behöver whitelistas i providerns dashboards:

### Fortnox Developer Portal
1. Logga in på https://developer.fortnox.se med Ivars konto.
2. Öppna Pejl-appen (den med `FORTNOX_CLIENT_ID`).
3. Under **Redirect URIs** — säkerställ att dessa finns:
   - `https://pejl.io/auth/fortnox/callback`
   - `https://www.pejl.io/auth/fortnox/callback`
   - `https://pejl-cash-flow-buddy.lovable.app/auth/fortnox/callback`
   - Lucas lokala preview-URL om han testar lokalt (t.ex. `http://localhost:8080/auth/fortnox/callback`)
4. För att Lucas ska kunna redigera appen — Fortnox stödjer endast ett ägar-konto. Antingen delar ni inloggningen, eller så ligger appen kvar hos Ivar och Lucas ber om ändringar.

### Tink Console (sandbox)
1. Logga in på https://console.tink.com med Ivars konto.
2. Öppna appen med `TINK_CLIENT_ID` = `b7a2bff9b13d4a9499eaa186549a2794`.
3. Under **Redirect URIs** — säkerställ:
   - `https://pejl.io/auth/tink/callback`
   - `https://www.pejl.io/auth/tink/callback`
   - `https://pejl-cash-flow-buddy.lovable.app/auth/tink/callback`
4. För att bjuda in Lucas som team-medlem: **Team** → **Invite** → `tikkanenco@gmail.com`.

## 5. Admin-rollen i appen

Både Ivar och Lucas har redan admin-rollen tilldelad i `user_roles`-tabellen (via migration). Backoffice-panelen finns på:

**https://pejl.io/admin** (eller motsvarande preview-URL)

Där kan ni:
- Se alla registrerade användare.
- Toggle admin/agency-roll för andra konton.
- Radera mock- eller testdata per användare.
- Se antal aktiva Fortnox/Tink-kopplingar.
- Se senaste registreringar.

## 6. Custom domän (frivilligt)

Om Lucas ska deploya egen preview på `pejl.io`:

1. DNS-recordsen ligger hos Ivars registrar (Loopia/One.com/liknande).
2. Antingen ger Ivar Lucas DNS-access, eller så kör Lucas allt på Lovable-preview-URL:en (`*.lovable.app`) och rör inte prod-domänen förrän ni släpper.

## Snabb checklista

- [ ] Bjudit in `tikkanenco@gmail.com` till Lovable-workspacet
- [ ] Kopplat projektet till GitHub
- [ ] Lagt till Lucas som GitHub-collaborator
- [ ] Delat Resend-connectorn
- [ ] Verifierat Fortnox redirect-URIs
- [ ] Verifierat Tink redirect-URIs
- [ ] Admin-rollen fungerar (Lucas kan öppna `/admin`)

När allt ovan är gjort — Lucas klonar repot, kör `bun install && bun run dev`, och är i gång.
