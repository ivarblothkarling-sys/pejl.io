import type {
  AccountingProvider,
  AccountBalance,
  CompanyInfo,
  Invoice,
  SupplierInvoice,
  Transaction,
} from "../types";
import type { Tx } from "@/lib/forecast";

/**
 * Fortnox provider. Currently backed by the same mock/DB data that powers
 * the dashboard. When real Fortnox API integration is added, only this
 * file changes — every caller uses the provider-agnostic interface.
 */
export interface FortnoxContext {
  companyName: string;
  currentBalance: number;
  currency: string; // profile currency, defaults to SEK
  transactions: Tx[];
}

export function createFortnoxProvider(ctx: FortnoxContext): AccountingProvider {
  const currency = ctx.currency || "SEK";
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: "fortnox",

    async getCompanyInfo(): Promise<CompanyInfo> {
      return { name: ctx.companyName, country: "SE", currency };
    },

    async getAccountBalance(): Promise<AccountBalance> {
      return { currency, amount: ctx.currentBalance, asOf: today };
    },

    async getTransactions(): Promise<Transaction[]> {
      return ctx.transactions.map((t) => ({
        id: t.id,
        kind: t.kind,
        amount: Number(t.amount),
        dueDate: t.due_date,
        description: t.description,
        paid: t.paid,
        currency,
      }));
    },

    async getInvoices(): Promise<Invoice[]> {
      return ctx.transactions
        .filter((t) => t.kind === "income")
        .map((t) => ({
          id: t.id,
          customer: t.description,
          amount: Number(t.amount),
          dueDate: t.due_date,
          paid: t.paid,
          currency,
        }));
    },

    async getSupplierInvoices(): Promise<SupplierInvoice[]> {
      return ctx.transactions
        .filter((t) => t.kind === "expense" && t.category !== "tax")
        .map((t) => ({
          id: t.id,
          supplier: t.description,
          amount: Number(t.amount),
          dueDate: t.due_date,
          paid: t.paid,
          currency,
        }));
    },
  };
}
