import type { AccountingProvider, AccountingProviderId } from "../types";
import { ProviderNotImplementedError } from "../types";

function makeStub(id: AccountingProviderId): AccountingProvider {
  const nope = () => Promise.reject(new ProviderNotImplementedError(id));
  return {
    id,
    getCompanyInfo: nope,
    getAccountBalance: nope,
    getTransactions: nope,
    getInvoices: nope,
    getSupplierInvoices: nope,
  };
}

export const tripletexProvider = makeStub("tripletex");
export const xeroProvider = makeStub("xero");
export const quickbooksProvider = makeStub("quickbooks");
