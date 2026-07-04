// Provider-agnostic types for the accounting abstraction layer.
// All accounting providers (Fortnox, Tripletex, Xero, QuickBooks, ...)
// must map their native shapes into these.

export type AccountingProviderId = "fortnox" | "tripletex" | "xero" | "quickbooks";

export interface CompanyInfo {
  name: string;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  organizationNumber?: string;
}

export interface Invoice {
  id: string;
  number?: string;
  customer: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  paid: boolean;
  currency: string;
}

export interface SupplierInvoice {
  id: string;
  supplier: string;
  amount: number;
  dueDate: string;
  paid: boolean;
  currency: string;
}

export interface Transaction {
  id: string;
  kind: "income" | "expense";
  amount: number;
  dueDate: string;
  description: string;
  paid: boolean;
  currency: string;
}

export interface AccountBalance {
  currency: string;
  amount: number;
  asOf: string; // ISO date
}

export interface AccountingProvider {
  id: AccountingProviderId;
  getCompanyInfo(): Promise<CompanyInfo>;
  getInvoices(): Promise<Invoice[]>;
  getSupplierInvoices(): Promise<SupplierInvoice[]>;
  getTransactions(): Promise<Transaction[]>;
  getAccountBalance(): Promise<AccountBalance>;
}

export class ProviderNotImplementedError extends Error {
  constructor(public provider: AccountingProviderId) {
    super(`Provider "${provider}" is not yet available. Coming soon.`);
    this.name = "ProviderNotImplementedError";
  }
}
