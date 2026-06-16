import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { AlertTriangle, BellRing, CalendarClock, Check, Copy, Landmark, LogOut, Share2, Sparkles, TrendingDown, TrendingUp, Wallet } from "lucide-react";

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
import { formatDateSv, formatSEK } from "@/lib/forecast";
import {
  generateWeeklySummary,
  getDashboardData,
  updateThreshold,
} from "@/lib/api/finance.functions";
import { createShareLink } from "@/lib/api/share.functions";

import logo from "@/assets/pejl-logo.png";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Översikt — Pejl" },
      { name: "description", content: "Dagens saldo och 14-dagars likviditetsprognos för ditt företag." },
    ],
  }),
  component: DashboardPage,
});

type DashData = Awaited<ReturnType<typeof getDashboardData>>;

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


  const refresh = async () => {
    try {
      const result = await getDashboardData();
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
  }, []);

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


  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Hämtar din ekonomi…
      </div>
    );
  }

  const { profile, forecast, transactions } = data;
  const hasBreach = !!forecast.breachDate;

  const chartData = forecast.points.map((p) => ({
    ...p,
    label: formatDateSv(p.date),
    threshold: forecast.threshold,
  }));

  const upcomingUnpaid = transactions.filter((t) => !t.paid).slice(0, 8);

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
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground">
            <LogOut className="size-4" /> Logga ut
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        {/* KPI row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={<Wallet className="size-4" />} label="Dagens saldo" value={formatSEK(forecast.startBalance)} />
          <KpiCard
            icon={forecast.endBalance >= forecast.startBalance ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-destructive" />}
            label="Om 14 dagar"
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
            className="border border-destructive/40 rounded-xl p-4"
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
            {data.suggestions.length > 0 && (
              <div className="mt-4 pl-8">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Förslag
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {data.suggestions.map((s) => (
                    <button
                      key={s.txId + s.kind}
                      onClick={() =>
                        toast.success(
                          s.kind === "remind"
                            ? "Påminnelse skickad (demo)"
                            : "Betalning uppskjuten (demo)",
                          { description: s.detail },
                        )
                      }
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
                  Detta är en prognos baserat på bokförd data i Fortnox – inte bokförings- eller skatterådgivning. Du beslutar alltid själv.
                </p>
              </div>
            )}

          </div>
        )}

        {/* Forecast chart */}
        <section className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Prognos 14 dagar framåt</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Baserat på kända in- och utbetalningar</p>
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
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  fill="url(#balanceFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Upcoming + Weekly summary */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold mb-3">Kommande poster</h3>
            <ul className="space-y-2.5">
              {upcomingUnpaid.length === 0 && (
                <li className="text-sm text-muted-foreground">Inga obetalda poster.</li>
              )}
              {upcomingUnpaid.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.description}</div>
                    <div className="text-xs text-muted-foreground">{formatDateSv(t.due_date)}</div>
                  </div>
                  <div className={t.kind === "income" ? "text-success font-medium" : "text-foreground font-medium"}>
                    {t.kind === "income" ? "+" : "−"}
                    {formatSEK(Number(t.amount))}
                  </div>
                </li>
              ))}
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
                  Få en kort text om hur det ser ut just nu och varningar för kommande 14 dagar.
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
          <ChatPanel />
        </section>
      </main>
    </div>
  );
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
  value: string;
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

const SUGGESTED = [
  "Hur går det ekonomiskt just nu?",
  "Vilka fakturor är obetalda?",
  "När är saldot som lägst?",
];

function ChatPanel() {
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
      setInitialMessages(msgs);
    })();
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
    />
  );
}

function ChatInner({
  transport,
  initialMessages,
  persistedIds,
  taRef,
}: {
  transport: DefaultChatTransport<UIMessage>;
  initialMessages: UIMessage[];
  persistedIds: React.MutableRefObject<Set<string>>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
  });
  const isLoading = status === "submitted" || status === "streaming";

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
              description="Pejl svarar baserat på din Fortnox-data (mock) och 14-dagars prognosen."
            >
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {SUGGESTED.map((s) => (
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
