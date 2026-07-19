// Pejl dashboard – Fortnox-integration aktiv
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, Copy, Landmark, Link2, LogOut, PlayCircle, Settings as SettingsIcon, Share2, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Users, Wallet, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { computeForecast, computeSuggestions, formatDateSv, formatSEK, type Tx } from "@/lib/forecast";
import {
  generateWeeklySummary,
  getDashboardData,
  updatePendingApprovalPreference,
  updateThreshold,
} from "@/lib/api/finance.functions";
import { createShareLink } from "@/lib/api/share.functions";
import { disconnectFortnox, getFortnoxAuthUrl, getFortnoxStatus, syncFortnox } from "@/lib/api/fortnox.functions";
import { disconnectTink, getTinkAuthUrl, getTinkStatus, syncTink } from "@/lib/api/tink.functions";

import logo from "@/assets/pejl-logo.png";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Översikt — Pejl" },
      { name: "description", content: "Dagens saldo och 30-dagars likviditetsprognos för ditt företag." },
    ],
  }),
  component: DashboardPage,
});

type DashData = Awaited<ReturnType<typeof getDashboardData>>;
const getFortnoxRedirectUri = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/fortnox/callback`
    : "https://pejl.io/auth/fortnox/callback";
const getTinkRedirectUri = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/tink/callback`
    : "https://pejl.io/auth/tink/callback";

type TinkStatus = {
  connected: boolean;
  bankBalance: number | null;
  bankCurrency: string | null;
  lastSyncedAt: string | null;
};

