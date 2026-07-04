// SIE-4 parser for Swedish accounting files (FORMAT PC8 = CP437).
// Handles the subset Pejl needs: company name, chart of accounts,
// opening/closing balances, and vouchers with transactions.

const CP437_HIGH: string = (() => {
  // Characters 128..255 in CP437
  return (
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
    "áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
    "└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
    "αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "
  );
})();

export function decodeCP437(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) out += String.fromCharCode(b);
    else out += CP437_HIGH[b - 0x80] ?? "?";
  }
  return out;
}

export interface SieTransaction {
  account: string;
  amount: number;
  description: string;
}

export interface SieVoucher {
  series: string;
  number: string;
  date: string; // YYYY-MM-DD
  description: string;
  transactions: SieTransaction[];
}

export interface SieParsed {
  companyName: string;
  orgNumber?: string;
  accounts: Record<string, string>; // account -> name
  openingBalances: Record<string, number>; // account -> IB amount (year 0)
  closingBalances: Record<string, number>; // account -> UB amount (year 0)
  vouchers: SieVoucher[];
}

/** Tokenize a single SIE line, respecting quoted strings and {} braces. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < line.length && line[j] !== '"') {
        s += line[j];
        j++;
      }
      tokens.push(s);
      i = j + 1;
    } else if (c === "{") {
      // skip object/dimension braces (unused)
      let depth = 1;
      let j = i + 1;
      while (j < line.length && depth > 0) {
        if (line[j] === "{") depth++;
        else if (line[j] === "}") depth--;
        j++;
      }
      tokens.push("{}");
      i = j;
    } else {
      let j = i;
      while (j < line.length && line[j] !== " " && line[j] !== "\t") j++;
      tokens.push(line.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

function toIsoDate(sieDate: string): string {
  if (!/^\d{8}$/.test(sieDate)) return sieDate;
  return `${sieDate.slice(0, 4)}-${sieDate.slice(4, 6)}-${sieDate.slice(6, 8)}`;
}

export function parseSie(content: string): SieParsed {
  const lines = content.split(/\r?\n/);
  const parsed: SieParsed = {
    companyName: "",
    accounts: {},
    openingBalances: {},
    closingBalances: {},
    vouchers: [],
  };

  let currentVoucher: SieVoucher | null = null;
  let inVoucherBody = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "{") {
      inVoucherBody = true;
      continue;
    }
    if (line === "}") {
      if (currentVoucher) {
        parsed.vouchers.push(currentVoucher);
        currentVoucher = null;
      }
      inVoucherBody = false;
      continue;
    }

    if (!line.startsWith("#")) continue;

    const tokens = tokenize(line);
    const label = tokens[0];

    switch (label) {
      case "#FNAMN":
        parsed.companyName = tokens[1] ?? "";
        break;
      case "#ORGNR":
        parsed.orgNumber = tokens[1];
        break;
      case "#KONTO":
        if (tokens[1]) parsed.accounts[tokens[1]] = tokens[2] ?? "";
        break;
      case "#IB":
        // #IB <year> <account> <amount>
        if (tokens[1] === "0" && tokens[2]) {
          parsed.openingBalances[tokens[2]] = parseFloat(tokens[3] ?? "0") || 0;
        }
        break;
      case "#UB":
        if (tokens[1] === "0" && tokens[2]) {
          parsed.closingBalances[tokens[2]] = parseFloat(tokens[3] ?? "0") || 0;
        }
        break;
      case "#VER":
        // #VER <series> <number> <date> "description" [regdate]
        currentVoucher = {
          series: tokens[1] ?? "",
          number: tokens[2] ?? "",
          date: toIsoDate(tokens[3] ?? ""),
          description: tokens[4] ?? "",
          transactions: [],
        };
        inVoucherBody = false;
        break;
      case "#TRANS":
        // #TRANS <account> {objects} <amount> [transdate] [description] [quantity] [sign]
        if (currentVoucher && inVoucherBody) {
          const account = tokens[1] ?? "";
          // token[2] is "{}" (object list, skipped by tokenizer)
          const amountTok = tokens[3] ?? "0";
          const description = tokens[5] ?? currentVoucher.description;
          currentVoucher.transactions.push({
            account,
            amount: parseFloat(amountTok) || 0,
            description,
          });
        }
        break;
      default:
        break;
    }
  }

  return parsed;
}

// ---------- Derivation for forecast ----------

const CASH_PREFIXES = ["19"]; // 1910-1989: bank/cash
const AR_ACCOUNTS = (acc: string) => acc.startsWith("15") && acc.length === 4; // kundfordringar
const AP_ACCOUNTS = (acc: string) =>
  acc.startsWith("244") || acc.startsWith("246"); // leverantörsskulder

const isCash = (acc: string) => CASH_PREFIXES.some((p) => acc.startsWith(p));

export interface DerivedTx {
  kind: "income" | "expense";
  amount: number;
  due_date: string; // YYYY-MM-DD
  description: string;
}

export interface DerivedForecast {
  companyName: string;
  currentBalance: number;
  transactions: DerivedTx[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Turn a parsed SIE into forecast inputs:
 * - Current cash balance = sum of UB for cash accounts (19xx)
 * - Open receivables (1510) → projected income
 * - Open payables (24xx) → projected expense
 * - Recent recurring cash-affecting vouchers → mirrored ~30 days forward
 */
