"use client";

import React, { useState, useCallback } from "react";
import {
  Search, ExternalLink, Briefcase, ArrowDownLeft, ArrowUpRight,
  AlertTriangle, ShieldAlert, Clock, Users, TrendingUp, TrendingDown,
  Filter, Download, Wifi, WifiOff
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  time: string;
  ref: string;
  channel: string;
  counterparty: string;
  amount: string;
  direction: "IN" | "OUT";
  flag: "CIRCULAR" | "STRUCTURING" | "WATCH" | "CLEAN";
}

interface AccountResult {
  id: string;
  name: string;
  type: string;
  score: number;
  flags: string[];
  inflow: string;
  inflowNote: string;
  outflow: string;
  outflowNote: string;
  counterparties: number;
  counterpartiesNote: string;
  transactions: Transaction[];
}

// ── API Config ─────────────────────────────────────────────────────────────
// Set this to your actual backend base URL.
// In production, use an environment variable: process.env.NEXT_PUBLIC_API_BASE
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000";

// Set to true to always use mock data (useful for offline dev)
const FORCE_MOCK = false;

// ── Mock Data (fallback) ───────────────────────────────────────────────────
const MOCK_ACCOUNTS: Record<string, AccountResult> = {
  "ACC-8872": {
    id: "ACC-8872",
    name: "Rajesh Kumar · Sole Proprietor",
    type: "Current Account",
    score: 0.91,
    flags: ["Circular", "Layering", "Profile Mismatch"],
    inflow: "₹3.2 Cr",
    inflowNote: "vs declared ₹1.5L/mo",
    outflow: "₹3.1 Cr",
    outflowNote: "Same-day clearing: 94%",
    counterparties: 7,
    counterpartiesNote: "3 flagged accounts",
    transactions: [
      { time: "14:31:58", ref: "TX-48823", channel: "NEFT", counterparty: "ACC-3341", amount: "+₹47.6L", direction: "IN",  flag: "CIRCULAR"     },
      { time: "14:31:49", ref: "TX-48821", channel: "NEFT", counterparty: "ACC-9912", amount: "−₹48.2L", direction: "OUT", flag: "CIRCULAR"     },
      { time: "12:14:03", ref: "TX-48702", channel: "UPI",  counterparty: "ACC-0441", amount: "+₹9.8L",  direction: "IN",  flag: "WATCH"        },
      { time: "09:02:11", ref: "TX-48601", channel: "RTGS", counterparty: "ACC-0441", amount: "+₹9.6L",  direction: "IN",  flag: "WATCH"        },
      { time: "08:41:05", ref: "TX-48598", channel: "NEFT", counterparty: "ACC-5201", amount: "+₹9.5L",  direction: "IN",  flag: "STRUCTURING"  },
    ],
  },
  "ACC-2219": {
    id: "ACC-2219",
    name: "Meena Iyer · Housewife",
    type: "Savings Account",
    score: 0.83,
    flags: ["Structuring"],
    inflow: "₹29.4L",
    inflowNote: "3 txns below ₹10L each",
    outflow: "₹28.9L",
    outflowNote: "Cleared within 6h",
    counterparties: 3,
    counterpartiesNote: "1 flagged account",
    transactions: [
      { time: "14:28:00", ref: "TX-48801", channel: "NEFT", counterparty: "ACC-7712", amount: "+₹9.8L", direction: "IN",  flag: "STRUCTURING" },
      { time: "14:20:11", ref: "TX-48798", channel: "NEFT", counterparty: "ACC-7712", amount: "+₹9.7L", direction: "IN",  flag: "STRUCTURING" },
      { time: "14:09:34", ref: "TX-48791", channel: "UPI",  counterparty: "ACC-7712", amount: "+₹9.9L", direction: "IN",  flag: "STRUCTURING" },
      { time: "13:55:00", ref: "TX-48782", channel: "IMPS", counterparty: "ACC-3301", amount: "−₹28L",  direction: "OUT", flag: "WATCH"        },
    ],
  },
  "ACC-5504": {
    id: "ACC-5504",
    name: "Dormant Account · 14 months",
    type: "Savings Account",
    score: 0.88,
    flags: ["Dormant Activation"],
    inflow: "₹1.8 Cr",
    inflowNote: "Single inbound transfer",
    outflow: "₹0",
    outflowNote: "No outbound yet",
    counterparties: 1,
    counterpartiesNote: "1 flagged account",
    transactions: [
      { time: "14:22:44", ref: "TX-48744", channel: "RTGS", counterparty: "ACC-3301", amount: "+₹1.8Cr", direction: "IN", flag: "WATCH" },
    ],
  },
};