function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [demoStage, setDemoStage] = useState<null | "critical" | "resolved">(null);
  const [fortnoxConnected, setFortnoxConnected] = useState(false);
  const [fortnoxLoading, setFortnoxLoading] = useState(false);
  const [fortnoxSyncing, setFortnoxSyncing] = useState(false);
  const [isAgency, setIsAgency] = useState(true);
  const chatInjectRef = useRef<((text: string) => void) | null>(null);

  const [fortnoxAuthUrl, setFortnoxAuthUrl] = useState<string | null>(null);
  const fortnoxForm = useMemo(() => {
    if (!fortnoxAuthUrl) return null;
    const url = new URL(fortnoxAuthUrl);
    return {
      action: `${url.origin}${url.pathname}`,
      params: Array.from(url.searchParams.entries()),
    };
  }, [fortnoxAuthUrl]);

  const [tinkStatus, setTinkStatus] = useState<TinkStatus | null>(null);
  const [tinkAuthUrl, setTinkAuthUrl] = useState<string | null>(null);
  const [tinkLoading, setTinkLoading] = useState(false);
  const [tinkSyncing, setTinkSyncing] = useState(false);
  const tinkForm = useMemo(() => {
    if (!tinkAuthUrl) return null;
    const url = new URL(tinkAuthUrl);
    return {
      action: `${url.origin}${url.pathname}`,
      params: Array.from(url.searchParams.entries()),
    };
  }, [tinkAuthUrl]);




  const refresh = async () => {
    try {
      const result = await getDashboardData();
      // Redirect till onboarding om användaren inte har gått igenom flödet
      const p = result.profile as { onboarding_completed?: boolean };
      if (p.onboarding_completed === false) {
        navigate({ to: "/onboarding" });
        return;
      }
      setData(result);
      setThresholdInput(String(result.profile.threshold));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte hämta data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    getFortnoxStatus()
      .then((s) => {
        setFortnoxConnected(s.connected);
        if (!s.connected) {
          setFortnoxLoading(true);
          console.log("[Fortnox] Förbereder OAuth-länk. redirectUri =", getFortnoxRedirectUri());
          getFortnoxAuthUrl({ data: { redirectUri: getFortnoxRedirectUri() } })
            .then(({ url }) => {
              console.log("[Fortnox] OAuth-URL förberedd:", url);
              setFortnoxAuthUrl(url);
            })
            .catch((err) => {
              console.error("[Fortnox] Kunde inte förbereda OAuth-URL:", err);
              toast.error(err instanceof Error ? err.message : "Kunde inte förbereda Fortnox-koppling");
            })
            .finally(() => setFortnoxLoading(false));
        }
      })
      .catch(() => {});
    // Show success toast if we just came back from the OAuth callback
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("fortnox") === "connected") {
        toast.success("Fortnox ansluten");
        const url = new URL(window.location.href);
        url.searchParams.delete("fortnox");
        window.history.replaceState({}, "", url.toString());
      }
      if (params.get("tink") === "connected") {
        toast.success("Bank ansluten");
        const url = new URL(window.location.href);
        url.searchParams.delete("tink");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}

    getTinkStatus()
      .then((s) => {
        setTinkStatus(s);
        if (!s.connected) {
          setTinkLoading(true);
          getTinkAuthUrl({ data: { redirectUri: getTinkRedirectUri() } })
            .then(({ url }) => setTinkAuthUrl(url))
            .catch((err) => {
              console.error("[Tink] Kunde inte förbereda OAuth-URL:", err);
              toast.error(err instanceof Error ? err.message : "Kunde inte förbereda bank-koppling");
            })
            .finally(() => setTinkLoading(false));
        }
      })
      .catch(() => {});
  }, []);

  const handleConnectTink = async () => {
    console.log("[Tink] Koppla bank-knapp klickad. redirectUri =", getTinkRedirectUri());
    try {
      let url = tinkAuthUrl;
      if (!url) {
        setTinkLoading(true);
        const res = await getTinkAuthUrl({ data: { redirectUri: getTinkRedirectUri() } });
        url = res.url;
        setTinkAuthUrl(url);
      }
      console.log("[Tink] Navigerar till:", url);
      if (window.top) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (err) {
      console.error("[Tink] Fel vid koppling:", err);
      toast.error(err instanceof Error ? err.message : "Kunde inte starta bank-koppling. Kontrollera att TINK_CLIENT_ID är satt.");
    } finally {
      setTinkLoading(false);
    }
  };


  const handleConnectFortnox = async () => {
    console.log("[Fortnox] Koppla-knapp klickad. redirectUri =", getFortnoxRedirectUri());
    console.log("[Fortnox] Skickar native form-submit till Fortnox i toppfliken.");
  };

  const syncFortnoxFn = useServerFn(syncFortnox);
  const disconnectFortnoxFn = useServerFn(disconnectFortnox);

  const handleSyncFortnox = async () => {
    setFortnoxSyncing(true);
    try {
      const result = await syncFortnoxFn();
      toast.success(`Synkat från Fortnox — ${result.imported} poster importerade.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte synka Fortnox");
    } finally {
      setFortnoxSyncing(false);
    }
  };

  const handleDisconnectFortnox = async () => {
    if (!confirm("Koppla bort Fortnox och ta bort importerade fakturor?")) return;
    try {
      await disconnectFortnoxFn();
      setFortnoxConnected(false);
      toast.success("Fortnox bortkopplad.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte koppla bort Fortnox");
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
        `Banksaldo uppdaterat: ${formatSEK(result.balance)}${result.currency ? " " + result.currency : ""}`,
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
      setTinkStatus({ connected: false, bankBalance: null, bankCurrency: null, lastSyncedAt: null });
      toast.success("Bank bortkopplad.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte koppla bort banken");
    }
  };

  const generateSummaryFn = useServerFn(generateWeeklySummary);
  const handleWeeklySummary = async () => {
    setSummaryLoading(true);
    try {
      const result = await generateSummaryFn();
      setSummary(result.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI-fel");
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSaveThreshold = async () => {
    const v = Number(thresholdInput);
    if (Number.isNaN(v) || v < 0) {
      toast.error("Ange ett giltigt belopp");
      return;
    }
    try {
      await updateThreshold({ data: { threshold: v } });
      toast.success("Gräns uppdaterad");
      setEditingThreshold(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte spara");
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const handleShare = async () => {
    if (shareLoading) return;
    setShareLoading(true);
    try {
      const { token } = await createShareLink();
      const url = `${window.location.origin}/share/${token}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        toast.success("Länk kopierad", { description: "Skicka den till din redovisningskonsult." });
        setTimeout(() => setShareCopied(false), 2500);
      } catch {
        toast.success("Länk skapad", { description: "Kopiera den manuellt nedan." });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte skapa länk");
    } finally {
      setShareLoading(false);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  };


  const demoData = useMemo<DashData | null>(() => {
    if (!demoStage || !data) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const iso = (offset: number) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const invoiceDay = demoStage === "resolved" ? 2 : 10;
    const txs: Tx[] = [
      { id: "demo-invoice", kind: "income", amount: 60000, due_date: iso(invoiceDay), description: "Kundfaktura #2041 – Acme AB", paid: false, category: "regular" },
      { id: "demo-salary", kind: "expense", amount: 45000, due_date: iso(3), description: "Löner – utbetalning", paid: false, category: "regular" },
      { id: "demo-rent", kind: "expense", amount: 18000, due_date: iso(5), description: "Hyra kontor", paid: false, category: "regular" },
      { id: "demo-vat", kind: "expense", amount: 12400, due_date: iso(9), description: "Moms", paid: false, category: "tax" },
    ];
    const startBalance = 8200;
    const threshold = 15000;
    const fc = computeForecast(startBalance, threshold, txs, 30, today);
    const sugg = computeSuggestions(fc, txs, today);
    return {
      ...data,
      profile: { ...data.profile, current_balance: startBalance, threshold, company_name: "Demo AB" },
      forecast: fc,
      transactions: txs,
      suggestions: sugg,
    };
  }, [demoStage, data]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Hämtar din ekonomi…
      </div>
    );
  }

  const view = demoData ?? data;
  const { profile, forecast, transactions } = view;
  const hasBreach = !!forecast.breachDate;

  const CONFIRMED_DAYS = 14;
  const chartData = forecast.points.map((p, i) => ({
    ...p,
    label: formatDateSv(p.date),
    threshold: forecast.threshold,
    confirmed: i <= CONFIRMED_DAYS ? p.balance : null,
    indicative: i >= CONFIRMED_DAYS ? p.balance : null,
  }));

  const upcomingUnpaid = transactions.filter((t) => !t.paid).slice(0, 8);

  // Proaktiv chatt-hälsning + datadrivna förslag
  const daysUntilBreach = forecast.breachDate
    ? Math.max(
        0,
        Math.round(
          (new Date(forecast.breachDate).getTime() -
            new Date().setHours(0, 0, 0, 0)) /
            86_400_000,
        ),
      )
    : 0;
  const chatGreeting = hasBreach
    ? `Hej 👋 Jag ser att du har ett potentiellt likviditetsproblem om **${daysUntilBreach} dagar** — den **${formatDateSv(forecast.breachDate!)}** beräknas saldot bli **${formatSEK(forecast.breachAmount ?? 0)}**, vilket är under din gräns på ${formatSEK(forecast.threshold)}.\n\nVill du att jag hjälper dig lösa det?`
    : null;

  const smartSuggestions: string[] = [];
  if (hasBreach) {
    smartSuggestions.push(
      `Hur undviker jag varningen den ${formatDateSv(forecast.breachDate!)}?`,
    );
  }
  const nextTaxTx = transactions
    .filter((t) => t.category === "tax" && !t.paid)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  if (nextTaxTx && smartSuggestions.length < 3) {
    smartSuggestions.push(
      `Klarar jag ${nextTaxTx.description.toLowerCase()} den ${formatDateSv(nextTaxTx.due_date)} (${formatSEK(Number(nextTaxTx.amount))})?`,
    );
  }
  const bigIncome = transactions
    .filter((t) => !t.paid && t.kind === "income")
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  if (bigIncome && smartSuggestions.length < 3) {
    smartSuggestions.push(
      `Vad händer om ${bigIncome.description} (${formatSEK(Number(bigIncome.amount))}) betalas 5 dagar sent?`,
    );
  }
  const bigExpense = transactions
    .filter((t) => !t.paid && t.kind === "expense" && t.category !== "tax")
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  if (bigExpense && smartSuggestions.length < 3) {
    smartSuggestions.push(
      `Kan jag skjuta upp ${bigExpense.description.toLowerCase()} den ${formatDateSv(bigExpense.due_date)}?`,
    );
  }
  while (smartSuggestions.length < 3) {
    smartSuggestions.push("Hur går det ekonomiskt just nu?");
  }
  const finalSuggestions = smartSuggestions.slice(0, 3);

  const taxItems = transactions
    .filter((t) => t.category === "tax" && !t.paid)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const taxBreaches = taxItems
    .map((t) => {
      const point = forecast.points.find((p) => p.date === t.due_date);
      if (!point) return null;
      if (point.balance < forecast.threshold) {
        return { tx: t, balanceAfter: point.balance };
      }
      return null;
    })
    .filter((x): x is { tx: Tx; balanceAfter: number } => x !== null);

  const handleSuggestionClick = (s: typeof view.suggestions[number]) => {
    if (demoStage === "critical" && s.kind === "remind") {
      setDemoStage("resolved");
      toast.success("Påminnelse skickad", {
        description: "Acme AB bekräftade — betalar inom 2 dagar. Prognosen uppdaterad.",
      });
      // Beräkna nya prognosens stabila slutdatum för aktiv bekräftelse i chatten
      const endDate = forecast.points[forecast.points.length - 1]?.date;
      chatInjectRef.current?.(
        `Bra — påminnelsen skickades till Acme AB och prognosen ser nu stabil ut${endDate ? ` fram till den ${formatDateSv(endDate)}` : ""}. Saldot håller sig över din gräns på ${formatSEK(forecast.threshold)} hela perioden. Vill du att jag följer upp om Acme inte betalar i tid?`,
      );
      return;
    }
    toast.success(
      s.kind === "remind" ? "Påminnelse skickad (demo)" : "Betalning uppskjuten (demo)",
      { description: s.detail },
    );
    chatInjectRef.current?.(
      s.kind === "remind"
        ? `Noterat — jag har flaggat en påminnelse för "${s.label}". ${s.detail}`
        : `Noterat — vi skjuter fram "${s.label}". ${s.detail}`,
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Pejl" width={32} height={32} />
            <div>
              <div className="font-semibold leading-none">Pejl</div>
              <div className="text-xs text-muted-foreground leading-none mt-0.5">{profile.company_name}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isAgency && (
              <Link to="/byra">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <Users className="size-4" /> Byråvy
                </Button>
              </Link>
            )}
            <Link to="/installningar">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <SettingsIcon className="size-4" /> Inställningar
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground">
              <LogOut className="size-4" /> Logga ut
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        {/* Demo banner */}
        {demoStage === null ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
            <div className="text-sm">
              <div className="font-medium text-foreground">Vill du se hur Pejl varnar i en krissituation?</div>
              <div className="text-xs text-muted-foreground">Tre klick: kritiskt scenario → förslag → läget räddat.</div>
            </div>
            <Button size="sm" onClick={() => setDemoStage("critical")}>
              <PlayCircle className="size-4" /> Visa demo-scenario
            </Button>
          </div>
        ) : (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
              demoStage === "resolved"
                ? "border-success/40 bg-success/10"
                : "border-destructive/40 bg-destructive/5"
            }`}
          >
            <div className="text-sm flex items-center gap-2">
              {demoStage === "resolved" ? (
                <ShieldCheck className="size-4 text-success" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              <span className="font-medium text-foreground">
                Demo-läge — {demoStage === "resolved" ? "läget räddat" : "kritiskt scenario"}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDemoStage(null)}>
              <X className="size-4" /> Avsluta demo
            </Button>
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={<Wallet className="size-4" />}
            label={tinkStatus?.connected && tinkStatus.bankBalance != null ? "Banksaldo (idag)" : "Dagens saldo"}
            value={
              tinkStatus?.connected && tinkStatus.bankBalance != null
                ? <CountUp value={tinkStatus.bankBalance} duration={800} />
                : <CountUp value={forecast.startBalance} duration={800} />
            }
            sub={
              tinkStatus?.connected && tinkStatus.bankBalance != null
                ? `Fortnox: ${formatSEK(forecast.startBalance)}`
                : undefined
            }
          />
          <KpiCard
            icon={forecast.endBalance >= forecast.startBalance ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-destructive" />}
            label="Om 30 dagar"
            value={formatSEK(forecast.endBalance)}
          />
          <KpiCard
            icon={<TrendingDown className="size-4" />}
            label="Lägsta saldo"
            value={formatSEK(forecast.minBalance)}
            sub={formatDateSv(forecast.minDate)}
          />
          <KpiCard
            icon={<AlertTriangle className="size-4" />}
            label="Varningsgräns"
            value={formatSEK(forecast.threshold)}
            action={
              <button
                onClick={() => setEditingThreshold((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Ändra
              </button>
            }
          />
        </section>

        {tinkStatus?.connected && tinkStatus.bankBalance != null &&
          Math.abs(tinkStatus.bankBalance - forecast.startBalance) > 100 && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              Ditt Fortnox-saldo visar <strong>{formatSEK(forecast.startBalance)}</strong> men bankkontot visar{" "}
              <strong>{formatSEK(tinkStatus.bankBalance)}</strong>. Avvikelsen beror troligen på obetalda fakturor.
            </div>
          </div>
        )}

        {(data.awaitingApprovalSum > 0 || data.approvedPendingSum > 0) && (
          <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <div className="font-medium text-foreground">
                Du har {formatSEK(data.approvedPendingSum)} i godkända fakturor och{" "}
                {formatSEK(data.awaitingApprovalSum)} som väntar på attest.
              </div>
              {data.awaitingApprovalSum > 0 && (
                <div className="text-muted-foreground text-xs mt-1">
                  {data.includePendingInForecast
                    ? "Attest-fakturor räknas just nu med i prognosen."
                    : "Attest-fakturor räknas inte med i prognosen — bara godkända fakturor är bekräftade utgifter."}
                </div>
              )}
            </div>
            {data.awaitingApprovalSum > 0 && (
              <Button
                variant={data.includePendingInForecast ? "outline" : "default"}
                size="sm"
                onClick={async () => {
                  try {
                    await updatePendingApprovalPreference({ data: { include: !data.includePendingInForecast } });
                    await refresh();
                    toast.success(
                      !data.includePendingInForecast
                        ? "Attest-fakturor inkluderas nu i prognosen."
                        : "Attest-fakturor räknas inte längre med.",
                    );
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Kunde inte uppdatera inställning");
                  }
                }}
              >
                {data.includePendingInForecast ? "Ta bort från prognos" : "Inkludera i prognos"}
              </Button>
            )}
          </div>
        )}



        <div className="flex flex-wrap items-center gap-3 -mt-2">
          {fortnoxConnected ? (
            <>
              <span className="inline-flex items-center gap-2 text-sm font-medium text-success bg-success/10 border border-success/30 rounded-full px-3 py-1.5">
                <CheckCircle2 className="size-4" /> Fortnox ansluten
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncFortnox}
                disabled={fortnoxSyncing}
              >
                {fortnoxSyncing ? "Synkar…" : "Synka Fortnox"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnectFortnox}
                className="text-muted-foreground hover:text-destructive"
              >
                Koppla bort
              </Button>
            </>
          ) : fortnoxForm ? (
            <form action={fortnoxForm.action} method="GET" target="_top" onSubmit={handleConnectFortnox}>
              {fortnoxForm.params.map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" variant="default" size="sm">
                <Link2 className="size-4" />
                Koppla Fortnox
              </Button>
            </form>
          ) : (
            <Button variant="default" size="sm" disabled>
              <Link2 className="size-4" />
              {fortnoxLoading ? "Förbereder Fortnox…" : "Koppla Fortnox"}
            </Button>
          )}
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
          ) : tinkForm ? (
            <form action={tinkForm.action} method="GET" target="_top">
              {tinkForm.params.map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" variant="outline" size="sm">
                <Landmark className="size-4" />
                Koppla bank
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <Landmark className="size-4" />
              {tinkLoading ? "Förbereder bank…" : "Koppla bank"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            disabled={shareLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            <Share2 className="size-4" />
            {shareLoading ? "Skapar länk…" : "Dela med din redovisningskonsult →"}
          </Button>
          {shareUrl && (
            <button
              onClick={copyShareUrl}
              className="inline-flex items-center gap-2 text-xs bg-secondary border border-border rounded-full px-3 py-1.5 hover:bg-secondary/70 max-w-full"
            >
              {shareCopied ? <Check className="size-3.5 text-success shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
              <span className="truncate font-mono">{shareUrl}</span>
            </button>
          )}
        </div>


        {editingThreshold && (
          <div className="bg-card border border-border rounded-xl p-4 flex items-end gap-2 max-w-md">
            <div className="flex-1">
              <Label htmlFor="threshold">Ny varningsgräns (SEK)</Label>
              <Input
                id="threshold"
                type="number"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
              />
            </div>
            <Button onClick={handleSaveThreshold}>Spara</Button>
          </div>
        )}


        {/* Warning banner */}
        {hasBreach && (
          <div
            key={`warn-${forecast.breachDate}`}
            className="border border-destructive/40 rounded-xl p-4 animate-in zoom-in-95 fade-in duration-300"
            style={{ backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)" }}
          >
            <div className="flex gap-3 items-start">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-foreground">
                  Saldot riskerar att gå under din gräns
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Den <strong className="text-foreground">{formatDateSv(forecast.breachDate!)}</strong> beräknas saldot vara{" "}
                  <strong className="text-foreground">{formatSEK(forecast.breachAmount ?? 0)}</strong>, vilket är under din varningsgräns på {formatSEK(forecast.threshold)}.
                </div>
              </div>
            </div>
            {view.suggestions.length > 0 && (
              <div className="mt-4 pl-8">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Förslag
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {view.suggestions.map((s) => (
                    <button
                      key={s.txId + s.kind}
                      onClick={() => handleSuggestionClick(s)}
                      className="text-left bg-background hover:bg-secondary border border-border rounded-lg p-3 transition-colors group"
                    >
                      <div className="flex items-center gap-2 font-medium text-sm text-foreground">
                        {s.kind === "remind" ? (
                          <BellRing className="size-4 text-primary" />
                        ) : (
                          <CalendarClock className="size-4 text-primary" />
                        )}
                        {s.label}
                        <span className="ml-auto text-xs text-muted-foreground group-hover:text-foreground">→</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{s.detail}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
                  Pejl ger dig och din redovisningskonsult en gemensam bild av likviditeten framåt – baserat på bokförd data i Fortnox. Ersätter inte bokföring eller rådgivning. Du och din konsult beslutar alltid själv.
                </p>

              </div>
            )}

          </div>
        )}

        {/* Forecast chart */}
        <section className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Prognos 30 dagar framåt</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Bekräftad dag 0–14, indikativ dag 15–30</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-[var(--color-chart-1)]" />
                Bekräftad
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-0.5 opacity-60"
                  style={{ borderTop: "2px dashed var(--color-chart-1)", background: "transparent" }}
                />
                Indikativ
              </span>
            </div>
          </div>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatSEK(value), "Saldo"]}
                  labelFormatter={(l) => l}
                />
                <ReferenceLine
                  y={forecast.threshold}
                  stroke="var(--color-destructive)"
                  strokeDasharray="4 4"
                  label={{
                    value: `Gräns ${formatSEK(forecast.threshold)}`,
                    position: "insideTopRight",
                    fill: "var(--color-destructive)",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  x={chartData[CONFIRMED_DAYS]?.label}
                  stroke="var(--color-border)"
                  strokeDasharray="2 3"
                  label={{
                    value: "Baserat på historiska mönster",
                    position: "insideTopRight",
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="confirmed"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  fill="url(#balanceFill)"
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                <Area
                  type="monotone"
                  dataKey="indicative"
                  stroke="var(--color-chart-1)"
                  strokeOpacity={0.55}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  fill="url(#balanceFill)"
                  fillOpacity={0.4}
                  connectNulls={false}
                  isAnimationActive
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Kommande skatter & avgifter */}
        {taxItems.length > 0 && (
          <section
            className="rounded-2xl border border-tax/30 p-5 shadow-sm"
            style={{ backgroundColor: "color-mix(in oklab, var(--tax) 10%, transparent)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center size-6 rounded-md bg-tax text-tax-foreground font-bold text-sm">§</span>
              <h3 className="font-semibold text-tax">Kommande skatter & avgifter</h3>
            </div>
            <ul className="space-y-2.5">
              {taxItems.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{t.description}</div>
                    <div className="text-xs text-muted-foreground">Förfaller {formatDateSv(t.due_date)}</div>
                  </div>
                  <div className="text-tax font-semibold">−{formatSEK(Number(t.amount))}</div>
                </li>
              ))}
            </ul>
            {taxBreaches.length > 0 && (
              <div className="mt-4 space-y-2">
                {taxBreaches.map(({ tx, balanceAfter }) => (
                  <div
                    key={`taxbreach-${tx.id}`}
                    className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                  >
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-foreground">
                      <strong>OBS:</strong> Skattebetalningen den {formatDateSv(tx.due_date)} riskerar ta saldot under din gräns
                      {" "}(beräknat saldo {formatSEK(balanceAfter)}, gräns {formatSEK(forecast.threshold)}).
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
              Skatter och avgifter räknas alltid med i prognosen automatiskt – de är den vanligaste orsaken till likviditetskriser.
            </p>
          </section>
        )}

        {/* Upcoming + Weekly summary */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold mb-3">Kommande poster</h3>
            <ul className="space-y-2.5">
              {upcomingUnpaid.length === 0 && (
                <li className="text-sm text-muted-foreground">Inga obetalda poster.</li>
              )}
              {upcomingUnpaid.map((t, i) => {
                const isTax = t.category === "tax";
                return (
                  <li
                    key={t.id}
                    style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}
                    className="flex items-center justify-between gap-3 text-sm animate-in slide-in-from-top-2 fade-in duration-300"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      {isTax && <Landmark className="size-3.5 text-tax shrink-0" />}
                      <div className="min-w-0">
                        <div className={`truncate font-medium ${isTax ? "text-tax" : ""}`}>{t.description}</div>
                        <div className="text-xs text-muted-foreground">{formatDateSv(t.due_date)}</div>
                      </div>
                    </div>
                    <div className={t.kind === "income" ? "text-success font-medium" : isTax ? "text-tax font-medium" : "text-foreground font-medium"}>
                      {t.kind === "income" ? "+" : "−"}
                      {formatSEK(Number(t.amount))}
                    </div>
                  </li>
                );
              })}

            </ul>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Veckosammanfattning</h3>
              <Button size="sm" onClick={handleWeeklySummary} disabled={summaryLoading}>
                <Sparkles className="size-4" />
                {summaryLoading ? "Skriver…" : summary ? "Skriv ny" : "Generera"}
              </Button>
            </div>
            <div className="text-sm text-foreground/90 leading-relaxed min-h-[8rem]">
              {summaryLoading && <Shimmer>Sammanfattar din vecka…</Shimmer>}
              {!summaryLoading && summary && (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{summary}</ReactMarkdown>
                </div>
              )}
              {!summaryLoading && !summary && (
                <p className="text-muted-foreground text-sm">
                  Få en kort text om hur det ser ut just nu och varningar för kommande 30 dagar.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Chat */}
        <section className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold">Fråga Pejl</h3>
            <p className="text-xs text-muted-foreground mt-0.5">T.ex. "vilka fakturor är obetalda?" eller "hur går det ekonomiskt?"</p>
          </div>
          <ChatPanel
            greeting={chatGreeting}
            suggestions={finalSuggestions}
            injectRef={chatInjectRef}
          />
        </section>
      </main>
    </div>
  );
}

function CountUp({ value, duration = 800 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const to = value;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{formatSEK(Math.round(n))}</>;
}


function KpiCard({
  icon,
  label,
  value,
  sub,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        {action}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const SUGGESTED_FALLBACK = [
  "Hur går det ekonomiskt just nu?",
  "När förfaller min nästa momsdeklaration?",
  "Vilka kundfakturor är mer än 30 dagar försenade?",
];

function ChatPanel({
  greeting,
  suggestions,
  injectRef,
}: {
  greeting: string | null;
  suggestions: string[];
  injectRef: React.MutableRefObject<((text: string) => void) | null>;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const persistedIds = useRef<Set<string>>(new Set());
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load token + history
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setToken(data.session?.access_token ?? null);
      const userId = data.session?.user.id;
      if (!userId) {
        setInitialMessages([]);
        return;
      }
      const { data: rows } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      const msgs: UIMessage[] =
        (rows ?? [])
          .filter((r) => r.role === "user" || r.role === "assistant")
          .map((r) => ({
            id: r.id,
            role: r.role as "user" | "assistant",
            parts: [{ type: "text", text: r.content }],
          }));
      msgs.forEach((m) => persistedIds.current.add(m.id));

      // Proaktiv hälsning om varning finns och det inte redan finns en pågående konversation
      if (msgs.length === 0 && greeting) {
        const greetId = `local-greeting-${Date.now()}`;
        persistedIds.current.add(greetId);
        msgs.push({
          id: greetId,
          role: "assistant",
          parts: [{ type: "text", text: greeting }],
        });
      }
      setInitialMessages(msgs);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transport = useMemo(() => {
    if (token === null) return null;
    return new DefaultChatTransport({
      api: "/api/chat",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }, [token]);

  if (!transport || !initialMessages) {
    return <div className="p-6 text-sm text-muted-foreground">Laddar samtal…</div>;
  }

  return (
    <ChatInner
      transport={transport}
      initialMessages={initialMessages}
      persistedIds={persistedIds}
      taRef={taRef}
      suggestions={suggestions.length ? suggestions : SUGGESTED_FALLBACK}
      injectRef={injectRef}
    />
  );
}

function ChatInner({
  transport,
  initialMessages,
  persistedIds,
  taRef,
  suggestions,
  injectRef,
}: {
  transport: DefaultChatTransport<UIMessage>;
  initialMessages: UIMessage[];
  persistedIds: React.MutableRefObject<Set<string>>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  suggestions: string[];
  injectRef: React.MutableRefObject<((text: string) => void) | null>;
}) {
  const { messages, setMessages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
  });
  const isLoading = status === "submitted" || status === "streaming";

  // Registrera injector så dashboarden kan skjuta in proaktiva bekräftelser
  useEffect(() => {
    injectRef.current = (text: string) => {
      const id = `local-inject-${Date.now()}`;
      persistedIds.current.add(id);
      setMessages((prev) => [
        ...prev,
        { id, role: "assistant", parts: [{ type: "text", text }] },
      ]);
    };
    return () => {
      injectRef.current = null;
    };
  }, [injectRef, setMessages, persistedIds]);

  // Persist new messages once
  useEffect(() => {
    if (status !== "ready") return;
    (async () => {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) return;
      for (const m of messages) {
        if (persistedIds.current.has(m.id)) continue;
        const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
        if (!text.trim()) continue;
        const { error } = await supabase
          .from("chat_messages")
          .insert({ user_id: uid, role: m.role, content: text });
        if (!error) persistedIds.current.add(m.id);
      }
    })();
  }, [messages, status, persistedIds]);

  useEffect(() => {
    taRef.current?.focus();
  }, [status, taRef]);

  const send = (text: string) => {
    if (!text.trim() || isLoading) return;
    sendMessage({ text });
    setTimeout(() => taRef.current?.focus(), 0);
  };

  return (
    <div className="flex flex-col h-[28rem]">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Vad vill du veta?"
              description="Pejl svarar baserat på din Fortnox-data (mock) och 30-dagars prognosen."
            >
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-secondary text-secondary-foreground hover:bg-secondary/70"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                return (
                  <Message from={m.role} key={m.id}>
                    {m.role === "user" ? (
                      <MessageContent>{text}</MessageContent>
                    ) : (
                      <MessageContent className="bg-transparent border-0 p-0 shadow-none">
                        <MessageResponse>{text}</MessageResponse>
                      </MessageContent>
                    )}
                  </Message>
                );
              })}
              {status === "submitted" && (
                <Message from="assistant">
                  <MessageContent className="bg-transparent border-0 p-0 shadow-none">
                    <Shimmer>Tänker…</Shimmer>
                  </MessageContent>
                </Message>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={(msg) => {
          if (msg.text) send(msg.text);
        }}
        className="border-t border-border rounded-none"
      >
        <PromptInputTextarea ref={taRef} placeholder="Fråga om saldo, fakturor, prognos…" />
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={status} disabled={isLoading} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
