import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { acceptAgencyInvite } from "@/lib/api/agency.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/accept-invite")({
  ssr: false,
  head: () => ({ meta: [{ title: "Acceptera inbjudan — Pejl" }] }),
  component: AcceptInvitePage,
});

type Status = "loading" | "needs-login" | "ok" | "error";

function AcceptInvitePage() {
  const navigate = useNavigate();
  const accept = useServerFn(acceptAgencyInvite);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Kontrollerar inbjudan…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const token = url.searchParams.get("token");
        if (!token) throw new Error("Ingen inbjudningskod hittades i länken.");

        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          setStatus("needs-login");
          setMessage("Logga in för att acceptera inbjudan.");
          return;
        }

        const result = await accept({ data: { token } });
        setStatus("ok");
        setMessage(`Du är nu kopplad som ${result.clientName}.`);
        setTimeout(() => {
          navigate({ to: "/dashboard" });
        }, 1200);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Något gick fel.");
      }
    })();
  }, [accept, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-background via-secondary/40 to-background">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-sm text-center">
        {status === "loading" && (
          <Loader2 className="size-8 mx-auto mb-3 animate-spin text-muted-foreground" />
        )}
        {status === "ok" && <CheckCircle2 className="size-8 mx-auto mb-3 text-success" />}
        {(status === "error" || status === "needs-login") && (
          <AlertTriangle className="size-8 mx-auto mb-3 text-destructive" />
        )}
        <p className="text-sm text-foreground">{message}</p>
        {status === "needs-login" && (
          <>
            <p className="text-xs text-muted-foreground mt-2">
              Logga in och klicka sedan på inbjudningslänken i mejlet igen.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/auth">Logga in</Link>
            </Button>
          </>
        )}
        {status === "error" && (
          <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>
            Till dashboarden
          </Button>
        )}
      </div>
    </div>
  );
}
