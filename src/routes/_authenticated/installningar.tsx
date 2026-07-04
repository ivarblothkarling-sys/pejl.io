import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BellRing, Check, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  getUserSettings,
  updateUserSettings,
  joinProviderWaitlist,
  importSieData,
} from "@/lib/api/settings.functions";
import { AVAILABLE_PROVIDERS } from "@/lib/accounting/accountingService";
import { AVAILABLE_CURRENCIES } from "@/lib/i18n/format";
import { AVAILABLE_LANGUAGES, type Language } from "@/lib/i18n/strings";
import { useT } from "@/lib/i18n/useT";
import { decodeCP437, parseSie, deriveForecast } from "@/lib/accounting/sie";

export const Route = createFileRoute("/_authenticated/installningar")({
  head: () => ({
    meta: [
      { title: "Inställningar — Pejl" },
      { name: "description", content: "Bokföringssystem, valuta och språk." },
    ],
  }),
  component: SettingsPage,
});

type Settings = Awaited<ReturnType<typeof getUserSettings>>;

function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<{
    company: string;
    balance: number;
    count: number;
  } | null>(null);

  useEffect(() => {
    getUserSettings()
      .then(setSettings)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Kunde inte hämta"));
  }, []);

  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" /> Laddar…
      </div>
    );
  }

  const t = useT(settings.language as Language);

  const save = async (patch: Partial<Settings>) => {
    setSaving(true);
    try {
      await updateUserSettings({
        data: {
          accounting_provider: patch.accounting_provider as
            | "fortnox" | "sie" | "tripletex" | "xero" | "quickbooks" | undefined,
          currency: patch.currency as "SEK" | "NOK" | "GBP" | "EUR" | "USD" | undefined,
          language: patch.language as "sv" | "en" | undefined,
          country: patch.country as "SE" | "NO" | "GB" | "US" | undefined,
        },
      });
      setSettings({ ...settings, ...patch });
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  };

  const notify = async (provider: "tripletex" | "xero" | "quickbooks") => {
    try {
      await joinProviderWaitlist({ data: { provider } });
      setSettings({ ...settings, waitlist: [...settings.waitlist, provider] });
      toast.success(t("settings.provider.notified"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fel");
    }
  };



  const handleSieFile = async (file: File) => {
    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = decodeCP437(bytes);
      if (!text.includes("#SIETYP")) {
        throw new Error("Filen verkar inte vara en giltig SIE-fil.");
      }
      const parsed = parseSie(text);
      const derived = deriveForecast(parsed);
      const res = await importSieData({
        data: {
          companyName: parsed.companyName || undefined,
          currentBalance: derived.currentBalance,
          transactions: derived.transactions,
        },
      });
      setSettings({
        ...settings,
        accounting_provider: "sie",
      });
      setLastImport({
        company: parsed.companyName,
        balance: derived.currentBalance,
        count: res.count,
      });
      toast.success(`Importerade ${res.count} transaktioner från ${parsed.companyName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte läsa SIE-filen");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
            <ArrowLeft className="size-4" /> {t("settings.back")}
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle")}</p>
        </div>

        {/* Provider */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">{t("settings.provider.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">
            {t("settings.provider.subtitle")}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {AVAILABLE_PROVIDERS.map((p) => {
              const isSelected = settings.accounting_provider === p.id;
              const isAvailable = p.status === "available";
              const notified = settings.waitlist.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isAvailable
                      ? "border-border bg-background hover:bg-secondary/40"
                      : "border-dashed border-border bg-muted/20 opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <span className="text-lg leading-none">{p.flag}</span>
                        <span>{p.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.country}</div>
                    </div>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                        <Check className="size-3.5" /> {t("settings.provider.connected")}
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    {isAvailable ? (
                      p.id === "sie" ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".se,.si,.sie"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleSieFile(f);
                            }}
                          />
                          <Button
                            size="sm"
                            variant={isSelected ? "ghost" : "outline"}
                            disabled={importing}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {importing ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <FileUp className="size-3.5" />
                            )}
                            {isSelected ? "Byt fil" : "Ladda upp SIE-fil"}
                          </Button>
                          {lastImport && isSelected && (
                            <span className="text-xs text-muted-foreground">
                              {lastImport.count} poster · {lastImport.balance.toLocaleString("sv-SE")} kr
                            </span>
                          )}
                        </div>
                      ) : (
                        !isSelected && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() => save({ accounting_provider: p.id })}
                          >
                            Välj
                          </Button>
                        )
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {t("settings.provider.coming_soon")}
                        </span>
                        {notified ? (
                          <span className="text-xs text-success inline-flex items-center gap-1">
                            <Check className="size-3.5" /> {t("settings.provider.notified")}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => notify(p.id as "tripletex" | "xero" | "quickbooks")}
                          >
                            <BellRing className="size-3.5" /> {t("settings.provider.notify")}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Currency */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">{t("settings.currency.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">
            {t("settings.currency.subtitle")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {AVAILABLE_CURRENCIES.map((c) => (
              <button
                key={c.code}
                disabled={saving}
                onClick={() => save({ currency: c.code })}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  settings.currency === c.code
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="font-medium text-sm">{c.code}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Language */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">{t("settings.language.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">
            {t("settings.language.subtitle")}
          </p>
          <div className="flex gap-2">
            {AVAILABLE_LANGUAGES.map((l) => (
              <button
                key={l.code}
                disabled={saving}
                onClick={() => save({ language: l.code })}
                className={`rounded-lg border px-3 py-2 flex items-center gap-2 transition-colors ${
                  settings.language === l.code
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary/40"
                }`}
              >
                <span className="text-base leading-none">{l.flag}</span>
                <Label className="text-sm cursor-pointer">{l.label}</Label>
              </button>
            ))}
          </div>
        </section>

        <div>
          <Link to="/" className="text-sm text-primary hover:underline">
            ← {t("settings.back")}
          </Link>
        </div>
      </main>
    </div>
  );
}
