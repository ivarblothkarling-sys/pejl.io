export type Currency = "SEK" | "NOK" | "GBP" | "EUR" | "USD";

const LOCALE_BY_CURRENCY: Record<Currency, string> = {
  SEK: "sv-SE",
  NOK: "nb-NO",
  GBP: "en-GB",
  EUR: "en-IE",
  USD: "en-US",
};

export function formatCurrency(amount: number, currency: string = "SEK"): string {
  const cur = (currency as Currency) in LOCALE_BY_CURRENCY ? (currency as Currency) : "SEK";
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[cur], {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("sv-SE")} ${cur}`;
  }
}

export const AVAILABLE_CURRENCIES: { code: Currency; label: string; flag: string }[] = [
  { code: "SEK", label: "Svensk krona", flag: "🇸🇪" },
  { code: "NOK", label: "Norsk krone", flag: "🇳🇴" },
  { code: "GBP", label: "Pound sterling", flag: "🇬🇧" },
  { code: "EUR", label: "Euro", flag: "🇪🇺" },
  { code: "USD", label: "US dollar", flag: "🇺🇸" },
];
