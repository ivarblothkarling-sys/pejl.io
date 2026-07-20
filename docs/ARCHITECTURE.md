# Pejl — arkitektur

## Systemöversikt

```text
             ┌──────────────────┐
             │   Browser (SPA)  │
             │  TanStack Router │
             └────────┬─────────┘
                      │  RPC (createServerFn) + Supabase Realtime
                      ▼
        ┌─────────────────────────────┐
        │  Cloudflare Worker (SSR)    │
        │  TanStack Start · Vite 7    │
        │  ─ Server functions         │
        │  ─ /api/chat streaming      │
        │  ─ OAuth callbacks          │
        └──┬──────────┬────────┬──────┘
           │          │        │
           ▼          ▼        ▼
     ┌────────┐  ┌────────┐ ┌──────────────┐
     │Supabase│  │Fortnox │ │ Lovable AI   │
     │ (Cloud)│  │ / Tink │ │ Gateway →    │
     │ ─ DB   │  │ REST   │ │ Anthropic    │
     │ ─ Auth │  └────────┘ │ Claude       │
     │ ─ RLS  │             └──────────────┘
     └────────┘
```

## Datamodell (förkortad)

```text
auth.users ─┬─ profiles (1:1)
            ├─ transactions (1:N)
            ├─ fortnox_connections (0..1)
            ├─ tink_connections (0..1)
            ├─ chat_messages (1:N)
            ├─ share_tokens (1:N)
            └─ user_roles (1:N) ──► app_role enum {admin, agency}
                                    │
                                    └─ private.has_role() ← SECURITY DEFINER
```

Alla user-owned tabeller: RLS `USING (auth.uid() = user_id)`, GRANTs till `authenticated` + `service_role`. Ingen `anon`-access på user-data.

## Fortnox OAuth-flöde

```text
Dashboard          Server (createServerFn)      Fortnox
    │                     │                        │
    │ getFortnoxAuthUrl   │                        │
    │────────────────────►│                        │
    │                     │ HMAC(state, secret)    │
    │◄─── auth_url ───────│                        │
    │                                              │
    │ form.submit target="_top"                    │
    │─────────────────────────────────────────────►│
    │                                              │
    │◄──── redirect?code=...&state=... ────────────│
    │                                              │
    │  /auth/fortnox/callback                      │
    │──────────► verify HMAC(state)                │
    │            exchange code→tokens              │
    │            supabaseAdmin.upsert(...)         │
    │            syncFortnoxForUser(userId)        │
    │                     │  fetch invoices        │
    │                     │───────────────────────►│
    │                     │◄── invoices JSON ──────│
    │                     │  delete mocks          │
    │                     │  insert transactions   │
    │◄── /dashboard (grön banner) ─────────────────│
```

Tink följer exakt samma pattern, plus att `getBankBalance` sätter `tink_connections.bank_balance` som visas som primärt saldo.

## Prognos-algoritm

```text
computeForecast(profile, transactions, days=14):
  startBalance = profile.bank_balance ?? profile.current_balance
  running = startBalance
  minBalance = startBalance
  breachDate = null
  breachAmount = null

  for tx in transactions
        .filter(due_date within [today, today+days])
        .filter(include_pending || approval_status = 'approved')
        .sort(due_date asc):
    running += tx.kind === 'income' ? tx.amount : -tx.amount
    if running < minBalance: minBalance = running
    if running < profile.threshold && !breachDate:
      breachDate = tx.due_date
      breachAmount = running

  return { startBalance, minBalance, breachDate, breachAmount, threshold }
```

`breachDate != null` triggar (a) röd banner i UI, (b) mejlvarning via Resend (1x/dygn/user), (c) proaktivt AI-chattmeddelande.

## AI-chatt (`/api/chat`)

Server route (inte server fn — behöver streaming):

```text
POST /api/chat
├─ requireSupabaseAuth (bearer)
├─ Läser senaste 30 transaktioner + profile
├─ System prompt = "Du är Pejl, en likviditetsassistent..."
│                + forecast summary
│                + transaction JSON
├─ createOpenAICompatible → Lovable AI Gateway → anthropic/claude-sonnet-4
├─ streamText → SSE till klient
└─ Sparar assistant-svar i chat_messages när stream stängs
```

Klienten (`useChat`) skickar hela historiken varje request så modellens "minne" bygger på message array — ingen server-side state.

## Roll-hierarki

```text
authenticated (default)
    │
    ├─ agency  → åtkomst till /byra + agency_clients (RLS: agency_user_id = auth.uid())
    │
    └─ admin   → åtkomst till /admin (backoffice: alla users, alla transactions)
                 verifierat via user_roles-tabell (assertAdmin i admin.functions.ts)
```

Rollcheck sker ALLTID via SECURITY DEFINER-funktion i `private`-schema eller genom RLS-scoped select på `user_roles` — aldrig genom att läsa fältet från client-side.

## Vad ligger var (backend-logik)

| Domän | Filer | Notering |
|-------|-------|----------|
| Prognos | `lib/forecast.ts` | Ren funktion, testbar |
| Fortnox | `lib/api/fortnox.functions.ts`, `lib/fortnoxApi.server.ts`, `lib/fortnoxState.server.ts` | State-HMAC + token refresh |
| Tink | `lib/api/tink.functions.ts`, `lib/tinkApi.server.ts`, `lib/tinkState.server.ts` | Sandbox default |
| Bokföring/SIE | `lib/accounting/*` | Provider-abstraktion (Fortnox, SIE-file) |
| AI | `routes/api/chat.ts`, `lib/ai-gateway.server.ts` | Streaming, run-id forwarding |
| Mejl | `lib/emailAlert.server.ts` | Resend via Lovable gateway |
| Admin | `lib/api/admin.functions.ts`, `routes/_authenticated/admin.tsx` | Kräver admin-roll |
| Delning | `lib/api/share.functions.ts`, `routes/share.$token.tsx` | Anonym read via supabaseAdmin |

## Vanliga uppgifter

- **Ny server fn** — skapa `src/lib/api/<domän>.functions.ts`, exportera `createServerFn().middleware([requireSupabaseAuth]).inputValidator(z...).handler(...)`. Anropas från klient via `useServerFn(fn)`.
- **Ny protected route** — lägg fil under `src/routes/_authenticated/`, routeTree.gen.ts uppdateras automatiskt.
- **Ny publik route** — lägg fil direkt i `src/routes/`, sätt SEO i `head()`.
- **Schema-ändring** — kör migration via Lovable Cloud-verktyget, inte manuell SQL i Supabase-UI.
- **Rensa mock-data för alla users** — `DELETE FROM transactions WHERE source = 'mock'` via admin-panelen eller SQL.
