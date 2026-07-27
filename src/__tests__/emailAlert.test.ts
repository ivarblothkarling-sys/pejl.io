import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendLowBalanceEmail } from "@/lib/emailAlert.server";
import type { ForecastResult } from "@/lib/forecast";

const originalResendKey = process.env.RESEND_API_KEY;

const dummyForecast: ForecastResult = {
  points: [],
  threshold: 1000,
  startBalance: 500,
  endBalance: 500,
  minBalance: 500,
  minDate: "2026-07-15",
  breachDate: "2026-07-20",
  breachAmount: 300,
  monthlyRevenueProgress: null,
};

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  if (originalResendKey !== undefined) process.env.RESEND_API_KEY = originalResendKey;
  vi.restoreAllMocks();
});

describe("sendLowBalanceEmail", () => {
  it("skickar inget mejl om RESEND_API_KEY saknas", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await sendLowBalanceEmail({
      to: "test@example.com",
      companyName: "Test AB",
      forecast: dummyForecast,
    });

    expect(result).toEqual({ ok: false, error: "missing_keys" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
