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
import { AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, Copy, FlaskConical, Landmark, Link2, LogOut, PlayCircle, Settings as SettingsIcon, Share2, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Users, Wallet, X } from "lucide-react";

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
import { NotificationBell } from "@/components/NotificationBell";
import {
  computeForecast,
  computeSuggestions,
  formatDateSv,
  formatMonthSv,
  formatSEK,
  type Tx,
} from "@/lib/forecast";
import {
  generateWeeklySummary,
  getDashboardData,
  sendPaymentReminder,
  simulateScenario,
  updateMonthlyRevenueTarget,
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
type SimulationResult = Awaited<ReturnType<typeof simulateScenario>>;
type SimulationAction = "hire" | "new_client" | "delay_payment" | "early_invoice";

const SIMULATION_OPTIONS: {
  value: SimulationAction;
  label: string;
  description: string;
  needsAmount: boolean;
  dateLabel: string;
}[] = [
  {
    value: "hire",
    label: "Nyanställning",
    description: "Lägg till en återkommande månadskostnad från ett valt datum.",
    needsAmount: true,
    dateLabel: "Startdatum (första lönekörningen)",
  },
  {
    value: "new_client",
    label: "Ny kund",
    description: "Lägg till en engångsintäkt vid ett valt förfallodatum.",
    needsAmount: true,
    dateLabel: "Förfallodatum",
  },
  {
    value: "delay_payment",
    label: "Försenad kundbetalning",
    description: "Flyttar din närmaste kundfaktura kring datumet 14 dagar framåt.",
    needsAmount: false,
    dateLabel: "Ungefärligt datum för fakturan",
  },
  {
    value: "early_invoice",
    label: "Betala leverantör tidigare",
    description: "Flyttar din närmaste leverantörsfaktura kring datumet 7 dagar bakåt.",
    needsAmount: false,
    dateLabel: "Ungefärligt datum för fakturan",
  },
];
const getFortnoxRedirectUri = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/fortnox/callback`
    : "https://pejl.io/auth/fortnox/callback";
const getTinkRedirectUri = () =>
  "https://pejl.io/auth/tink/callback";

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
  const [editingRevenueTarget, setEditingRevenueTarget] = useState(false);
  const [revenueTargetInput, setRevenueTargetInput] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [demoStage, setDemoStage] = useState<null | "critical" | "resolved">(null);
  const [fortnoxConnected, setFortnoxConnected] = useState(false);
  const [fortnoxLoading, setFortnoxLoading] = useState(false);
  const [fortnoxSyncing, setFortnoxSyncing] = useState(false);
  const [isAgency, setIsAgency] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
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
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateAction, setSimulateAction] = useState<SimulationAction>("hire");
  const [simulateAmount, setSimulateAmount] = useState("10000");
  const [simulateDate, setSimulateDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const simulateScenarioFn = useServerFn(simulateScenario);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);

  const handleSimulate = async () => {
    const option = SIMULATION_OPTIONS.find((o) => o.value === simulateAction)!;
    setSimulating(true);
    try {
      const result = await simulateScenarioFn({
        data: {
          action: simulateAction,
          amount: option.needsAmount ? Number(simulateAmount) || 0 : 0,
          date: simulateDate,
        },
      });
      setSimulationResult(result);
      setSimulateOpen(false);
      toast.success("Simulering klar", { description: result.summary });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte simulera scenariot");
    } finally {
      setSimulating(false);
    }
  };

  const handleSendReminder = async (transactionId: string) => {
    setSendingReminderId(transactionId);
    try {
      const result = await sendPaymentReminder({ data: { transactionId } });
      setSimulationResult(result);
      toast.success("Påminnelse skickad", { description: result.summary });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte skicka påminnelsen");
    } finally {
      setSendingReminderId(null);
    }
  };



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
    (async () => {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) return;
      const { data: adminRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!adminRow);
    })();
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
      .then((s) => setTinkStatus(s))
      .catch(() => {});
  }, []);

  // Datadrivna chattförslag (AI tool-calling, se GET /api/chat) — ersätter
  // den tidigare hårdkodade regelmotorn. Kan returnera en tom lista om allt
  // ser stabilt ut; ingen fallback-utfyllnad till ett visst antal.
  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/chat", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const json = (await res.json()) as { suggestions?: string[] };
        setAiSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);
      } catch {
        /* noop — chattförslagen är en trevlig detalj, inte kritiska */
      }
    })();
  }, []);

  const getTinkAuthUrlFn = useServerFn(getTinkAuthUrl);

  const handleConnectTink = async () => {
    const redirectUri = getTinkRedirectUri();
    console.log("[Tink] Koppla bank-knapp klickad. redirectUri =", redirectUri);
    setTinkLoading(true);
    try {
      const res = await getTinkAuthUrlFn({ data: { redirectUri } });
      const url = res.url;
      setTinkAuthUrl(url);
      console.log("[Tink] Navigerar till:", url);
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

  const handleSaveRevenueTarget = async () => {
    const v = Number(revenueTargetInput);
    if (Number.isNaN(v) || v < 0) {
      toast.error("Ange ett giltigt belopp");
      return;
    }
    try {
      await updateMonthlyRevenueTarget({ data: { target: v } });
      toast.success("Månadsmål uppdaterat");
      setEditingRevenueTarget(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunde inte spara");
    }
  };

  const handleClearRevenueTarget = async () => {
    try {
      await updateMonthlyRevenueTarget({ data: { target: null } });
      toast.success("Månadsmål borttaget");
      setEditingRevenueTarget(false);
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
        toast.success("Länk kopierad", {
          description: "Skicka den till din redovisningskonsult. Länken är giltig i 30 dagar.",
        });
        setTimeout(() => setShareCopied(false), 2500);
      } catch {
        toast.success("Länk skapad", {
          description: "Kopiera den manuellt nedan. Länken är giltig i 30 dagar.",
        });
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
    // country: null — det här är ett skriptat demo-scenario med en egen
    // hårdkodad "demo-vat"-post; auto-injektionen av riktiga skattedatum i
    // computeForecast ska inte lägga till ytterligare skattehändelser ovanpå
    // den kontrollerade demo-berättelsen.
    const fc = computeForecast(startBalance, threshold, txs, 30, today, null);
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
  const simulatedByDate = simulationResult
    ? new Map(simulationResult.simulated_forecast.map((p) => [p.date, p.balance]))
    : null;
  const chartData = forecast.points.map((p, i) => ({
    ...p,
    label: formatDateSv(p.date),
    threshold: forecast.threshold,
    confirmed: i <= CONFIRMED_DAYS ? p.balance : null,
    indicative: i >= CONFIRMED_DAYS ? p.balance : null,
    simulated: simulatedByDate?.get(p.date) ?? null,
    hasTaxEvent: p.events.some((e) => e.category === "tax"),
  }));

  const upcomingUnpaid = transactions.filter((t) => !t.paid).slice(0, 8);

  const overdueTodayForCalc = new Date();
  overdueTodayForCalc.setHours(0, 0, 0, 0);
  const overdueInvoices = transactions
    .filter((t) => !t.paid && t.kind === "income" && t.category !== "tax")
    .map((t) => ({
      ...t,
      daysOverdue: Math.round(
        (overdueTodayForCalc.getTime() - new Date(t.due_date).getTime()) / 86_400_000,
      ),
    }))
    .filter((t) => t.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

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
            {isAdmin && (
              <Link to="/admin">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <ShieldCheck className="size-4" /> Backoffice
                </Button>
              </Link>
            )}
            <Link to="/installningar">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <SettingsIcon className="size-4" /> Inställningar
              </Button>
            </Link>
            <NotificationBell />
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
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard
            icon={<Wallet className="size-4" />}
            label="Saldo idag"
            value={<CountUp value={forecast.startBalance} duration={800} />}
            sub={
              !(tinkStatus?.connected && tinkStatus.bankBalance != null)
                ? "Koppla bank för exakt saldo"
                : undefined
            }
          />
          {tinkStatus?.connected && tinkStatus.bankBalance != null && (
            <KpiCard
              icon={<Landmark className="size-4" />}
              label="Banksaldo"
              value={<CountUp value={tinkStatus.bankBalance} duration={800} />}
              sub={tinkStatus.bankCurrency ?? undefined}
            />
          )}
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
              Ditt Fortnox-saldo och bankens saldo skiljer sig med{" "}
              <strong>{formatSEK(Math.abs(tinkStatus.bankBalance - forecast.startBalance))}</strong>
              {" "}— troligen obetalda fakturor eller transaktioner som inte bokförts ännu.
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
            <div className="flex flex-col gap-1">
              <button
                onClick={copyShareUrl}
                className="inline-flex items-center gap-2 text-xs bg-secondary border border-border rounded-full px-3 py-1.5 hover:bg-secondary/70 max-w-full"
              >
                {shareCopied ? <Check className="size-3.5 text-success shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
                <span className="truncate font-mono">{shareUrl}</span>
              </button>
              <span className="text-xs text-muted-foreground">Länken är giltig i 30 dagar.</span>
            </div>
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

        {/* Kassaflödesmål */}
        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          {forecast.monthlyRevenueProgress ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-semibold">
                  Du är på {forecast.monthlyRevenueProgress.percentOfTarget}% av ditt månadsmål
                  för {formatMonthSv(forecast.monthlyRevenueProgress.month)}
                </h3>
                <button
                  onClick={() => {
                    setRevenueTargetInput(String(forecast.monthlyRevenueProgress!.target));
                    setEditingRevenueTarget((v) => !v);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                >
                  Ändra
                </button>
              </div>
              <div className="w-full h-2.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${forecast.monthlyRevenueProgress.onTrack ? "bg-success" : "bg-amber-500"}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, forecast.monthlyRevenueProgress.percentOfTarget))}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-3 mt-2 text-xs text-muted-foreground">
                <span>
                  {formatSEK(forecast.monthlyRevenueProgress.bookedSoFar)} av{" "}
                  {formatSEK(forecast.monthlyRevenueProgress.target)}
                </span>
                <span
                  className={
                    forecast.monthlyRevenueProgress.onTrack ? "text-success" : "text-amber-500"
                  }
                >
                  {forecast.monthlyRevenueProgress.onTrack ? "På rätt spår" : "Ligger efter"} —
                  prognos {formatSEK(forecast.monthlyRevenueProgress.projectedTotal)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Kassaflödesmål</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Sätt ett månadsmål för att följa hur intäkterna ligger till.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRevenueTargetInput("");
                  setEditingRevenueTarget(true);
                }}
              >
                Sätt mål
              </Button>
            </div>
          )}
          {editingRevenueTarget && (
            <div className="mt-4 flex items-end gap-2 max-w-md">
              <div className="flex-1">
                <Label htmlFor="revenueTarget">Månadsmål (SEK)</Label>
                <Input
                  id="revenueTarget"
                  type="number"
                  placeholder="t.ex. 150000"
                  value={revenueTargetInput}
                  onChange={(e) => setRevenueTargetInput(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveRevenueTarget}>Spara</Button>
              {forecast.monthlyRevenueProgress && (
                <Button variant="ghost" onClick={handleClearRevenueTarget}>
                  Ta bort
                </Button>
              )}
            </div>
          )}
        </section>

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

        {/* Försenade kundfakturor — bredvid varningsrutan */}
        {overdueInvoices.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold mb-3">Försenade kundfakturor</h3>
            <ul className="space-y-3">
              {overdueInvoices.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 text-sm flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{t.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSEK(Number(t.amount))} · {t.daysOverdue} dagar försenad
                    </div>
                  </div>
                  {t.reminder_sent_at ? (
                    <span className="text-xs text-muted-foreground shrink-0">
                      Påminnelse skickad {formatDateSv(t.reminder_sent_at.slice(0, 10))} — inväntar
                      svar
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sendingReminderId === t.id}
                      onClick={() => handleSendReminder(t.id)}
                      className="shrink-0"
                    >
                      <BellRing className="size-3.5" />
                      {sendingReminderId === t.id ? "Skickar…" : "Skicka påminnelse"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Forecast chart */}
        <section className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <h2 className="text-base font-semibold">Prognos 30 dagar framåt</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bekräftad dag 0–14, indikativ dag 15–30
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setSimulateOpen(true)}>
                <FlaskConical className="size-3.5" /> Simulera
              </Button>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-0.5 bg-[var(--color-chart-1)]" />
                  Bekräftad
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-0.5 opacity-60"
                    style={{
                      borderTop: "2px dashed var(--color-chart-1)",
                      background: "transparent",
                    }}
                  />
                  Indikativ
                </span>
                {simulationResult && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-0.5"
                      style={{
                        borderTop: "2px dashed var(--color-chart-3)",
                        background: "transparent",
                      }}
                    />
                    Simulering
                  </span>
                )}
              </div>
            </div>
          </div>

          {simulationResult && (
            <div
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-chart-3)",
                backgroundColor: "color-mix(in oklab, var(--color-chart-3) 8%, transparent)",
              }}
            >
              <span className="text-foreground">{simulationResult.summary}</span>
              <button
                onClick={() => setSimulationResult(null)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Rensa simulering"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

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
                  formatter={(value: number, name: string) => [
                    formatSEK(value),
                    name === "simulated" ? "Simulerat saldo" : "Saldo",
                  ]}
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
                  dot={({
                    key,
                    ...dotProps
                  }: {
                    key?: string;
                    cx?: number;
                    cy?: number;
                    payload?: { hasTaxEvent?: boolean };
                  }) => <TaxDot key={key} {...dotProps} />}
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
                  dot={({
                    key,
                    ...dotProps
                  }: {
                    key?: string;
                    cx?: number;
                    cy?: number;
                    payload?: { hasTaxEvent?: boolean };
                  }) => <TaxDot key={key} {...dotProps} />}
                  isAnimationActive
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                {simulationResult && (
                  <Area
                    type="monotone"
                    dataKey="simulated"
                    stroke="var(--color-chart-3)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    fill="transparent"
                    connectNulls
                    isAnimationActive
                    animationDuration={600}
                  />
                )}
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
            suggestions={aiSuggestions}
            injectRef={chatInjectRef}
          />
        </section>
      </main>

      {simulateOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
          onClick={() => setSimulateOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-semibold">Simulera ett scenario</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Se hur en åtgärd hade påverkat prognosen — rör aldrig din riktiga data.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {SIMULATION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSimulateAction(o.value)}
                  className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    simulateAction === o.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <div className="text-sm font-medium">{o.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{o.description}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {SIMULATION_OPTIONS.find((o) => o.value === simulateAction)?.needsAmount && (
                <div>
                  <Label>Belopp (SEK)</Label>
                  <Input
                    type="number"
                    value={simulateAmount}
                    onChange={(e) => setSimulateAmount(e.target.value)}
                  />
                </div>
              )}
              <div
                className={
                  SIMULATION_OPTIONS.find((o) => o.value === simulateAction)?.needsAmount
                    ? ""
                    : "col-span-2"
                }
              >
                <Label>
                  {SIMULATION_OPTIONS.find((o) => o.value === simulateAction)?.dateLabel}
                </Label>
                <Input
                  type="date"
                  value={simulateDate}
                  onChange={(e) => setSimulateDate(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSimulateOpen(false)}
                disabled={simulating}
              >
                Avbryt
              </Button>
              <Button size="sm" onClick={handleSimulate} disabled={simulating}>
                {simulating ? "Simulerar…" : "Simulera"}
              </Button>
            </div>
          </div>
        </div>
      )}
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

/**
 * Custom Recharts-dot — ritas bara på dagar med minst en skattehändelse
 * (hasTaxEvent), så skatteförfall syns direkt i prognoslinjen och inte
 * bara i "Kommande skatter"-kortet under grafen. Röd (destructive) med
 * avsikt — skiljer den från den mjukare tax-färgen (blå/lila) som redan
 * används i den passiva listvyn, för att markera att det här är något
 * som faktiskt påverkar linjen just den dagen.
 */
function TaxDot(props: { cx?: number; cy?: number; payload?: { hasTaxEvent?: boolean } }) {
  const { cx, cy, payload } = props;
  if (!payload?.hasTaxEvent || cx == null || cy == null) return <g />;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill="var(--color-destructive)"
        stroke="var(--color-card)"
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight={700}
        fill="white"
      >
        §
      </text>
    </g>
  );
}

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
      suggestions={suggestions}
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
