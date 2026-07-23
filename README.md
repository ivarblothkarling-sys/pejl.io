# Pejl — Cash Flow Buddy

Likviditetsprognos i realtid för svenska småföretagare. Kopplar Fortnox + Tink, räknar 14–30 dagar framåt, varnar via mejl innan saldot går under vald gräns.

**Prod:** https://pejl.io  ·  **Preview:** https://pejl-cash-flow-buddy.lovable.app

## Stack

- **Frontend + backend:** [TanStack Start](https://tanstack.com/start) (React 19, Vite 7). SSR + server functions körs på Cloudflare Workers.
- **Databas + auth + storage:** Supabase (via Lovable Cloud, ingen egen dashboard behövs).
- **Styling:** Tailwind v4 + shadcn/ui. Semantiska tokens i `src/styles.css`.
- **AI:** Claude via Lovable AI Gateway (`LOVABLE_API_KEY`, ingen egen Anthropic-nyckel behövs).
- **Mejl:** Resend via Lovable-connector (`RESEND_API_KEY` injektas som env-var).
- **Integrationer:** Fortnox OAuth (bokföringsdata), Tink OAuth (banksaldo).
- **Betalning:** Stripe Checkout (`solo` 299 kr/mån, `solo_plus` 499 kr/mån, 30 dagars trial). Webhook på `/api/stripe-webhook` sätter `profiles.billing_status`.
- **Error monitoring:** Sentry (`@sentry/cloudflare` på servern, `@sentry/react` i klienten).

## Kom igång lokalt

```bash
bun install
bun run dev
# öppna http://localhost:8080
```

Node 20+ krävs. `bun` istället för npm/yarn eftersom lockfilen är `bun.lock`.

## Filstruktur

```
src/
├── routes/                    # File-based routing (TanStack)
│   ├── __root.tsx             # Head, providers, sidfot
│   ├── index.tsx              # Publik landningssida
│   ├── auth.tsx               # Login/signup + OAuth-knappar
│   ├── _authenticated/        # Skyddat subträd (ssr:false, redirect till /auth)
│   │   ├── route.tsx          # Auth-gate (AUTO-GENERERAD — rör ej)
│   │   ├── dashboard.tsx      # Huvudvy: prognos, KPI, chat
│   │   ├── onboarding.tsx     # 3-stegs wizard för nya konton
│   │   ├── installningar.tsx  # SIE-import, gränser, integrationer
│   │   ├── byra.tsx           # Konsultvy (grön/gul/röd klientlista)
│   │   └── admin.tsx          # Backoffice (endast admin-roll)
│   ├── auth.fortnox.callback.tsx  # OAuth callback
│   ├── auth.tink.callback.tsx     # OAuth callback
│   ├── share.$token.tsx           # Publik snapshot-länk
│   └── api/chat.ts                # AI-streaming endpoint
├── lib/
│   ├── api/*.functions.ts     # createServerFn — RPC från klient
│   ├── *.server.ts            # Server-only helpers (BLOCKED från client bundle)
│   ├── forecast.ts            # Kärnalgoritm — 14/30-dagars prognos
│   ├── accounting/sie.ts      # SIE-4-parser
│   └── i18n/                  # Svenska strängar + format
├── integrations/supabase/     # AUTO-GENERERAT — rör ej
└── components/ui/             # shadcn primitives
```

**Regler för `.server.ts`:**
- Får bara importeras från andra `.server.ts` eller inuti `.handler()`-block i `createServerFn`.
- Importeras du från en route eller komponent kraschar bygget (import-protection).

## Miljövariabler & secrets

Alla secrets finns i **Lovable Cloud → Secrets** och injektas som env-vars i server-runtime. Rör inte `.env` — den är auto-genererad.

| Namn | Källa | Syfte | Åtkomst |
|------|-------|-------|---------|
| `LOVABLE_API_KEY` | Auto | AI Gateway (Claude) + Resend gateway | Server |
| `RESEND_API_KEY` | Resend connector | Skickar likviditetsvarningar från `alerts@pejl.io` | Server |
| `FORTNOX_CLIENT_ID` / `_SECRET` | Fortnox Developer Portal | OAuth-app registrerad på Pejl | Server |
| `TINK_CLIENT_ID` / `_SECRET` | Tink Console (sandbox) | Bank-OAuth | Server |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Auto | Server Data API | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | `supabaseAdmin` — bypassar RLS | Server (kritisk) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Auto | Browser-klient | Publikt |
| `SENTRY_DSN` | Sentry-projekt | Error monitoring på servern (`@sentry/cloudflare` i `src/server.ts`) | Server |
| `VITE_SENTRY_DSN` | Sentry-projekt (samma DSN som ovan) | Error monitoring i browsern (`@sentry/react` i `src/router.tsx`) — måste ha `VITE_`-prefix för att nå klientbundlen, se regler ovan | Publikt (DSN:er är inte hemliga) |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Skapar Checkout Sessions (`lib/api/billing.functions.ts`) | Server (kritisk) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks (endpoint `/api/stripe-webhook`) | Verifierar att webhook-anrop verkligen kommer från Stripe | Server (kritisk) |

## Databas

9 tabeller i `public`, alla med RLS scoped på `auth.uid()`:

- `profiles` — 1:1 med `auth.users`. `current_balance`, `threshold`, `alert_email`, `include_pending_in_forecast`, onboarding-state.
- `transactions` — kända in-/utbetalningar (income/expense). `approval_status` = approved | pending_approval.
- `fortnox_connections`, `tink_connections` — OAuth tokens (encrypted at rest via Supabase).
- `chat_messages` — AI-chatthistorik per user.
- `share_tokens` — publika snapshot-länkar.
- `user_roles` — separat rolltabell (undviker privilege escalation). Enum: `admin`, `agency`.
- `agency_clients` — byråns klientlista.
- `provider_waitlist` — bankintresse.

Roll-kontroll sker via `private.has_role(user_id, role)` (SECURITY DEFINER i `private`-schema, inte exponerat via Data API).

## Kärnflöden

### Fortnox OAuth
1. `getFortnoxAuthUrl` (server fn) genererar auth-URL med HMAC-signerat `state` (`src/lib/fortnoxState.server.ts`).
2. Användaren klickar → hidden form med `target="_top"` bryter ut ur Lovable-preview-iframen.
3. `/auth/fortnox/callback` verifierar state, växlar code → tokens, sparar i `fortnox_connections` via `supabaseAdmin`.
4. `syncFortnoxForUser` hämtar riktiga fakturor, taggar `approval_status`, purge:ar mock-data.

### Tink OAuth
Samma pattern. Skillnad: Tink returnerar `bank_balance` som visas som primärt saldo på dashboarden. Avvikelse > 100 kr mot Fortnox-saldo triggar gul banner.

### Prognos
`computeForecast` i `src/lib/forecast.ts`:
- Startsaldo = bank_balance || current_balance
- Adderar/drar av kommande transaktioner ordnade efter `due_date`
- Returnerar `{ breachDate, breachAmount, minBalance, threshold }` för 14/30 dagar
- Om `include_pending_in_forecast=false` filtreras `pending_approval`-utgifter bort

### Mejlvarning
När `breachDate` inte är null triggas `sendLowBalanceEmail` (via Resend). Idempotent — samma användare varnas inte oftare än 1x/dygn (fältet `last_alert_sent`).

### AI-chat
`/api/chat` streamar från Claude via Lovable AI Gateway. System-prompten får forecast-context + användarens rådata (senaste 30 transaktioner). Proaktiva förslag genereras i dashboarden och skickas som första meddelande.

## Deploy

- **Push till main → Lovable syncar automatiskt** och publicerar preview på `pejl-cash-flow-buddy.lovable.app`.
- **Publicera prod** via Publish-knappen i Lovable-editorn (eller `POST /api/publish` från workspacet).
- Custom domains (pejl.io, www.pejl.io) pekar på Lovable via CNAME.

## Fällor att undvika

- **Rör aldrig** `src/integrations/supabase/{client,client.server,auth-middleware,auth-attacher,types}.ts` — auto-genereras.
- **Rör aldrig** `src/routes/_authenticated/route.tsx` — auto-hanteras av Supabase-integrationen.
- `supabaseAdmin` bypassar RLS. Använd bara efter roll-verifiering via `context.supabase.rpc(...)`.
- `redirect_uri` för OAuth måste whitelistas hos både **Fortnox Developer Portal** och **Tink Console** för varje domän ni testar från.
- Google-login går via `lovable.auth.signInWithOAuth` — inte raw `supabase.auth.signInWithOAuth`.
- Server functions får inte importera `.server.ts` på modul-toppnivå — `await import()` inuti `.handler()`.

## Vidare läsning

- `docs/ARCHITECTURE.md` — sekvensdiagram och djupare arkitektur.
- `docs/ACCESS.md` — checklista för att onboarda en ny utvecklare (secrets, GitHub, connectors).
- [TanStack Start docs](https://tanstack.com/start/latest)
- [Lovable Cloud docs](https://docs.lovable.dev/features/cloud)

## Kontakt

Ivar Blothkärling · ivarblothkarling@gmail.com · 070-310 56 44
Lucas Tikkanen · tikkanenco@gmail.com
