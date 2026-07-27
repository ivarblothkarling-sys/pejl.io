import { describe, expect, it } from "vitest";

import { dedupeSieImports, parseSie } from "@/lib/accounting/sie";

describe("parseSie", () => {
  it("hanterar en tom fil utan att kasta", () => {
    const result = parseSie("");

    expect(result).toEqual({
      companyName: "",
      accounts: {},
      openingBalances: {},
      closingBalances: {},
      vouchers: [],
    });
  });

  it("hanterar en fil med bara whitespace/radbrytningar", () => {
    const result = parseSie("\n\n   \r\n\t\n");

    expect(result.vouchers).toEqual([]);
    expect(result.companyName).toBe("");
  });
});

describe("dedupeSieImports", () => {
  it("skippar transaktioner som redan finns (matchar due_date+amount)", () => {
    const candidates = [
      { due_date: "2026-07-01", amount: 1000, description: "Hyra" },
      { due_date: "2026-07-02", amount: 500, description: "Ny leverantör" },
    ];
    const existing = [{ due_date: "2026-07-01", amount: 1000 }];

    const result = dedupeSieImports(candidates, existing);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Ny leverantör");
  });

  it("behåller allt om inget redan importerats", () => {
    const candidates = [
      { due_date: "2026-07-01", amount: 1000 },
      { due_date: "2026-07-02", amount: 500 },
    ];

    const result = dedupeSieImports(candidates, []);

    expect(result).toHaveLength(2);
  });

  it("skiljer på samma datum med olika belopp", () => {
    const candidates = [{ due_date: "2026-07-01", amount: 999 }];
    const existing = [{ due_date: "2026-07-01", amount: 1000 }];

    const result = dedupeSieImports(candidates, existing);

    expect(result).toHaveLength(1);
  });
});