// ── API Response → Internal Model Adapter ──────────────────────────────────
/**
 * Maps the backend GET /api/accounts/{id} + GET /api/transactions?accountId={id}
 * response into the AccountResult shape this component uses.
 *
 * Backend contract (from Blueprint §8.2 + §5.1/5.2):
 *
 * GET /api/accounts/{id} returns:
 * {
 *   id: string,
 *   customer: { name: string, occupation: string },
 *   account_type: "SAVINGS" | "CURRENT" | ...,
 *   status: "ACTIVE" | "DORMANT" | ...,
 *   declared_monthly_income: number,
 *   is_dormant: boolean
 * }
 *
 * GET /api/transactions?accountId={id}&from={iso}&to={iso}&page=0&size=20 returns:
 * {
 *   content: Array<{
 *     id: string,
 *     reference_number: string,
 *     source_account_id: string,
 *     dest_account_id: string,
 *     amount: number,
 *     channel: string,
 *     initiated_at: string,   // ISO 8601
 *     alert_type?: string     // optional: "CIRCULAR" | "STRUCTURING" | "LAYERING" | ...
 *   }>,
 *   totalElements: number
 * }
 *
 * GET /api/alerts?accountId={id}&minScore=0&size=1 returns:
 * {
 *   content: Array<{
 *     anoma_score: number,
 *     alert_type: string,
 *     score_breakdown: { layering, circular, structuring, dormant, profile_mismatch }
 *   }>
 * }
 */

function formatInr(amount: number): string {
  if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(1)} Cr`;
  if (amount >= 1_00_000)    return `₹${(amount / 1_00_000).toFixed(1)}L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

