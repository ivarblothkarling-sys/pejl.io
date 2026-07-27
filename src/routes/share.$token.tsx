import { createFileRoute, notFound } from "@tanstack/react-router";
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
import {
  AlertTriangle,
  Eye,
  Gauge,
  Landmark,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { formatDateSv, formatMonthSv, formatSEK, type Tx } from "@/lib/forecast";
import { getSharedDashboard } from "@/lib/api/share.functions";
import logo from "@/assets/pejl-logo.png";

type SharedData = Awaited<ReturnType<typeof getSharedDashboard>>;
type InvestorData = Extract<SharedData, { viewType: "investor" }>;
type DashboardShareData = Extract<SharedData, { viewType: "dashboard" }>;

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Delad likviditetsprognos — Pejl" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  loader: ({ params }) => getSharedDashboard({ data: { token: params.token } }),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground p-6 text-center">
      Kunde inte ladda delad vy. {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground p-6 text-center">
      Länken är ogiltig eller har upphört.
    </div>
  ),
  component: SharedDashboard,
});

function ShareHeader({ companyName, badgeLabel }: { companyName: string; badgeLabel: string }) {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="Pejl" width={32} height={32} />
          <div>
            <div className="font-semibold leading-none">Pejl</div>
            <div className="text-xs text-muted-foreground leading-none mt-0.5">{companyName}</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary border border-border rounded-full px-2.5 py-1">
          <Eye className="size-3.5" /> {badgeLabel}
        </span>
      </div>
    </header>
  );
}

function SharedDashboard() {
  const result = Route.useLoaderData() as SharedData;
  if (result.viewType === "investor") {
    return <InvestorSharedView data={result} />;
  }
  return <DashboardSharedView data={result} />;
}

