import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeForecast, type Tx } from "@/lib/forecast";

const originalTZ = process.env.TZ;

beforeEach(() => {
  // Pinnar tidszonen till UTC för alla tester utom det som explicit testar
  // tidszons-säkerhet nedan — annars vore due_date-baserade assertions
  // beroende på CI-runnerns lokala tidszon.
  process.env.TZ = "UTC";
});

afterEach(() => {
  process.env.TZ = originalTZ;
});

describe("computeForecast", () => {
  it("returnerar 30 dagars noll-saldo för en tom transaktionslista", () => {
    // country: null stänger av auto-injektionen av skattehändelser — annars
    // skulle t.ex. momsförfall injiceras även med en "tom" transaktionslista.
    const result = computeForecast(0, 0, [], 30, new Date(Date.UTC(2026, 6, 15)), null);

    expect(result.points).toHaveLength(31); // dag 0 t.o.m. dag 30
    expect(result.points.every((p) => p.balance === 0)).toBe(true);
    expect(result.startBalance).toBe(0);
    expect(result.endBalance).toBe(0);
    expect(result.minBalance).toBe(0);
    expect(result.breachDate).toBeNull();
  });

  it("ger samma resultat oavsett systemets tidszon, för samma lokala kalenderdag", () => {
    // toUtcMidnight normaliserar "idag" (fromDate, i maskinens lokala tid)
    // till UTC-midnatt för SAMMA kalenderdatum — annars skulle en användare
    // i en tidszon före UTC (t.ex. Sverige) få dagens datum tolkat som
    // gårdagen när det jämförs mot due_date-strängar (alltid UTC-midnatt
    // per Date-konstruktorns spec). Testar det genom att köra samma lokala
    // kalenderdag (15 juli) under tre vitt skilda tidszoner och kräva
    // identiskt resultat.
    const txs: Tx[] = [
      {
        id: "tx-1",
        kind: "income",
        amount: 1000,
        due_date: "2026-07-15",
        description: "Kundfaktura idag",
        paid: false,
      },
      {
        id: "tx-2",
        kind: "expense",
        amount: 400,
        due_date: "2026-07-20",
        description: "Leverantörsfaktura",
        paid: false,
      },
    ];

    const runForTz = (tz: string) => {
      process.env.TZ = tz;
      // Konstrueras EFTER att TZ satts, med lokala komponenter — precis som
      // en riktig new Date() skulle representera "idag, lokal tid" på en
      // maskin i den tidszonen.
      const fromDate = new Date(2026, 6, 15, 9, 0, 0);
      return computeForecast(5000, 1000, txs, 10, fromDate, null);
    };

    const sweden = runForTz("Europe/Stockholm"); // UTC+1/+2 — scenariot kommentaren i toUtcMidnight beskriver
    const kiritimati = runForTz("Pacific/Kiritimati"); // UTC+14
    const west = runForTz("Etc/GMT+12"); // UTC-12

    for (const result of [sweden, kiritimati, west]) {
      expect(result.points[0].date).toBe("2026-07-15");
      expect(result.points[0].delta).toBe(1000); // dagens faktura räknas med på dag 0
    }

    expect(sweden.points.map((p) => p.date)).toEqual(kiritimati.points.map((p) => p.date));
    expect(sweden.points.map((p) => p.balance)).toEqual(kiritimati.points.map((p) => p.balance));
    expect(sweden.points.map((p) => p.date)).toEqual(west.points.map((p) => p.date));
    expect(sweden.points.map((p) => p.balance)).toEqual(west.points.map((p) => p.balance));
  });

  it("confidence_score sjunker med avstånd i tiden", () => {
    // Inga transaktioner/skattehändelser (country: null) — isolerar
    // confidence_score till ren avstånds-nedgång, utan predicted-/
    // säsongsstraff som annars skulle störa den monotona nedgången.
    const result = computeForecast(10_000, 1000, [], 30, new Date(Date.UTC(2026, 6, 15)), null);

    expect(result.points[0].confidence_score).toBe(100); // dagens saldo är känt
    expect(result.points[10].confidence_score).toBe(78); // max(5, round(100 - 10*2.2))
    expect(result.points[30].confidence_score).toBe(34); // max(5, round(100 - 30*2.2))

    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].confidence_score).toBeLessThanOrEqual(
        result.points[i - 1].confidence_score,
      );
    }
  });

  it("inkluderar transaktioner med förfallodatum idag (dag 0) korrekt", () => {
    const fromDate = new Date(Date.UTC(2026, 6, 15));
    const txs: Tx[] = [
      {
        id: "today-income",
        kind: "income",
        amount: 500,
        due_date: "2026-07-15",
        description: "Kundfaktura idag",
        paid: false,
      },
    ];

    const result = computeForecast(1000, 0, txs, 10, fromDate, null);

    expect(result.points[0].date).toBe("2026-07-15");
    expect(result.points[0].delta).toBe(500);
    expect(result.points[0].balance).toBe(1500);
    expect(result.points[0].events).toHaveLength(1);
    expect(result.points[0].events[0]).toMatchObject({
      description: "Kundfaktura idag",
      amount: 500,
      kind: "income",
    });
    expect(result.startBalance).toBe(1000);
  });
});
