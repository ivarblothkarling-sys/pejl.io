import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bell, Landmark, Mail, RefreshCw, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNotifications, markNotificationRead } from "@/lib/api/notifications.functions";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_ICON: Record<string, typeof Bell> = {
  forecast_warning: AlertTriangle,
  sync_failed: RefreshCw,
  weekly_summary: Mail,
  bank_discrepancy: Landmark,
  payment_overdue: Clock,
};

function timeAgoSv(iso: string) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just nu";
  if (diffMin < 60) return `${diffMin} min sedan`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} tim sedan`;
  const diffD = Math.round(diffH / 24);
  return `${diffD} dag${diffD === 1 ? "" : "ar"} sedan`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const markReadFn = useServerFn(markNotificationRead);

  const load = async () => {
    try {
      const res = await getNotifications();
      setNotifications(res.notifications as Notification[]);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      console.error("[NotificationBell] Kunde inte hämta notiser:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMarkRead = async (n: Notification) => {
    if (n.read_at) return;
    setNotifications((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await markReadFn({ data: { id: n.id } });
    } catch (err) {
      console.error("[NotificationBell] Kunde inte markera notis som läst:", err);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative text-muted-foreground">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Notiser</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Laddar...</p>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Inga notiser än.</p>
          ) : (
            notifications.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => handleMarkRead(n)}
                  className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-secondary/50 ${
                    n.read_at ? "" : "bg-primary/5"
                  }`}
                >
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${n.read_at ? "text-muted-foreground" : "text-primary"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {!n.read_at && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {timeAgoSv(n.created_at)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
