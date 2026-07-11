import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { exchangeFortnoxCode } from "@/lib/api/fortnox.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/fortnox/callback")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Ansluter Fortnox — Pejl" }],
  }),
  component: FortnoxCallback,
});

function FortnoxCallback() {
  const navigate = useNavigate();
  const exchange = useServerFn(exchangeFortnoxCode);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Ansluter till Fortnox…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          navigate({ to: "/auth" });
          return;
        }
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err) throw new Error(err);
        if (!code) throw new Error("Ingen kod mottagen från Fortnox.");
        const state = url.searchParams.get("state") ?? undefined;
        const redirectUri = `${window.location.origin}/auth/fortnox/callback`;
        await exchange({ data: { code, state, redirectUri } });
        setStatus("ok");
        setMessage("Fortnox är anslutet.");
        setTimeout(() => {
          navigate({ to: "/dashboard", search: { fortnox: "connected" } as never });
        }, 900);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Något gick fel.");
      }
    })();
  }, [exchange, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-background via-secondary/40 to-background">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-sm text-center">
        {status === "loading" && (
          <Loader2 className="size-8 mx-auto mb-3 animate-spin text-muted-foreground" />
        )}
        {status === "ok" && (
          <CheckCircle2 className="size-8 mx-auto mb-3 text-success" />
        )}
        {status === "error" && (
          <AlertTriangle className="size-8 mx-auto mb-3 text-destructive" />
        )}
        <p className="text-sm text-foreground">{message}</p>
        {status === "error" && (
          <Button
            className="mt-4"
            onClick={() => navigate({ to: "/dashboard" })}
          >
            Till dashboarden
          </Button>
        )}
      </div>
    </div>
  );
}
