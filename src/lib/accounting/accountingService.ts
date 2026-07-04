import type { AccountingProvider, AccountingProviderId } from "./types";
import { ProviderNotImplementedError } from "./types";
import { createFortnoxProvider, type FortnoxContext } from "./providers/fortnox";
import { tripletexProvider, xeroProvider, quickbooksProvider } from "./providers/stubs";

/**
 * Provider registry. Fortnox is the only fully-implemented provider today;
 * the others resolve to typed stubs that throw ProviderNotImplementedError.
 */
export interface ResolveProviderInput {
  providerId: AccountingProviderId;
  fortnox: FortnoxContext;
}

export function resolveAccountingProvider(input: ResolveProviderInput): AccountingProvider {
  switch (input.providerId) {
    case "fortnox":
      return createFortnoxProvider(input.fortnox);
    case "tripletex":
      return tripletexProvider;
    case "xero":
      return xeroProvider;
    case "quickbooks":
      return quickbooksProvider;
    default:
      throw new ProviderNotImplementedError(input.providerId);
  }
}

// Public API — provider-agnostic shortcuts. Each takes a resolved provider.
// Consumers (server functions, dashboards) call these instead of touching
// provider internals directly.
export const accountingService = {
  getCompanyInfo: (p: AccountingProvider) => p.getCompanyInfo(),
  getAccountBalance: (p: AccountingProvider) => p.getAccountBalance(),
  getTransactions: (p: AccountingProvider) => p.getTransactions(),
  getInvoices: (p: AccountingProvider) => p.getInvoices(),
  getSupplierInvoices: (p: AccountingProvider) => p.getSupplierInvoices(),
};

export const AVAILABLE_PROVIDERS: {
  id: AccountingProviderId;
  name: string;
  country: string;
  flag: string;
  status: "available" | "coming_soon";
}[] = [
  { id: "fortnox", name: "Fortnox", country: "Sverige", flag: "🇸🇪", status: "available" },
  { id: "tripletex", name: "Tripletex", country: "Norge", flag: "🇳🇴", status: "coming_soon" },
  { id: "xero", name: "Xero", country: "UK / Global", flag: "🇬🇧", status: "coming_soon" },
  { id: "quickbooks", name: "QuickBooks", country: "USA", flag: "🇺🇸", status: "coming_soon" },
];
