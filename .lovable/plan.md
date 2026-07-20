# Backoffice för Lucas

Fyra leveranser så Lucas kan klona, köra lokalt och drifta Pejl.

## 1. Teknisk README + setup-guide

Ersätter/utökar rot-`README.md` med:
- Stack-översikt: TanStack Start (React 19 + Vite 7) på Cloudflare Workers, Supabase (Lovable Cloud), Tailwind v4.
- Kör lokalt: `bun install` → `bun run dev` → localhost:8080.
- Filstruktur: `src/routes/` (file-based routing), `src/lib/api/*.functions.ts` (server functions), `src/lib/*.server.ts` (server-only), `src/integrations/supabase/` (auto-genererat — rör ej).
- Miljövariabler: fullständig lista över alla secrets (LOVABLE_API_KEY, FORTNOX_*, TINK_*, RESEND_API_KEY, SUPABASE_*) med förklaring, källa och om de är public/server-only.
- Databasmodell: kort översikt av alla 9 tabellerna + RLS-strategi (auth.uid()-scoped, `user_roles`/`has_role` för admin).
- Integrationer: hur Fortnox OAuth, Tink OAuth, Resend, Lovable AI Gateway (Claude) fungerar — inkl. state-token HMAC-flödet, redirect_uri-hantering och `supabaseAdmin` vs `requireSupabaseAuth`.
- Deploy: hur Lovable publicerar, hur push till GitHub synkar tillbaka, produktions-URL:er.
- Vanliga fällor: `.server.ts` får inte importeras client-side, `supabaseAdmin` bara efter role-check, `redirect_uri` måste whitelistas hos Fortnox/Tink.

Skapar även `docs/ARCHITECTURE.md` med djupare arkitekturbeskrivning + sekvensdiagram (ASCII) för OAuth-flödena och prognos-beräkningen.

## 2. GitHub-koppling + access

Kan inte kopplas åt dig automatiskt — GitHub-appen kräver din OAuth-godkänning. Levererar:
- Skriftlig steg-för-steg-guide i README: Plus (+) → GitHub → Connect project → skapa repo → bjud in `tikkanenco` som collaborator på GitHub.com under Settings → Collaborators.
- Förklaring av två-vägs-syncen (push till GitHub → syncar automatiskt till Lovable och tvärtom).
- Rekommendation att Lucas jobbar i egen branch och mergar via PR för att undvika kollisioner med Lovable-editorn.

## 3. Admin-panel i appen (`/admin`)

Skyddad route bakom `has_role(user, 'admin')`. Överbyggnad på befintlig `user_roles`-tabell (rollen `admin` finns redan i enumen).

Vyer:
- **Översikt**: antal användare, antal aktiva Fortnox/Tink-kopplingar, antal transaktioner totalt, senaste 10 signups.
- **Användare**: tabell med email, `company_name`, roll, `current_balance`, `threshold`, om Fortnox/Tink är kopplat, skapad, senaste sync. Sök på email.
- **Användardetalj**: alla transaktioner för användaren, möjlighet att trigga manuell Fortnox/Tink-sync, växla admin/agency-roll, radera testdata.
- **Systemhälsa**: senaste chattmeddelanden (för att debugga AI-svar), pending share_tokens, provider_waitlist-inlägg.

Server functions i `src/lib/api/admin.functions.ts`:
- `listUsers`, `getUserDetails`, `triggerUserSync`, `toggleUserRole`, `getSystemStats`.
- Alla använder `requireSupabaseAuth` + verifierar admin-roll via `context.supabase.rpc('has_role', ...)` innan `supabaseAdmin` laddas in.

Migration: Ger `ivarblothkarling@gmail.com` och `tikkanenco@gmail.com` admin-rollen så ni båda kommer åt panelen.

Länk till `/admin` läggs till i dashboarden bara för admins (samma pattern som `/byra`).

## 4. Connector- och secret-access checklista

Skapar `docs/ACCESS.md` med exakt vad du (som workspace-owner) behöver göra för att Lucas ska kunna bygga och deploya:

- **Lovable workspace**: bjud in tikkanenco@gmail.com till workspacet under Settings → People med rollen Editor eller Admin. Detta ger automatisk access till Lovable Cloud + Lovable AI Gateway.
- **Resend connector**: dela access i Connectors → Resend → Permissions.
- **Fortnox secrets**: FORTNOX_CLIENT_ID/SECRET är redan i Cloud → Secrets och nås av alla workspace-medlemmar automatiskt. Lägg till hans Lovable-domäner som redirect_uri i Fortnox Developer Portal.
- **Tink secrets**: samma sak, plus lägga till redirect_uris i Tink Console (som redan är påbörjat).
- **GitHub**: Lucas som collaborator på repot (från punkt 2).
- **Domän**: om han ska deploya egen preview på pejl.io behöver DNS-access — annars kör han på Lovable-preview-URL:en.

## Tekniska detaljer

Filer som skapas/ändras:
```text
README.md                                    (skrivs om)
docs/ARCHITECTURE.md                         (ny)
docs/ACCESS.md                               (ny)
src/routes/_authenticated/admin.tsx          (ny — översikt)
src/routes/_authenticated/admin.users.tsx    (ny — användarlista)
src/routes/_authenticated/admin.users.$id.tsx (ny — detalj)
src/lib/api/admin.functions.ts               (ny)
src/routes/_authenticated/dashboard.tsx      (patch — visa /admin-länk för admins)
supabase migration                           (grant admin-roll till er två)
```

Ingen ändring i befintliga OAuth-flöden, prognoslogik eller AI-chatt.

## Ordning

1. README + docs (snabbast, blockerar inget).
2. Admin-migration + roll-grant.
3. Admin-server functions.
4. Admin-UI (3 routes).
5. Dashboard-länk.
6. Kort meddelande med exakta klick-steg för GitHub-koppling och Resend-access (kan inte automatiseras).