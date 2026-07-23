import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BellRing,
  Check,
  Download,
  FileUp,
  Landmark,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getUserSettings,
  updateUserSettings,
  joinProviderWaitlist,
  importSieData,
  exportTransactionsCsv,
  deleteUserAccount,
} from "@/lib/api/settings.functions";
import { updatePendingApprovalPreference } from "@/lib/api/finance.functions";
import { createCheckoutSession } from "@/lib/api/billing.functions";
import { getActiveShareLinks, revokeShareLink } from "@/lib/api/share.functions";
import { disconnectTink, getTinkAuthUrl, getTinkStatus, syncTink } from "@/lib/api/tink.functions";
import { AVAILABLE_PROVIDERS } from "@/lib/accounting/accountingService";
import { AVAILABLE_CURRENCIES } from "@/lib/i18n/format";
import { AVAILABLE_LANGUAGES, type Language } from "@/lib/i18n/strings";
import { useT } from "@/lib/i18n/useT";
import { decodeCP437, parseSie, deriveForecast } from "@/lib/accounting/sie";
import { formatDateSv } from "@/lib/forecast";

const DELETE_CONFIRM_PHRASE = "RADERA";

const getTinkRedirectUri = () => "https://pejl.io/auth/tink/callback";

type TinkStatus = {
  connected: boolean;
  bankBalance: number | null;
  bankCurrency: string | null;
  lastSyncedAt: string | null;
};

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
  const [tinkStatus, setTinkStatus] = useState<TinkStatus | null>(null);
  const [tinkLoading, setTinkLoading] = useState(false);
  const [tinkSyncing, setTinkSyncing] = useState(false);
  const [shareLinks, setShareLinks] = useState<
    { token: string; created_at: string; expires_at: string }[]
  >([]);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [pendingApprovalSaving, setPendingApprovalSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [upgradingPlan, setUpgradingPlan] = useState<"solo" | "solo_plus" | null>(null);

  useEffect(() => {
    getUserSettings()
      .then(setSettings)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Kunde inte hämta"));
  }, []);

  useEffect(() => {
    getTinkStatus()
      .then(setTinkStatus)
      .catch(() => {});
  }, []);

  const loadShareLinks = () => {
    getActiveShareLinks()
      .then((res) => setShareLinks(res.links))
      .catch(() => {});
  };

  useEffect(() => {
    loadShareLinks();
  }, []);

  const revokeShareLinkFn = useServerFn(revokeShareLink);
  const handleRevokeShareLink = async (token: string) => {
    setRevokingToken(token);
    try {
      await revokeShareLinkFn({ data: { token } });
      setShareLinks((links) => links.filter((l) => l.token !== token));
      toast.success("Länken är återkallad.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte återkalla länken");
    } finally {
      setRevokingToken(null);
    }
  };

  const getTinkAuthUrlFn = useServerFn(getTinkAuthUrl);
  const handleConnectTink = async () => {
    const redirectUri = getTinkRedirectUri();
    setTinkLoading(true);
    try {
      const res = await getTinkAuthUrlFn({ data: { redirectUri } });
      const url = res.url;
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = url;
        } else {
          window.location.href = url;
        }
      } catch (navErr) {
        console.warn("[Tink] top-navigation blockerad, öppnar i ny flik:", navErr);
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("[Tink] Fel vid koppling:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        msg.includes("TINK_CLIENT")
          ? "TINK_CLIENT_ID/TINK_CLIENT_SECRET saknas på servern. Lägg till dem i secrets."
          : msg || "Kunde inte starta bank-koppling.",
      );
    } finally {
      setTinkLoading(false);
    }
  };

  const syncTinkFn = useServerFn(syncTink);
  const disconnectTinkFn = useServerFn(disconnectTink);

  const handleSyncTink = async () => {
    setTinkSyncing(true);
    try {
      const result = await syncTinkFn();
      const s = await getTinkStatus();
      setTinkStatus(s);
      toast.success(
        `Banksaldo uppdaterat: ${result.balance.toLocaleString("sv-SE")} kr${result.currency ? " " + result.currency : ""}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte synka bank");
    } finally {
      setTinkSyncing(false);
    }
  };

  const handleDisconnectTink = async () => {
    if (!confirm("Koppla bort banken?")) return;
    try {
      await disconnectTinkFn();
      setTinkStatus({
        connected: false,
        bankBalance: null,
        bankCurrency: null,
        lastSyncedAt: null,
      });
      toast.success("Bank bortkopplad.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte koppla bort banken");
    }
  };

  const handleTogglePendingApproval = async (checked: boolean) => {
    if (!settings) return;
    setPendingApprovalSaving(true);
    try {
      await updatePendingApprovalPreference({ data: { include: checked } });
      setSettings({ ...settings, include_pending_in_forecast: checked });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setPendingApprovalSaving(false);
    }
  };

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
            "fortnox" | "sie" | "tripletex" | "xero" | "quickbooks" | undefined,
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
      toast.success(
        res.skipped > 0
          ? `Importerade ${res.count} nya transaktioner från ${parsed.companyName} (${res.skipped} fanns redan och hoppades över)`
          : `Importerade ${res.count} transaktioner från ${parsed.companyName}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte läsa SIE-filen");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const { csv, filename } = await exportTransactionsCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Data exporterad");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte exportera data");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== DELETE_CONFIRM_PHRASE) return;
    setDeleting(true);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut();
      toast.success("Ditt konto och all din data har raderats.");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte radera kontot");
      setDeleting(false);
    }
  };

  const handleUpgrade = async (plan: "solo" | "solo_plus") => {
    setUpgradingPlan(plan);
    try {
      const { url } = await createCheckoutSession({ data: { plan } });
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = url;
        } else {
          window.location.href = url;
        }
      } catch (navErr) {
        console.warn("[Stripe] top-navigation blockerad, öppnar i ny flik:", navErr);
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte starta uppgradering");
      setUpgradingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
            <ArrowLeft className="size-4" /> {t("settings.back")}
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle")}</p>
        </div>

        {/* Prenumeration */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">Prenumeration</h2>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
                settings.billing_status === "active"
                  ? "text-success bg-success/10 border-success/30"
                  : settings.billing_status === "cancelled"
                    ? "text-destructive bg-destructive/10 border-destructive/30"
                    : "text-muted-foreground bg-secondary border-border"
              }`}
            >
              {settings.billing_status === "active" && <Check className="size-4" />}
              {settings.billing_status === "active"
                ? "Aktiv prenumeration"
                : settings.billing_status === "cancelled"
                  ? "Prenumeration avslutad"
                  : "Provperiod"}
            </span>
            {settings.billing_status !== "active" && (
              <Button size="sm" onClick={() => setPlanModalOpen(true)}>
                <Sparkles className="size-4" />
                Uppgradera
              </Button>
            )}
          </div>
        </section>

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
                              {lastImport.count} poster ·{" "}
                              {lastImport.balance.toLocaleString("sv-SE")} kr
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

        {/* Bank */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">Bank</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">
            Koppla ditt bankkonto via Tink för att jämföra banksaldot med bokföringen.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {tinkStatus?.connected ? (
              <>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-success bg-success/10 border border-success/30 rounded-full px-3 py-1.5">
                  <Landmark className="size-4" /> Bank ansluten
                </span>
                <Button variant="outline" size="sm" onClick={handleSyncTink} disabled={tinkSyncing}>
                  {tinkSyncing ? "Synkar…" : "Synka bank"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnectTink}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Koppla bort bank
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleConnectTink}
                disabled={tinkLoading}
              >
                <Landmark className="size-4" />
                {tinkLoading ? "Förbereder bank…" : "Koppla bank"}
              </Button>
            )}
          </div>
        </section>

        {/* Delade länkar */}
        {shareLinks.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <h2 className="text-base font-semibold">Delade länkar</h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Aktiva länkar till din prognos. Vem som helst med länken kan se den tills den går ut
              eller återkallas.
            </p>
            <div className="space-y-2">
              {shareLinks.map((link) => (
                <div
                  key={link.token}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="size-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-mono truncate">{link.token}</div>
                      <div className="text-xs text-muted-foreground">
                        Giltig till {formatDateSv(link.expires_at)}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revokingToken === link.token}
                    onClick={() => handleRevokeShareLink(link.token)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="size-3.5" /> Återkalla länk
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Prognos-inställningar */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">Prognos-inställningar</h2>
          <div className="mt-4 flex items-center justify-between gap-4">
            <Label
              htmlFor="include-pending-approval"
              className="text-sm font-normal cursor-pointer"
            >
              Inkludera fakturor som väntar på attest i prognosen
            </Label>
            <Switch
              id="include-pending-approval"
              checked={settings.include_pending_in_forecast}
              disabled={pendingApprovalSaving}
              onCheckedChange={handleTogglePendingApproval}
            />
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

        {/* Ditt konto */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-semibold">Ditt konto</h2>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">
            Exportera din data eller radera ditt konto permanent, enligt GDPR.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={exporting}>
              <Download className="size-4" />
              {exporting ? "Exporterar…" : "Exportera min data"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteConfirmText("");
                setDeleteModalOpen(true);
              }}
              className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              Radera mitt konto
            </Button>
          </div>
        </section>

        <div>
          <Link to="/" className="text-sm text-primary hover:underline">
            ← {t("settings.back")}
          </Link>
        </div>
      </main>

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-destructive">Radera mitt konto</h3>
            <p className="text-sm text-muted-foreground">
              Det här raderar permanent alla dina transaktioner, kopplingar till Fortnox och Tink,
              chatthistorik, delade länkar och ditt inloggningskonto. Det går inte att ångra.
            </p>
            <div>
              <Label htmlFor="delete-confirm">
                Skriv <span className="font-mono font-semibold">{DELETE_CONFIRM_PHRASE}</span> för
                att bekräfta
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
              >
                Avbryt
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText !== DELETE_CONFIRM_PHRASE}
              >
                {deleting ? "Raderar…" : "Radera permanent"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {planModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
          onClick={() => !upgradingPlan && setPlanModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold">Välj plan</h3>
            <p className="text-sm text-muted-foreground">
              30 dagars gratis provperiod, avsluta när som helst. Du skickas vidare till Stripe för
              betalning.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleUpgrade("solo")}
                disabled={upgradingPlan !== null}
                className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">Pejl Solo</span>
                  <span className="text-sm tabular-nums">299 kr/mån</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {upgradingPlan === "solo" ? "Förbereder…" : "För enskild firma"}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleUpgrade("solo_plus")}
                disabled={upgradingPlan !== null}
                className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">Pejl Solo+</span>
                  <span className="text-sm tabular-nums">499 kr/mån</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {upgradingPlan === "solo_plus" ? "Förbereder…" : "För fler bolag och byråer"}
                </div>
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPlanModalOpen(false)}
                disabled={upgradingPlan !== null}
              >
                Avbryt
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
