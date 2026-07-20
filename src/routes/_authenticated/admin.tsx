import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Shield, Users, Trash2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getAdminStats,
  listAdminUsers,
  toggleAdminUserRole,
  deleteAdminUserData,
} from "@/lib/api/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Backoffice — Pejl" }] }),
  component: AdminPage,
});

function formatSEK(n: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);
}

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statsFn = useServerFn(getAdminStats);
  const listFn = useServerFn(listAdminUsers);
  const toggleFn = useServerFn(toggleAdminUserRole);
  const wipeFn = useServerFn(deleteAdminUserData);

  const [search, setSearch] = useState("");

  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn() });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });

  const toggleMut = useMutation({
    mutationFn: (v: { targetUserId: string; role: "admin" | "agency" }) => toggleFn({ data: v }),
    onSuccess: (res) => {
      toast.success(res.granted ? "Roll tilldelad" : "Roll borttagen");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Fel"),
  });

  const wipeMut = useMutation({
    mutationFn: (targetUserId: string) => wipeFn({ data: { targetUserId } }),
    onSuccess: () => {
      toast.success("Transaktioner rensade");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Fel"),
  });

  // Om användaren inte är admin returnerar servern 403 — visa vänligt meddelande.
  const forbidden =
    (stats.error instanceof Error && /Forbidden/i.test(stats.error.message)) ||
    (users.error instanceof Error && /Forbidden/i.test(users.error.message));

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <Shield className="size-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Ingen åtkomst</h1>
          <p className="text-sm text-muted-foreground">
            Backoffice är endast för admin-konton. Kontakta Ivar eller Lucas för att få rollen tilldelad.
          </p>
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Tillbaka
          </Button>
        </div>
      </div>
    );
  }

  const filtered = (users.data ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.company_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm"><ArrowLeft className="size-4" /> Dashboard</Button>
            </Link>
            <div>
              <div className="font-semibold flex items-center gap-2"><Shield className="size-4" /> Backoffice</div>
              <div className="text-xs text-muted-foreground">Endast för admin</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { stats.refetch(); users.refetch(); }}>
            <RefreshCw className="size-4" /> Uppdatera
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        <section>
          <h2 className="text-lg font-semibold mb-3">Översikt</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Användare" value={stats.data?.userCount ?? "…"} />
            <StatCard label="Fortnox-kopplingar" value={stats.data?.fortnoxConnected ?? "…"} />
            <StatCard label="Tink-kopplingar" value={stats.data?.tinkConnected ?? "…"} />
            <StatCard label="Transaktioner" value={stats.data?.transactionCount ?? "…"} />
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Senaste registreringar</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">E-post</th>
                  <th className="p-3">Företag</th>
                  <th className="p-3">Skapad</th>
                </tr>
              </thead>
              <tbody>
                {(stats.data?.recentSignups ?? []).map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="p-3 font-mono text-xs">{u.email}</td>
                    <td className="p-3">{u.company_name}</td>
                    <td className="p-3 text-muted-foreground">{new Date(u.created_at).toLocaleString("sv-SE")}</td>
                  </tr>
                ))}
                {stats.data && stats.data.recentSignups.length === 0 && (
                  <tr><td colSpan={3} className="p-6 text-center text-muted-foreground text-sm">Inga registreringar än.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="size-4" /> Alla användare</h2>
            <Input
              placeholder="Sök e-post eller företag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">E-post</th>
                  <th className="p-3">Företag</th>
                  <th className="p-3 text-right">Saldo</th>
                  <th className="p-3 text-right">Gräns</th>
                  <th className="p-3">Integrationer</th>
                  <th className="p-3">Roller</th>
                  <th className="p-3 text-right">Trans.</th>
                  <th className="p-3">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {users.isLoading && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground text-sm">Laddar…</td></tr>
                )}
                {filtered.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="p-3 font-mono text-xs">{u.email}</td>
                    <td className="p-3">{u.company_name}</td>
                    <td className="p-3 text-right">{formatSEK(u.current_balance)}</td>
                    <td className="p-3 text-right">{formatSEK(u.threshold)}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {u.fortnox && <Badge variant="outline" className="text-xs">Fortnox</Badge>}
                        {u.tink && <Badge variant="outline" className="text-xs">Tink</Badge>}
                        {!u.fortnox && !u.tink && <span className="text-xs text-muted-foreground">–</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {u.roles.map((r) => <Badge key={r} className="text-xs">{r}</Badge>)}
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground">–</span>}
                      </div>
                    </td>
                    <td className="p-3 text-right">{u.transaction_count}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleMut.isPending}
                          onClick={() => toggleMut.mutate({ targetUserId: u.id, role: "admin" })}
                        >
                          {u.roles.includes("admin") ? "− admin" : "+ admin"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={toggleMut.isPending}
                          onClick={() => toggleMut.mutate({ targetUserId: u.id, role: "agency" })}
                        >
                          {u.roles.includes("agency") ? "− byrå" : "+ byrå"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={wipeMut.isPending}
                          onClick={() => {
                            if (confirm(`Radera ALLA transaktioner för ${u.email}?`)) wipeMut.mutate(u.id);
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.isLoading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground text-sm">Inga träffar.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
