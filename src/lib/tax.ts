import type { Tx } from "./forecast";

/**
 * Mock tax & employer-fee events. Real data should later come from
 * Skatteverket / Fortnox payroll module. Dates and amounts are fixed
 * mockdata so prognosen alltid räknar med dessa poster automatiskt.
 */
export function computeTaxEvents(_fromDate: Date = new Date()): Tx[] {
  return [
    {
      id: "tax-moms-202606",
      kind: "expense",
      amount: 18500,
      due_date: "2026-06-26",
      description: "Momsdeklaration (uppskattat)",
      paid: false,
      category: "tax",
    },
    {
      id: "tax-arbg-202606",
      kind: "expense",
      amount: 9800,
      due_date: "2026-06-12",
      description: "Arbetsgivaravgifter & avdragen skatt",
      paid: false,
      category: "tax",
    },
  ];
}
