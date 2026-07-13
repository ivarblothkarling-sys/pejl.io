type SupabaseLike = {
  from: (table: string) => any;
};

type ClaimsLike = {
  user_metadata?: { company_name?: string; company?: string };
  email?: string;
} & Record<string, unknown>;

function addDaysIso(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function companyNameFromClaims(claims?: ClaimsLike) {
  return (
    claims?.user_metadata?.company_name?.trim() ||
    claims?.user_metadata?.company?.trim() ||
    "Mitt företag"
  );
}

function mockTransactions(userId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return [
    ["expense", 12500, 1, "Hyra lokal"],
    ["expense", 8200, 2, "Leverantörsfaktura - Materialhuset AB"],
    ["income", 6800, 3, "Kundfaktura #1042 - Nordic Design AB"],
    ["expense", 3400, 4, "Telia - Telefoni & internet"],
    ["expense", 18900, 5, "Löner (preliminärt)"],
    ["income", 14200, 6, "Kundfaktura #1043 - Byggteknik Stockholm"],
    ["expense", 2150, 7, "Fortnox - prenumeration"],
    ["expense", 6700, 8, "Leverantörsfaktura - Office Supplies"],
    ["income", 4500, 9, "Kundfaktura #1044 - Café Solrosen"],
    ["expense", 9800, 10, "Skatteinbetalning"],
    ["income", 22000, 11, "Kundfaktura #1045 - Mediabolaget Norr"],
    ["expense", 1200, 12, "Försäkring"],
    ["expense", 4300, 13, "Bensin & resor"],
    ["income", 7600, 14, "Kundfaktura #1046 - Hantverkarna i Söder"],
  ].map(([kind, amount, offset, description]) => ({
    user_id: userId,
    kind: String(kind),
    amount: Number(amount),
    due_date: addDaysIso(today, Number(offset)),
    description: String(description),
    paid: false,
    source: "mock",
  }));
}

export async function ensureUserBootstrap({
  supabase,
  userId,
  claims,
}: {
  supabase: SupabaseLike;
  userId: string;
  claims?: ClaimsLike;
}) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  if (!profile) {
    const { error: insertProfileError } = await supabase.from("profiles").insert({
      id: userId,
      company_name: companyNameFromClaims(claims),
      current_balance: 48500,
      threshold: 5000,
      onboarding_completed: false,
    });
    if (insertProfileError && insertProfileError.code !== "23505") {
      throw new Error(insertProfileError.message);
    }
  }

  const { count, error: countError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw new Error(countError.message);

  if ((count ?? 0) === 0) {
    const { error: insertTxError } = await supabase
      .from("transactions")
      .insert(mockTransactions(userId));
    if (insertTxError) throw new Error(insertTxError.message);
  }
}