function mapAlertTypeToFlag(alertType?: string): Transaction["flag"] {
  if (!alertType) return "CLEAN";
  const t = alertType.toUpperCase();
  if (t.includes("CIRCULAR"))    return "CIRCULAR";
  if (t.includes("STRUCTURING")) return "STRUCTURING";
  if (t.includes("LAYERING") || t.includes("DORMANT") || t.includes("PROFILE")) return "WATCH";
  return "CLEAN";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptApiResponse(accountData: any, txData: any, alertData: any, accountId: string): AccountResult {
  const txs = txData?.content ?? [];
  const alert = alertData?.content?.[0];

  const inflows  = txs.filter((t: any) => t.dest_account_id   === accountId);
  const outflows = txs.filter((t: any) => t.source_account_id === accountId);

  const totalIn  = inflows.reduce( (s: number, t: any) => s + (t.amount ?? 0), 0);
  const totalOut = outflows.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);

  const uniqueCounterparties = new Set<string>(
    txs.map((t: any) => t.source_account_id === accountId ? t.dest_account_id : t.source_account_id)
  );

  const activeFlags: string[] = [];
  if (alert?.score_breakdown?.circular    > 0.5) activeFlags.push("Circular");
  if (alert?.score_breakdown?.layering    > 0.5) activeFlags.push("Layering");
  if (alert?.score_breakdown?.structuring > 0.5) activeFlags.push("Structuring");
  if (alert?.score_breakdown?.dormant     > 0.5) activeFlags.push("Dormant Activation");
  if (alert?.score_breakdown?.profile_mismatch > 0.5) activeFlags.push("Profile Mismatch");
  if (activeFlags.length === 0) activeFlags.push("Under Review");

  const mappedTxs: Transaction[] = txs.map((t: any) => {
    const dir: "IN" | "OUT" = t.dest_account_id === accountId ? "IN" : "OUT";
    const counterparty = dir === "IN" ? t.source_account_id : t.dest_account_id;
    const time = new Date(t.initiated_at).toLocaleTimeString("en-IN", { hour12: false });
    const amtStr = `${dir === "IN" ? "+" : "−"}${formatInr(t.amount)}`;
    return {
      time,
      ref:          t.reference_number ?? t.id?.slice(0, 8).toUpperCase(),
      channel:      t.channel,
      counterparty,
      amount:       amtStr,
      direction:    dir,
      flag:         mapAlertTypeToFlag(t.alert_type),
    };
  });

  const customerName = accountData?.customer
    ? `${accountData.customer.name} · ${accountData.customer.occupation ?? accountData.declared_occupation ?? ""}`
    : accountId;

  const declaredIncome = accountData?.declared_monthly_income ?? 0;

  return {
    id:    accountId,
    name:  customerName,
    type:  accountData?.account_type ? `${accountData.account_type.charAt(0)}${accountData.account_type.slice(1).toLowerCase()} Account` : "Account",
    score: alert?.anoma_score ?? 0,
    flags: activeFlags,

    inflow:     formatInr(totalIn),
    inflowNote: declaredIncome > 0 ? `vs declared ${formatInr(declaredIncome * 12)}/yr` : `${inflows.length} inbound transactions`,

    outflow:     formatInr(totalOut),
    outflowNote: `${outflows.length} outbound transactions`,

    counterparties:     uniqueCounterparties.size,
    counterpartiesNote: `across ${txs.length} transactions`,

    transactions: mappedTxs,
  };
}

// ── API Fetch with Mock Fallback ───────────────────────────────────────────
async function fetchAccountData(
  accountId: string,
  dateRange: string,
  token?: string
): Promise<{ data: AccountResult | null; usedMock: boolean; error?: string }> {

  // Always fall back to mock if FORCE_MOCK is true
  if (FORCE_MOCK) {
    const mock = MOCK_ACCOUNTS[accountId] ?? null;
    return { data: mock, usedMock: true };
  }

  const hours = dateRange === "Last 7 days" ? 168 : 720; // 7d or 30d
  const from  = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const to    = new Date().toISOString();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    // Parallel fetch: account details + transactions + latest alert
    const [accountRes, txRes, alertRes] = await Promise.all([
      fetch(`${API_BASE}/api/accounts/${accountId}`, { headers }),
      fetch(`${API_BASE}/api/transactions?accountId=${accountId}&from=${from}&to=${to}&page=0&size=20`, { headers }),
      fetch(`${API_BASE}/api/alerts?accountId=${accountId}&minScore=0&size=1&sortBy=created_at&order=desc`, { headers }),
    ]);

    // If account is 404 → not found (don't fall back to mock for a real "not found")
    if (accountRes.status === 404) {
      return { data: null, usedMock: false };
    }

    // If any critical endpoint fails with a server error → fall back to mock
    if (!accountRes.ok || !txRes.ok) {
      console.warn("[AnomaNet] Backend returned error, falling back to mock data");
      const mock = MOCK_ACCOUNTS[accountId] ?? null;
      return { data: mock, usedMock: true, error: `Backend error (${accountRes.status}) — showing demo data` };
    }

    const [accountData, txData, alertData] = await Promise.all([
      accountRes.json(),
      txRes.ok ? txRes.json() : Promise.resolve({ content: [] }),
      alertRes.ok ? alertRes.json() : Promise.resolve({ content: [] }),
    ]);

    const adapted = adaptApiResponse(accountData, txData, alertData, accountId);
    return { data: adapted, usedMock: false };

  } catch (err) {
    // Network error (backend offline) → fall back to mock
    console.warn("[AnomaNet] Network error, falling back to mock data:", err);
    const mock = MOCK_ACCOUNTS[accountId] ?? null;
    return {
      data: mock,
      usedMock: true,
      error: "Backend unreachable — showing demo data",
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const scoreColor = (s: number) =>
  s >= 0.75 ? "text-red-400" : s >= 0.45 ? "text-yellow-400" : "text-[#CAFF33]";

const scoreBg = (s: number) =>
  s >= 0.75 ? "bg-red-500/10 border-red-500/30" : s >= 0.45 ? "bg-yellow-500/10 border-yellow-500/30" : "bg-[#CAFF33]/10 border-[#CAFF33]/30";

const flagStyle = (flag: Transaction["flag"]) => {
  switch (flag) {
    case "CIRCULAR":    return "bg-red-500/10 text-red-400 border-red-500/20";
    case "STRUCTURING": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "WATCH":       return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    default:            return "bg-white/5 text-white/30 border-white/10";
  }
};

// ── Sub-components ─────────────────────────────────────────────────────────
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div
    className={`relative border border-white/[0.09] rounded-[1.5rem] bg-[#0a0a0a] overflow-hidden ${className}`}
    style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 24px rgba(0,0,0,0.4)" }}
  >
    {children}
  </div>
);

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60 mb-2">{children}</p>
);