export function deriveForecast(sie: SieParsed, today: Date = new Date()): DerivedForecast {
  const today0 = new Date(today);
  today0.setHours(0, 0, 0, 0);

  // 1. Cash balance
  let currentBalance = 0;
  for (const [acc, amt] of Object.entries(sie.closingBalances)) {
    if (isCash(acc)) currentBalance += amt;
  }

  const txs: DerivedTx[] = [];

  // 2. Open A/R (positive UB on 15xx receivables)
  let arTotal = 0;
  for (const [acc, amt] of Object.entries(sie.closingBalances)) {
    if (AR_ACCOUNTS(acc) && amt > 0) arTotal += amt;
  }
  if (arTotal > 0) {
    const due = new Date(today0);
    due.setDate(due.getDate() + 7);
    txs.push({
      kind: "income",
      amount: Math.round(arTotal),
      due_date: isoDay(due),
      description: "Öppna kundfordringar (SIE)",
    });
  }

  // 3. Open A/P (negative UB on 24xx payables → convert to positive expense)
  let apTotal = 0;
  for (const [acc, amt] of Object.entries(sie.closingBalances)) {
    if (AP_ACCOUNTS(acc) && amt < 0) apTotal += -amt;
  }
  if (apTotal > 0) {
    const due = new Date(today0);
    due.setDate(due.getDate() + 10);
    txs.push({
      kind: "expense",
      amount: Math.round(apTotal),
      due_date: isoDay(due),
      description: "Öppna leverantörsskulder (SIE)",
    });
  }

  // 4. Recurring cash-flow: for each voucher with cash impact in last 45 days,
  //    mirror forward ~30 days if it lands within next 14 days.
  const lookbackFrom = new Date(today0);
  lookbackFrom.setDate(lookbackFrom.getDate() - 45);
  const forecastEnd = new Date(today0);
  forecastEnd.setDate(forecastEnd.getDate() + 14);

  for (const v of sie.vouchers) {
    const vDate = new Date(v.date);
    if (isNaN(vDate.getTime())) continue;
    if (vDate < lookbackFrom || vDate > today0) continue;

    // Net cash effect = sum of TRANS on cash accounts
    let cashDelta = 0;
    for (const t of v.transactions) if (isCash(t.account)) cashDelta += t.amount;
    if (cashDelta === 0) continue;

    const mirrored = new Date(vDate);
    mirrored.setDate(mirrored.getDate() + 30);
    if (mirrored <= today0 || mirrored > forecastEnd) continue;

    txs.push({
      kind: cashDelta > 0 ? "income" : "expense",
      amount: Math.round(Math.abs(cashDelta)),
      due_date: isoDay(mirrored),
      description: v.description || `Verifikat ${v.series}${v.number}`,
    });
  }

  return {
    companyName: sie.companyName,
    currentBalance: Math.round(currentBalance * 100) / 100,
    transactions: txs,
  };
}
