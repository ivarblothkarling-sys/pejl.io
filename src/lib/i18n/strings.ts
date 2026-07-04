export type Language = "sv" | "en";

export const AVAILABLE_LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: "sv", label: "Svenska", flag: "🇸🇪" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

type Dict = Record<string, string>;

const sv: Dict = {
  "nav.dashboard": "Översikt",
  "nav.settings": "Inställningar",
  "nav.signout": "Logga ut",
  "settings.title": "Inställningar",
  "settings.subtitle": "Välj bokföringssystem, valuta och språk",
  "settings.provider.title": "Bokföringssystem",
  "settings.provider.subtitle": "Pejl kopplar mot ditt bokföringssystem för att läsa saldo och fakturor.",
  "settings.provider.connected": "Kopplat",
  "settings.provider.coming_soon": "Kommer snart",
  "settings.provider.notify": "Notifiera mig",
  "settings.provider.notified": "Du står på listan",
  "settings.currency.title": "Valuta",
  "settings.currency.subtitle": "Alla belopp i Pejl visas i den valda valutan.",
  "settings.language.title": "Språk",
  "settings.language.subtitle": "Byt gränssnittsspråk.",
  "settings.save": "Spara",
  "settings.saved": "Sparat",
  "settings.back": "Tillbaka till översikten",
  "tax.upcoming.title": "Kommande skatter & avgifter",
  "tax.upcoming.subtitle": "Prognosen räknar alltid med dessa – de kan inte glömmas bort.",
  "tax.none": "Inga skatte- eller avgiftshändelser konfigurerade för ditt land ännu.",
  "common.loading": "Laddar…",
};

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.settings": "Settings",
  "nav.signout": "Sign out",
  "settings.title": "Settings",
  "settings.subtitle": "Choose accounting system, currency and language",
  "settings.provider.title": "Accounting system",
  "settings.provider.subtitle": "Pejl connects to your accounting system to read balance and invoices.",
  "settings.provider.connected": "Connected",
  "settings.provider.coming_soon": "Coming soon",
  "settings.provider.notify": "Notify me",
  "settings.provider.notified": "You're on the list",
  "settings.currency.title": "Currency",
  "settings.currency.subtitle": "All amounts in Pejl are displayed in the selected currency.",
  "settings.language.title": "Language",
  "settings.language.subtitle": "Switch interface language.",
  "settings.save": "Save",
  "settings.saved": "Saved",
  "settings.back": "Back to dashboard",
  "tax.upcoming.title": "Upcoming taxes & fees",
  "tax.upcoming.subtitle": "The forecast always includes these — they can't be forgotten.",
  "tax.none": "No tax or fee events configured for your country yet.",
  "common.loading": "Loading…",
};

const DICTS: Record<Language, Dict> = { sv, en };

export function translate(language: Language | string | undefined, key: string): string {
  const lang: Language = language === "en" ? "en" : "sv";
  return DICTS[lang][key] ?? sv[key] ?? key;
}
