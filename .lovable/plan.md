## Mål
Förbereda Pejl för global expansion genom att införa ett provider-agnostiskt abstraktionslager, konfigurerbar valuta/språk/land, och multi-provider settings-UI — utan att bryta nuvarande Fortnox-flöde (som idag är mockdata).

## 1. Abstraktionslager – `src/lib/accounting/`

```text
src/lib/accounting/
  types.ts                 // Invoice, SupplierInvoice, Transaction, CompanyInfo, AccountBalance
  accountingService.ts     // provider-agnostiskt API (default: fortnox)
  providers/
    fortnox.ts             // nuvarande mock-baserad implementation
    tripletex.ts           // stub (throw NotImplemented)
    xero.ts                // stub
    quickbooks.ts          // stub
```

`accountingService.ts` exponerar:
- `getInvoices()`, `getSupplierInvoices()`, `getAccountBalance()`, `getTransactions()`, `getCompanyInfo()`
- Väljer provider utifrån användarens `profiles.accounting_provider`.

Nuvarande `finance.functions.ts` refaktoreras minimalt: dashboard-datat läses fortfarande via befintlig logik, men eventuella "hämta från Fortnox"-anrop går genom servicen. Ingen förändring av mockdata-innehåll.

## 2. Databasändringar (migration)
Utöka `profiles` med:
- `accounting_provider text not null default 'fortnox'`
- `currency text not null default 'SEK'`
- `country text not null default 'SE'`
- `language text not null default 'sv'`

Ny tabell `provider_waitlist(id, user_id, provider, created_at)` för "notify me"-knappen.

## 3. Inställningssida – `/installningar`
Route under `_authenticated`. Tre sektioner:
- **Bokföringssystem**: 4 kort med flagga (🇸🇪🇳🇴🇬🇧🇺🇸), Fortnox valbar (kopplad), övriga disabled med "Kommer snart" + "Notifiera mig"-knapp (skriver till `provider_waitlist`).
- **Valuta**: dropdown SEK/NOK/GBP/EUR/USD.
- **Språk**: Svenska / English.

## 4. Valuta & lokalisering – `src/lib/i18n/`
- `formatCurrency(amount, currency)` — ersätter hårdkodad `kr`-suffix i dashboard och chatt.
- `useUserLocale()` hook läser profil → returnerar `{ currency, language, country }`.
- Alla `${x} kr`-strängar i dashboard, tax-sektion, chatt byts till `formatCurrency`.

## 5. Skattelogik per land – `src/lib/tax.ts`
Refaktor från hårdkodad SE-logik till lookup:

```ts
const TAX_RULES: Record<Country, TaxRule[]> = {
  SE: [ { type: 'moms', rate: 0.25, dueDay: 26, label: 'Momsdeklaration' },
        { type: 'employer', dueDay: 12, label: 'Arbetsgivaravgifter' },
        { type: 'f-skatt', dueDay: 12, label: 'F-skatt' } ],
  NO: [], // placeholder MVA
  GB: [], // placeholder VAT
  US: [], // placeholder Sales Tax
};
```
`getUpcomingTaxes(country, ...)` väljer regelset. SE fortsätter fungera identiskt.

## 6. Språkstöd – lätt i18n
`src/lib/i18n/strings.ts` med `sv` (komplett) och `en` (komplett översättning av alla synliga UI-texter i dashboard, auth, settings, tax-sektion, integritetspolicy förblir sv). `useT()` hook: `t('dashboard.forecast_title')`.

Fas 1: översätt dashboard, settings, tax-sektion, chatt-placeholders. Behåll svensk copy som default.

## Filer som skapas
- `src/lib/accounting/types.ts`
- `src/lib/accounting/accountingService.ts`
- `src/lib/accounting/providers/{fortnox,tripletex,xero,quickbooks}.ts`
- `src/lib/i18n/{strings.ts,format.ts,useT.ts}`
- `src/lib/api/settings.functions.ts` (updateProviderSettings, joinWaitlist)
- `src/routes/_authenticated/installningar.tsx`
- Migration för profiles + provider_waitlist

## Filer som ändras
- `src/lib/tax.ts` – multi-country lookup
- `src/routes/_authenticated/index.tsx` – använd `formatCurrency` + `useT`
- `src/routes/api/chat.ts` – valuta i system-prompt
- Länk till `/installningar` från dashboard-header

## Vad som INTE ändras
- Fortnox-mockdata i `handle_new_user`
- Design, färgpalett, komponentbibliotek
- RLS-policies (endast utökade kolumner ärver befintlig policy på profiles)
- Auth-flöde, share-länk, integritetspolicy

Bekräfta så kör jag migrationen först, sedan koden.