function DashboardSharedView({ data }: { data: DashboardShareData }) {
  const { profile, forecast, transactions } = data;
  const hasBreach = !!forecast.breachDate;

  const chartData = forecast.points.map((p: DashboardShareData["forecast"]["points"][number]) => ({
    ...p,
    label: formatDateSv(p.date),
    threshold: forecast.threshold,
  }));

  const upcoming = transactions.filter((t: Tx) => !t.paid).slice(0, 10);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <ShareHeader
        companyName={profile.company_name ?? "Företaget"}
        badgeLabel="Konsultvy — endast läsning"
      />

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={<Wallet className="size-4" />}
            label="Dagens saldo"
            value={formatSEK(forecast.startBalance)}
          />
          <KpiCard
            icon={
              forecast.endBalance >= forecast.startBalance ? (
                <TrendingUp className="size-4 text-success" />
              ) : (
                <TrendingDown className="size-4 text-destructive" />
              )
            }
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
          />
        </section>

        {hasBreach && (
          <div
            className="border border-destructive/40 rounded-xl p-4"
            style={{ backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)" }}
          >
            <div className="flex gap-3 items-start">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-foreground">
                  Saldot riskerar att gå under gränsen
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Den{" "}
                  <strong className="text-foreground">{formatDateSv(forecast.breachDate!)}</strong>{" "}
                  beräknas saldot vara{" "}
                  <strong className="text-foreground">
                    {formatSEK(forecast.breachAmount ?? 0)}
                  </strong>
                  , vilket är under varningsgränsen på {formatSEK(forecast.threshold)}.
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-1">Prognos 30 dagar framåt</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Baserat på bokförd data i Fortnox (mock).
          </p>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="balanceFillShare" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
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
                />
                <ReferenceLine
                  y={forecast.threshold}
                  stroke="var(--color-destructive)"
                  strokeDasharray="4 4"
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  fill="url(#balanceFillShare)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold mb-3">Kommande poster</h3>
          <ul className="space-y-2.5">
            {upcoming.map((t: Tx) => {
              const isTax = t.category === "tax";
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0 flex items-center gap-2">
                    {isTax && <Landmark className="size-3.5 text-tax shrink-0" />}
                    <div className="min-w-0">
                      <div className={`truncate font-medium ${isTax ? "text-tax" : ""}`}>
                        {t.description}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateSv(t.due_date)}
                      </div>
                    </div>
                  </div>
                  <div
                    className={
                      t.kind === "income"
                        ? "text-success font-medium"
                        : isTax
                          ? "text-tax font-medium"
                          : "text-foreground font-medium"
                    }
                  >
                    {t.kind === "income" ? "+" : "−"}
                    {formatSEK(Number(t.amount))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="text-xs text-center text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          Pejl ger dig och din redovisningskonsult en gemensam bild av likviditeten framåt – baserat
          på bokförd data i Fortnox. Ersätter inte bokföring eller rådgivning. Du och din konsult
          beslutar alltid själv.
        </p>
      </main>
    </div>
  );
}

/**
 * Investerarvy — enbart aggregerade siffror (servern skickar aldrig
 * itemiserade transaktioner för den här view_type, se share.functions.ts),
 * så det finns ingen "Kommande poster"-lista här som i konsultvyn.
 */
function InvestorSharedView({ data }: { data: InvestorData }) {
  const { companyName, metrics } = data;
  const { forecast, monthlyBreakdown } = metrics;
  const hasBreach = !!forecast.breachDate;

  const chartData = forecast.points.map((p) => ({
    ...p,
    label: formatDateSv(p.date),
  }));

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <ShareHeader
        companyName={companyName}
        badgeLabel="Investerarvy — förenklad, ingen fakturadetalj"
      />

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard
            icon={<Wallet className="size-4" />}
            label="Saldo idag"
            value={formatSEK(metrics.currentBalance)}
          />
          <KpiCard
            icon={<Gauge className="size-4" />}
            label="Kassaflödeshorisont"
            value={metrics.runwayMonths != null ? `${metrics.runwayMonths} mån` : "Obegränsad"}
            sub={
              metrics.runwayMonths != null
                ? "vid nuvarande snittutgift"
                : "inga löpande utgifter i snittet"
            }
          />
          <KpiCard
            icon={
              metrics.netBurnPerMonth > 0 ? (
                <TrendingDown className="size-4 text-destructive" />
              ) : (
                <TrendingUp className="size-4 text-success" />
              )
            }
            label="Burn rate (netto/månad)"
            value={`${metrics.netBurnPerMonth > 0 ? "−" : "+"}${formatSEK(Math.abs(metrics.netBurnPerMonth))}`}
            sub="snitt senaste 3 månaderna"
          />
        </section>

        {hasBreach && (
          <div
            className="border border-destructive/40 rounded-xl p-4"
            style={{ backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)" }}
          >
            <div className="flex gap-3 items-start">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-foreground">
                  Saldot riskerar att gå under gränsen
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Den{" "}
                  <strong className="text-foreground">{formatDateSv(forecast.breachDate!)}</strong>{" "}
                  beräknas saldot vara{" "}
                  <strong className="text-foreground">
                    {formatSEK(forecast.breachAmount ?? 0)}
                  </strong>
                  .
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="bg-card border border-border rounded-2xl p-4 md:p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-1">Kassaflödesprognos, 90 dagar</h2>
          <p className="text-xs text-muted-foreground mb-4">Baserat på bokförd data i Fortnox.</p>
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="balanceFillInvestor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
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
                />
                <ReferenceLine
                  y={forecast.threshold}
                  stroke="var(--color-destructive)"
                  strokeDasharray="4 4"
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.5}
                  fill="url(#balanceFillInvestor)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold mb-3">Intäkter & utgifter, senaste 6 månaderna</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="font-normal pb-2">Månad</th>
                  <th className="font-normal pb-2 text-right">Intäkter</th>
                  <th className="font-normal pb-2 text-right">MoM</th>
                  <th className="font-normal pb-2 text-right">Utgifter</th>
                  <th className="font-normal pb-2 text-right">MoM</th>
                </tr>
              </thead>
              <tbody>
                {monthlyBreakdown.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="py-2 capitalize">{formatMonthSv(m.month)}</td>
                    <td className="py-2 text-right font-medium">{formatSEK(m.income)}</td>
                    <td
                      className={`py-2 text-right ${
                        m.incomeMomPct == null
                          ? "text-muted-foreground"
                          : m.incomeMomPct >= 0
                            ? "text-success"
                            : "text-destructive"
                      }`}
                    >
                      {m.incomeMomPct == null
                        ? "—"
                        : `${m.incomeMomPct > 0 ? "+" : ""}${m.incomeMomPct}%`}
                    </td>
                    <td className="py-2 text-right font-medium">{formatSEK(m.expense)}</td>
                    <td
                      className={`py-2 text-right ${
                        m.expenseMomPct == null
                          ? "text-muted-foreground"
                          : m.expenseMomPct <= 0
                            ? "text-success"
                            : "text-destructive"
                      }`}
                    >
                      {m.expenseMomPct == null
                        ? "—"
                        : `${m.expenseMomPct > 0 ? "+" : ""}${m.expenseMomPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-xs text-center text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          Förenklad investerarvy från Pejl — visar aggregerade nyckeltal, inga enskilda fakturor
          eller transaktioner. Ersätter inte bokföring eller rådgivning.
        </p>
      </main>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon} {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
