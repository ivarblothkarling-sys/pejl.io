import type { Tx } from "./forecast";

function nextOccurrence(dayOfMonth: number, from: Date): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  const candidate = new Date(base.getFullYear(), base.getMonth(), dayOfMonth);
  if (candidate < base) candidate.setMonth(candidate.getMonth() + 1);
  return candidate;
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Mock tax & employer-fee events. Real data should later come from
 * Skatteverket / Fortnox payroll module.
 */
export function computeTaxEvents(fromDate: Date = new Date()): Tx[] {
  const items = [
    { id: "moms", day: 26, amount: 18500, description: "Momsdeklaration (uppskattat)" },
    { id: "arbg", day: 12, amount: 14200, description: "Arbetsgivaravgifter & avdragen skatt" },
    { id: "fskatt", day: 12, amount: 8900, description: "F-skatt (preliminärskatt)" },
  ];
  return items.map((t) => {
    const due = nextOccurrence(t.day, fromDate);
    const ym = `${due.getFullYear()}${String(due.getMonth() + 1).padStart(2, "0")}`;
    return {
      id: `tax-${t.id}-${ym}`,
      kind: "expense" as const,
      amount: t.amount,
      due_date: fmtDate(due),
      description: t.description,
      paid: false,
      category: "tax" as const,
    };
  });
}
