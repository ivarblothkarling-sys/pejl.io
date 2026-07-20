import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { exchangeTinkCode } from "@/lib/api/tink.functions";
import { Button } from "@/components/ui/button";

const TINK_REDIRECT_URI = "https://pejl.io/auth/tink/callback";

export const Route = createFileRoute("/auth/tink/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Ansluter bank — Pejl" }] }),
  component: TinkCallback,
});

function TinkCallback() {
  const navigate = useNavigate();
  const exchange = useServerFn(exchangeTinkCode);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Ansluter till din bank…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const err = url.searchParams.get("error");
        if (err) throw new Error(url.searchParams.get("message") ?? err);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) throw new Error("Ingen kod mottagen från Tink.");
        if (!state) throw new Error("Säkerhetskontrollen från Tink saknas. Starta kopplingen igen.");
        await exchange({ data: { code, state, redirectUri: TINK_REDIRECT_URI } });
        setStatus("ok");
        setMessage("Bank ansluten.");
        setTimeout(() => {
          navigate({ to: "/dashboard", search: { tink: "connected" } as never });
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
        {status === "loading" && <Loader2 className="size-8 mx-auto mb-3 animate-spin text-muted-foreground" />}
        {status === "ok" && <CheckCircle2 className="size-8 mx-auto mb-3 text-success" />}
        {status === "error" && <AlertTriangle className="size-8 mx-auto mb-3 text-destructive" />}
        <p className="text-sm text-foreground">{message}</p>
        {status === "error" && (
          <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>
            Till dashboarden
          </Button>
        )}
      </div>
    </div>
  );
}