const MetricCard = ({
  label, value, note, color = "text-[#CAFF33]", icon: Icon,
}: { label: string; value: string; note: string; color?: string; icon: React.ElementType }) => (
  <Card className="p-6 flex flex-col gap-3">
    <div className="flex items-center gap-2 text-white/40">
      <Icon size={14} />
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
    <p className={`text-3xl font-black font-mono leading-none ${color}`}>{value}</p>
    <p className="text-[10px] text-white/40 font-bold">{note}</p>
  </Card>
);

const FlagPill = ({ flag }: { flag: Transaction["flag"] }) => (
  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${flagStyle(flag)}`}>
    {flag === "CIRCULAR" || flag === "STRUCTURING" ? `⚠ ${flag}` : flag}
  </span>
);

// ── Mock Badge ─────────────────────────────────────────────────────────────
const MockBanner = ({ message }: { message?: string }) => (
  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold">
    <WifiOff size={12} />
    {message ?? "Showing demo data — backend offline"}
  </div>
);

const LiveBadge = () => (
  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#CAFF33]/10 border border-[#CAFF33]/20 text-[#CAFF33] text-[10px] font-bold">
    <Wifi size={11} />
    Live
  </div>
);

// ── Empty State ────────────────────────────────────────────────────────────
const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <div className="w-20 h-20 rounded-full border border-dashed border-white/10 flex items-center justify-center mb-8 relative">
      <div className="absolute inset-0 rounded-full bg-white/[0.02] animate-ping" style={{ animationDuration: "3s" }} />
      <Search size={32} className="text-white/10" />
    </div>
    <h3 className="text-xl font-black text-white/20 mb-2 uppercase tracking-tight italic">Search any account</h3>
    <p className="text-sm text-white/20 max-w-xs">
      Enter an account number to trace its complete fund flow history and AI risk profile.
    </p>
    <div className="mt-8 flex gap-3 flex-wrap justify-center">
      {Object.keys(MOCK_ACCOUNTS).map((id) => (
        <span key={id} className="font-mono text-[10px] text-white/20 border border-white/[0.06] px-3 py-1.5 rounded-lg">
          {id}
        </span>
      ))}
    </div>
  </div>
);

// ── Account Result ─────────────────────────────────────────────────────────
const AccountResultView = ({ result, usedMock, mockMessage, onViewGraph, onOpenCase }: {
  result: AccountResult;
  usedMock: boolean;
  mockMessage?: string;
  onViewGraph: () => void;
  onOpenCase: () => void;
}) => (
  <div className="space-y-5 animate-in fade-in duration-300">
    {/* Live / Mock status */}
    <div className="flex items-center justify-end gap-3">
      {usedMock ? <MockBanner message={mockMessage} /> : <LiveBadge />}
    </div>

    {/* Account Found Banner */}
    <Card className="p-6">
      <div className="flex items-start gap-5">
        <div className={`mt-1 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${scoreBg(result.score)}`}>
          <ShieldAlert size={18} className={scoreColor(result.score)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <span className="font-mono text-sm font-bold text-white">{result.id}</span>
            <span className="text-white/30">·</span>
            <span className="text-sm text-white/80">{result.name}</span>
            <span className={`ml-auto text-[10px] font-black font-mono border px-2.5 py-1 rounded-lg ${scoreBg(result.score)} ${scoreColor(result.score)}`}>
              AnomaScore {result.score.toFixed(2)}
            </span>
          </div>
          <p className="text-[11px] text-white/40 mb-3">{result.type}</p>
          <div className="flex gap-2 flex-wrap mb-4">
            {result.flags.map((f) => (
              <span key={f} className="text-[9px] font-black uppercase border px-2 py-0.5 rounded bg-red-500/10 border-red-500/20 text-red-400">
                {f}
              </span>
            ))}
          </div>
          <p className="text-xs text-white/50 leading-relaxed mb-4">
            This account has <span className="text-red-400 font-bold">{result.flags.length} active AI flags</span> in the last 48 hours.
            Fund trail is traced below. All transactions are shown chronologically.
          </p>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={onViewGraph}
              className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-black uppercase rounded-xl hover:bg-red-500/20 transition-colors flex items-center gap-2"
            >
              <ExternalLink size={12} /> View in Graph
            </button>
            <button
              onClick={onOpenCase}
              className="px-4 py-2 bg-white/5 text-white/60 border border-white/10 text-[10px] font-black uppercase rounded-xl hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <Briefcase size={12} /> Open Case
            </button>
          </div>
        </div>
      </div>
    </Card>

    {/* Metrics */}
    <div className="grid grid-cols-3 gap-4">
      <MetricCard label="Total Inflow (30d)" value={result.inflow} note={result.inflowNote} color="text-[#CAFF33]" icon={TrendingUp} />
      <MetricCard label="Total Outflow (30d)" value={result.outflow} note={result.outflowNote} color="text-red-400" icon={TrendingDown} />
      <MetricCard label="Unique Counterparties" value={String(result.counterparties)} note={result.counterpartiesNote} color="text-yellow-400" icon={Users} />
    </div>

    {/* Transaction Table */}
    <Card>
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
        <div>
          <p className="text-sm font-black text-white uppercase tracking-tight italic">Transaction History</p>
          <p className="text-[10px] text-white/40 mt-0.5">
            {usedMock ? "Demo data" : "Last 30 days"} · {result.transactions.length} records
          </p>
        </div>
        <div className="flex gap-2">
          <button className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/40 hover:text-white/70 transition-colors">
            <Filter size={14} />
          </button>
          <button className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/40 hover:text-white/70 transition-colors">
            <Download size={14} />
          </button>
        </div>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-white/[0.015]">
            {["Time", "Ref", "Channel", "Counterparty", "Amount", "Direction", "Flag"].map((h) => (
              <th key={h} className="px-5 py-3.5 text-[9px] font-black uppercase tracking-widest text-white/30">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {result.transactions.map((tx, i) => (
            <tr key={i} className="hover:bg-white/[0.015] transition-colors group">
              <td className="px-5 py-4 font-mono text-xs text-white/50">{tx.time}</td>
              <td className="px-5 py-4 font-mono text-xs text-white/70 font-bold">{tx.ref}</td>
              <td className="px-5 py-4 text-xs text-white/50">{tx.channel}</td>
              <td className="px-5 py-4 font-mono text-xs text-white/80 font-bold">{tx.counterparty}</td>
              <td className={`px-5 py-4 font-mono text-xs font-black ${tx.direction === "IN" ? "text-[#CAFF33]" : "text-red-400"}`}>
                {tx.amount}
              </td>
              <td className="px-5 py-4">
                <span className={`flex items-center gap-1 w-fit text-[9px] font-black px-2 py-1 rounded border ${
                  tx.direction === "IN"
                    ? "bg-[#CAFF33]/10 text-[#CAFF33] border-[#CAFF33]/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}>
                  {tx.direction === "IN" ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                  {tx.direction}
                </span>
              </td>
              <td className="px-5 py-4">
                <FlagPill flag={tx.flag} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────
export const AccountLookupSection = () => {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AccountResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState("Last 30 days");
  const [usedMock, setUsedMock] = useState(false);
  const [mockMessage, setMockMessage] = useState<string | undefined>();

  // Read JWT token from localStorage/cookie — adjust to match your auth implementation
  const getToken = useCallback((): string | undefined => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem("anomanet_token") ?? undefined;
  }, []);

  const handleSearch = useCallback(async () => {
    const key = query.trim().toUpperCase();
    if (!key) return;

    setLoading(true);
    setNotFound(false);
    setResult(null);
    setUsedMock(false);
    setMockMessage(undefined);

    try {
      const token = getToken();
      const { data, usedMock: wasMock, error } = await fetchAccountData(key, dateRange, token);

      setResult(data);
      setNotFound(!data);
      setUsedMock(wasMock);
      if (error) setMockMessage(error);
    } finally {
      setLoading(false);
    }
  }, [query, dateRange, getToken]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-1 custom-scrollbar">
      {/* Header */}
      <div>
        <Eyebrow>Investigation</Eyebrow>
        <h2 className="text-3xl font-black text-white">Account Lookup</h2>
        <p className="text-sm text-white/40 mt-1">Search any account to trace its complete fund flow history</p>
      </div>

      {/* Search Bar */}
      <Card className="p-5">
        <div className="flex gap-3 items-center">
          <div className="relative flex-[2]">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Account number, name, or IFSC… e.g. ACC-8872"
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#CAFF33]/40 focus:bg-white/[0.06] transition-all font-mono"
            />
          </div>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white/60 focus:outline-none focus:border-white/20 transition-colors appearance-none cursor-pointer"
          >
            <option>Last 30 days</option>
            <option>Last 7 days</option>
          </select>

          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-6 py-3 bg-[#CAFF33] text-black font-black text-[11px] uppercase rounded-xl hover:bg-[#b8e62e] transition-colors flex items-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full" />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.05]">
          <span className="text-[9px] text-white/25 font-bold uppercase tracking-widest mr-1">Try:</span>
          {Object.keys(MOCK_ACCOUNTS).map((id) => (
            <button
              key={id}
              onClick={() => setQuery(id)}
              className="font-mono text-[10px] text-white/30 hover:text-white/60 border border-white/[0.07] hover:border-white/20 px-2.5 py-1 rounded-lg transition-colors"
            >
              {id}
            </button>
          ))}
        </div>
      </Card>

      {/* Results Area */}
      {!loading && !result && !notFound && <EmptyState />}

      {loading && (
        <div className="flex items-center justify-center py-20 gap-4 text-white/30">
          <span className="animate-spin w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full" />
          <span className="text-sm font-bold uppercase tracking-widest">Tracing fund flow…</span>
        </div>
      )}

      {notFound && !loading && (
        <Card className="p-10 flex flex-col items-center text-center">
          <AlertTriangle size={32} className="text-yellow-400/60 mb-4" />
          <p className="text-white font-bold mb-1">No account found for "{query}"</p>
          <p className="text-sm text-white/40">Try a valid account ID like ACC-8872 or ACC-2219</p>
        </Card>
      )}

      {result && !loading && (
        <AccountResultView
          result={result}
          usedMock={usedMock}
          mockMessage={mockMessage}
          onViewGraph={() => console.log("Navigate to graph:", result.id)}
          onOpenCase={() => console.log("Open case for:", result.id)}
        />
      )}
    </div>
  );
};

export default AccountLookupSection;