import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Eye,
  ShieldCheck,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatSEK, formatDateSv } from "@/lib/forecast";
import {
  deleteAgencyClient,
  getAgencyClients,
  inviteAgencyClient,
  upsertAgencyClient,
  type AgencyClient,
} from "@/lib/api/agency.functions";

import logo from "@/assets/pejl-logo.png";

export const Route = createFileRoute("/_authenticated/byra")({
  head: () => ({
    meta: [
      { title: "Byråvy — Pejl" },
      { name: "description", content: "Översikt över alla klienter för redovisningsbyrån." },
    ],
  }),
  component: AgencyPage,
});

type FormState = Omit<AgencyClient, "id"> & { id?: string };

const emptyForm: FormState = {
  name: "",
  current_balance: 0,
  threshold: 0,
  next_warning_date: null,
  next_warning_amount: null,
  status: "green",
  notes: null,
  client_user_id: null,
};

function statusBadge(status: AgencyClient["status"]) {
  const map = {
    green: { label: "Stabil", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" },
    yellow: { label: "Bevaka", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
    red: { label: "Åtgärd krävs", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30", dot: "bg-rose-500" },
  } as const;
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function AgencyPage() {
  const navigate = useNavigate();
  const fetchClients = useServerFn(getAgencyClients);
  const saveClient = useServerFn(upsertAgencyClient);
  const removeClient = useServerFn(deleteAgencyClient);
  const inviteClient = useServerFn(inviteAgencyClient);

  const [loading, setLoading] = useState(true);
  const [isAgency, setIsAgency] = useState(false);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [inviting, setInviting] = useState<{ id: string; name: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchClients();
      setIsAgency(res.isAgency);
      setClients(res.clients);
    } catch (e) {
      toast.error("Kunde inte hämta klienter");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("Ange klientnamn");
      return;
    }
    try {
      await saveClient({
        data: {
          id: editing.id,
          client: {
            name: editing.name.trim(),
            current_balance: Number(editing.current_balance) || 0,
            threshold: Number(editing.threshold) || 0,
            next_warning_date: editing.next_warning_date || null,
            next_warning_amount:
              editing.next_warning_amount === null || editing.next_warning_amount === undefined
                ? null
                : Number(editing.next_warning_amount),
            status: editing.status,
            notes: editing.notes || null,
          },
        },
      });
      toast.success(editing.id ? "Klient uppdaterad" : "Klient tillagd");
      setEditing(null);
      load();
    } catch (e) {
      toast.error("Kunde inte spara");
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Ta bort denna klient?")) return;
    try {
      await removeClient({ data: { id } });
      toast.success("Klient borttagen");
      load();
    } catch (e) {
      toast.error("Kunde inte ta bort");
      console.error(e);
    }
  };

  const handleInvite = async () => {
    if (!inviting) return;
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      toast.error("Ange en giltig e-postadress");
      return;
    }
    setInviteSending(true);
    try {
      const result = await inviteClient({ data: { agencyClientId: inviting.id, email } });
      if (result.emailSent) {
        toast.success(`Inbjudan skickad till ${email}`);
      } else {
        toast.error(
          "Inbjudan skapades men mejlet kunde inte skickas — kontrollera Resend-konfigurationen.",
        );
      }
      setInviting(null);
      setInviteEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte skicka inbjudan");
      console.error(e);
    } finally {
      setInviteSending(false);
    }
  };

  const counts = {
    green: clients.filter((c) => c.status === "green").length,
    yellow: clients.filter((c) => c.status === "yellow").length,
    red: clients.filter((c) => c.status === "red").length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-secondary/30 to-background pb-24">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Pejl" width={32} height={32} />
            <div>
              <div className="font-semibold leading-none">Pejl · Byrå</div>
              <div className="text-xs text-muted-foreground leading-none mt-0.5">Klientöversikt</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
            <ArrowLeft className="size-4" /> Tillbaka
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Laddar...</div>
        ) : !isAgency ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
            <ShieldCheck className="size-8 text-muted-foreground mx-auto" />
            <h1 className="text-lg font-semibold">Byrårollen är inte aktiverad</h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Denna vy är för redovisningsbyråer som vill följa flera klienter samtidigt.
              Kontakta oss för att aktivera byrårollen för ditt konto.
            </p>
            <Link to="/dashboard">
              <Button variant="outline" size="sm">Tillbaka till översikten</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Stabila" value={counts.green} tone="emerald" />
              <StatCard label="Bevaka" value={counts.yellow} tone="amber" />
              <StatCard label="Åtgärd krävs" value={counts.red} tone="rose" />
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Klienter ({clients.length})</h2>
              <Button size="sm" onClick={() => setEditing({ ...emptyForm })}>
                <Plus className="size-4" /> Lägg till klient
              </Button>
            </div>

            {clients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
                Inga klienter ännu. Klicka på "Lägg till klient" för att komma igång.
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium">Klient</th>
                      <th className="text-right px-4 py-2.5 font-medium">Saldo idag</th>
                      <th className="text-left px-4 py-2.5 font-medium">Nästa varning</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clients.map((c) => (
                      <tr key={c.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3">{statusBadge(c.status)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{c.name}</div>
                          {c.notes ? (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.notes}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div className={c.current_balance < c.threshold ? "text-rose-400 font-medium" : ""}>
                            {formatSEK(Number(c.current_balance))}
                          </div>
                          <div className="text-xs text-muted-foreground">gräns {formatSEK(Number(c.threshold))}</div>
                        </td>
                        <td className="px-4 py-3">
                          {c.next_warning_date ? (
                            <div className="flex items-start gap-1.5">
                              <AlertTriangle className="size-3.5 text-amber-400 mt-0.5 shrink-0" />
                              <div>
                                <div className="text-xs">{formatDateSv(c.next_warning_date)}</div>
                                {c.next_warning_amount !== null ? (
                                  <div className="text-xs text-muted-foreground tabular-nums">
                                    saldo ~{formatSEK(Number(c.next_warning_amount))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Ingen</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end items-center gap-1">
                            {c.client_user_id ? (
                              <span
                                className="inline-flex items-center gap-1 text-xs text-emerald-400 mr-1"
                                title="Klienten har accepterat inbjudan och är kopplad till ett konto"
                              >
                                <CheckCircle2 className="size-3.5" /> Kopplad
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setInviting({ id: c.id, name: c.name });
                                  setInviteEmail("");
                                }}
                                title="Bjud in klienten att koppla sitt konto"
                              >
                                <Mail className="size-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {editing && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">{editing.id ? "Redigera klient" : "Ny klient"}</h3>
            <div className="space-y-3">
              <div>
                <Label>Klientnamn</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Exempel AB" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Saldo idag (SEK)</Label>
                  <Input type="number" value={editing.current_balance} onChange={(e) => setEditing({ ...editing, current_balance: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Varningsgräns</Label>
                  <Input type="number" value={editing.threshold} onChange={(e) => setEditing({ ...editing, threshold: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(["green", "yellow", "red"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setEditing({ ...editing, status: s })}
                      className={`rounded-md border px-2 py-1.5 text-xs ${editing.status === s ? "border-primary bg-primary/10" : "border-border"}`}
                    >
                      {statusBadge(s)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nästa varning (datum)</Label>
                  <Input type="date" value={editing.next_warning_date ?? ""} onChange={(e) => setEditing({ ...editing, next_warning_date: e.target.value || null })} />
                </div>
                <div>
                  <Label>Vid saldo (SEK)</Label>
                  <Input type="number" value={editing.next_warning_amount ?? ""} onChange={(e) => setEditing({ ...editing, next_warning_amount: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>Anteckning (valfritt)</Label>
                <Input value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })} placeholder="Ex. väntar på kundfaktura" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Avbryt</Button>
              <Button size="sm" onClick={handleSave}>Spara</Button>
            </div>
          </div>
        </div>
      )}

      {inviting && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
          onClick={() => setInviting(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold">Bjud in {inviting.name}</h3>
            <p className="text-sm text-muted-foreground">
              Klientens e-postadress skickas ett mejl med en länk för att koppla sitt Pejl-konto
              till den här klienten. Efter det visas deras faktiska saldo och prognos här istället
              för de manuellt satta värdena.
            </p>
            <div>
              <Label>E-postadress</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="klient@exempel.se"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInviting(null)}
                disabled={inviteSending}
              >
                Avbryt
              </Button>
              <Button size="sm" onClick={handleInvite} disabled={inviteSending}>
                {inviteSending ? "Skickar…" : "Skicka inbjudan"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" }) {
  const cls = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-400",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-400",
  }[tone];
  return (
    <div className={`rounded-xl border ${cls} p-4`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-3xl font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  );
}
