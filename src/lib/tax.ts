import type { Tx } from "./forecast";

export type Country = "SE" | "NO" | "GB" | "US";

export interface TaxRule {
  type: "vat" | "employer" | "f-skatt" | "sales-tax";
  rate?: number;
  dueDay: number; // day of month
  label: string;
  mockAmount: number;
}

/**
 * Tax and employer-fee rules per country. Sverige är fullt konfigurerat;
 * övriga länder är platshållare tills implementation finns.
 */
export const TAX_RULES: Record<Country, TaxRule[]> = {
  SE: [
    { type: "vat", rate: 0.25, dueDay: 26, label: "Momsdeklaration (uppskattat)", mockAmount: 18500 },
    { type: "employer", dueDay: 12, label: "Arbetsgivaravgifter & avdragen skatt", mockAmount: 9800 },
    // F-skatt förfaller också den 12:e — inkluderas i arbetsgivaravgifter-posten i denna mock.
  ],
  NO: [
    // Placeholder MVA (25%), forfall varierar per termin — fylls i vid Tripletex-integration.
  ],
  GB: [
    // Placeholder VAT (20%), quarterly returns — fylls i vid Xero-integration.
  ],
  US: [
    // Placeholder Sales Tax — per state; fylls i vid QuickBooks-integration.
  ],
};

/**
 * Compute upcoming tax/fee events for the given country.
 * Mockar nästa förfallodatum i innevarande eller nästa månad.
 */
export function computeTaxEvents(
  country: Country = "SE",
  _fromDate: Date = new Date(),
): Tx[] {
  const rules = TAX_RULES[country] ?? [];
  if (rules.length === 0) return [];

  const from = new Date(_fromDate);
  from.setHours(0, 0, 0, 0);

  return rules.map((rule, i) => {
    const target = new Date(from);
    target.setDate(rule.dueDay);
    if (target < from) target.setMonth(target.getMonth() + 1);
    const iso = target.toISOString().slice(0, 10);
    return {
      id: `tax-${country}-${rule.type}-${iso}`,
      kind: "expense",
      amount: rule.mockAmount,
      due_date: iso,
      description: rule.label,
      paid: false,
      category: "tax",
    } satisfies Tx;
  });
}
