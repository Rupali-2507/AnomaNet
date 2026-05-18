

import { useState, useCallback } from "react";

// ─── API Config ────────────────────────────────────────────────────────────────
const API_BASE   = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
const FORCE_MOCK = false;
const DAYS_MAP: Record<string, number> = { "Last 30 days": 30, "Last 7 days": 7 };

// ─── Domain Types ──────────────────────────────────────────────────────────────

type AlertType = "CIRCULAR" | "LAYERING" | "STRUCTURING" | "DORMANT" | "PROFILE_MISMATCH";
type AccountStatus = "ACTIVE" | "DORMANT" | "FROZEN" | "CLOSED" | "UNKNOWN";
type TransactionFlag = "CIRCULAR" | "STRUCTURING" | "WATCH" | "CLEAN";
type TransactionDirection = "IN" | "OUT";
type TransactionChannel = "NEFT" | "RTGS" | "IMPS" | "UPI" | "SWIFT" | "CASH" | "BRANCH";
type FlagKey = AlertType | "WATCH" | "UNDER_REVIEW" | "CLEAN";

interface ScoreBreakdown {
  circular:         number;
  layering:         number;
  profile_mismatch: number;
  structuring:      number;
  dormant:          number;
}

interface TransactionRow {
  time:         string;
  ref:          string;
  channel:      string;
  counterparty: string;
  amount:       string;
  direction:    TransactionDirection;
  flag:         TransactionFlag;
}

interface AccountResult {
  id:                  string;
  name:                string;
  type:                string;
  status:              AccountStatus;
  score:               number;
  flags:               FlagKey[];
  inflow:              string;
  inflowNote:          string;
  outflow:             string;
  outflowNote:         string;
  counterparties:      number;
  counterpartiesNote:  string;
  sameDayClearingPct:  number;
  scoreBreakdown:      ScoreBreakdown;
  transactions:        TransactionRow[];
}

// ─── Backend DTO shapes (what the real API returns) ────────────────────────────

interface CustomerDto {
  name:        string;
  occupation?: string;
}

interface TransactionHistoryItem {
  id:                string;
  reference_number?: string;
  source_account_id: string;
  dest_account_id:   string;
  amount:            number;
  channel:           TransactionChannel;
  initiated_at:      string;
  flag?:             string;
}

interface AccountLookupDto {
  accountId?:               string;
  customer?:                CustomerDto;
  account_type?:            string;
  status?:                  AccountStatus;
  declared_monthly_income?: number;
  is_dormant?:              boolean;
  totalInflow?:             number;
  totalOutflow?:            number;
  txCount?:                 number;
  uniqueCounterparties?:    number;
  flaggedCounterparties?:   number;
  sameDayClearingPct?:      number;
  anomaScore?:              number;
  transactions?:            TransactionHistoryItem[];
}

interface AlertSummaryDto {
  id:             string;
  anomaScore:     number;
  alertType:      AlertType;
  scoreBreakdown: Partial<ScoreBreakdown>;
  createdAt:      string;
  status:         string;
}

interface AlertPageDto {
  content: AlertSummaryDto[];
}

// ─── Fetch result ──────────────────────────────────────────────────────────────

interface FetchResult {
  data:      AccountResult | null;
  usedMock:  boolean;
  error?:    string;
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_ACCOUNTS: Record<string, AccountResult> = {
  "ACC-8872": {
    id: "ACC-8872",
    name: "Rajesh Kumar · Sole Proprietor",
    type: "Current Account",
    status: "ACTIVE",
    score: 0.91,
    flags: ["CIRCULAR", "LAYERING", "PROFILE_MISMATCH"],
    inflow: "₹3.2 Cr",
    inflowNote: "vs declared ₹1.5L/mo",
    outflow: "₹3.1 Cr",
    outflowNote: "Same-day clearing: 94%",
    counterparties: 7,
    counterpartiesNote: "3 flagged accounts",
    sameDayClearingPct: 94,
    scoreBreakdown: { circular: 0.91, layering: 0.82, profile_mismatch: 0.78, structuring: 0.45, dormant: 0.12 },
    transactions: [
      { time: "14:31:58", ref: "TX-48823", channel: "NEFT", counterparty: "ACC-3341", amount: "+₹47.6L", direction: "IN",  flag: "CIRCULAR"    },
      { time: "14:31:49", ref: "TX-48821", channel: "NEFT", counterparty: "ACC-9912", amount: "−₹48.2L", direction: "OUT", flag: "CIRCULAR"    },
      { time: "12:14:03", ref: "TX-48702", channel: "UPI",  counterparty: "ACC-0441", amount: "+₹9.8L",  direction: "IN",  flag: "WATCH"       },
      { time: "09:02:11", ref: "TX-48601", channel: "RTGS", counterparty: "ACC-0441", amount: "+₹9.6L",  direction: "IN",  flag: "WATCH"       },
      { time: "08:41:05", ref: "TX-48598", channel: "NEFT", counterparty: "ACC-5201", amount: "+₹9.5L",  direction: "IN",  flag: "STRUCTURING" },
    ],
  },
  "ACC-2219": {
    id: "ACC-2219",
    name: "Meena Iyer · Housewife",
    type: "Savings Account",
    status: "ACTIVE",
    score: 0.83,
    flags: ["STRUCTURING"],
    inflow: "₹29.4L",
    inflowNote: "3 txns below ₹10L each",
    outflow: "₹28.9L",
    outflowNote: "Cleared within 6h",
    counterparties: 3,
    counterpartiesNote: "1 flagged account",
    sameDayClearingPct: 68,
    scoreBreakdown: { circular: 0.12, layering: 0.31, profile_mismatch: 0.44, structuring: 0.83, dormant: 0.05 },
    transactions: [
      { time: "14:28:00", ref: "TX-48801", channel: "NEFT", counterparty: "ACC-7712", amount: "+₹9.8L", direction: "IN",  flag: "STRUCTURING" },
      { time: "14:20:11", ref: "TX-48798", channel: "NEFT", counterparty: "ACC-7712", amount: "+₹9.7L", direction: "IN",  flag: "STRUCTURING" },
      { time: "14:09:34", ref: "TX-48791", channel: "UPI",  counterparty: "ACC-7712", amount: "+₹9.9L", direction: "IN",  flag: "STRUCTURING" },
      { time: "13:55:00", ref: "TX-48782", channel: "IMPS", counterparty: "ACC-3301", amount: "−₹28L",  direction: "OUT", flag: "WATCH"       },
    ],
  },
  "ACC-5504": {
    id: "ACC-5504",
    name: "Dormant Account · 14 months silent",
    type: "Savings Account",
    status: "DORMANT",
    score: 0.88,
    flags: ["DORMANT"],
    inflow: "₹1.8 Cr",
    inflowNote: "Single inbound transfer",
    outflow: "₹0",
    outflowNote: "No outbound yet — pre-positioned?",
    counterparties: 1,
    counterpartiesNote: "1 flagged account",
    sameDayClearingPct: 0,
    scoreBreakdown: { circular: 0.08, layering: 0.22, profile_mismatch: 0.51, structuring: 0.19, dormant: 0.88 },
    transactions: [
      { time: "14:22:44", ref: "TX-48744", channel: "RTGS", counterparty: "ACC-3301", amount: "+₹1.8Cr", direction: "IN", flag: "WATCH" },
    ],
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatInr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function flagFromAlertType(t = ""): TransactionFlag {
  const u = t.toUpperCase();
  if (u.includes("CIRCULAR"))    return "CIRCULAR";
  if (u.includes("STRUCTURING")) return "STRUCTURING";
  if (u.includes("LAYERING") || u.includes("DORMANT") || u.includes("PROFILE")) return "WATCH";
  return "CLEAN";
}

function adaptApiResponse(
  lookupData: AccountLookupDto,
  alertData:  AlertPageDto,
  accountId:  string,
): AccountResult {
  const alert = alertData?.content?.[0];
  const bd    = alert?.scoreBreakdown ?? {};

  const flags: FlagKey[] = [];
  if ((bd.circular         ?? 0) > 0.5) flags.push("CIRCULAR");
  if ((bd.layering         ?? 0) > 0.5) flags.push("LAYERING");
  if ((bd.structuring      ?? 0) > 0.5) flags.push("STRUCTURING");
  if ((bd.dormant          ?? 0) > 0.5) flags.push("DORMANT");
  if ((bd.profile_mismatch ?? 0) > 0.5) flags.push("PROFILE_MISMATCH");
  if (flags.length === 0) flags.push("UNDER_REVIEW");

  const txs: TransactionRow[] = (lookupData?.transactions ?? []).map((t) => {
    const dir: TransactionDirection = t.dest_account_id === accountId ? "IN" : "OUT";
    return {
      time:         new Date(t.initiated_at).toLocaleTimeString("en-IN", { hour12: false }),
      ref:          t.reference_number ?? t.id.slice(0, 8).toUpperCase(),
      channel:      t.channel,
      counterparty: dir === "IN" ? t.source_account_id : t.dest_account_id,
      amount:       `${dir === "IN" ? "+" : "−"}${formatInr(t.amount)}`,
      direction:    dir,
      flag:         flagFromAlertType(t.flag ?? alert?.alertType),
    };
  });

  const declaredIncome = lookupData?.declared_monthly_income ?? 0;

  return {
    id:    accountId,
    name:  lookupData?.customer
             ? `${lookupData.customer.name} · ${lookupData.customer.occupation ?? ""}`
             : accountId,
    type:  lookupData?.account_type
             ? `${lookupData.account_type[0]}${lookupData.account_type.slice(1).toLowerCase()} Account`
             : "Account",
    status: lookupData?.status ?? "UNKNOWN",
    score: alert?.anomaScore ?? lookupData?.anomaScore ?? 0,
    flags,
    inflow:      formatInr(lookupData?.totalInflow  ?? 0),
    inflowNote:  declaredIncome > 0
                   ? `vs declared ${formatInr(declaredIncome * 12)}/yr`
                   : `${lookupData?.txCount ?? txs.length} total transactions`,
    outflow:     formatInr(lookupData?.totalOutflow ?? 0),
    outflowNote: `Same-day clearing: ${lookupData?.sameDayClearingPct ?? 0}%`,
    counterparties:     lookupData?.uniqueCounterparties ?? 0,
    counterpartiesNote: `${lookupData?.flaggedCounterparties ?? 0} flagged accounts`,
    sameDayClearingPct: lookupData?.sameDayClearingPct ?? 0,
    scoreBreakdown: {
      circular:         bd.circular         ?? 0,
      layering:         bd.layering         ?? 0,
      profile_mismatch: bd.profile_mismatch ?? 0,
      structuring:      bd.structuring      ?? 0,
      dormant:          bd.dormant          ?? 0,
    },
    transactions: txs,
  };
}

// ─── API fetch with mock fallback ───────────────────────────────────────────────

async function fetchAccountData(
  accountId: string,
  days:      number,
  token?:    string,
): Promise<FetchResult> {
  if (FORCE_MOCK) {
    return { data: MOCK_ACCOUNTS[accountId] ?? null, usedMock: true };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const [lookupRes, alertRes] = await Promise.all([
      fetch(`${API_BASE}/api/accounts/lookup?q=${accountId}&days=${days}`, { headers }),
      fetch(`${API_BASE}/api/alerts?accountId=${accountId}&minScore=0&size=1&sortBy=created_at&order=desc`, { headers }),
    ]);

    if (lookupRes.status === 404) return { data: null, usedMock: false };

    if (!lookupRes.ok) {
      const mock = MOCK_ACCOUNTS[accountId] ?? null;
      return { data: mock, usedMock: true, error: `Backend error (${lookupRes.status}) — showing demo data` };
    }

    const [lookupData, alertData]: [AccountLookupDto, AlertPageDto] = await Promise.all([
      lookupRes.json() as Promise<AccountLookupDto>,
      alertRes.ok ? (alertRes.json() as Promise<AlertPageDto>) : Promise.resolve({ content: [] }),
    ]);

    return { data: adaptApiResponse(lookupData, alertData, accountId), usedMock: false };
  } catch (err) {
    console.warn("[AnomaNet] Network error, falling back to mock:", err);
    return { data: MOCK_ACCOUNTS[accountId] ?? null, usedMock: true, error: "Backend unreachable — showing demo data" };
  }
}

// ─── Style helpers ──────────────────────────────────────────────────────────────

interface FlagMeta { label: string; cls: string; }

const FLAG_META: Record<FlagKey, FlagMeta> = {
  CIRCULAR:        { label: "⊙ CIRCULAR",   cls: "bg-red-500/15 text-red-400 border-red-500/25" },
  LAYERING:        { label: "≋ LAYERING",    cls: "bg-orange-500/15 text-orange-400 border-orange-500/25" },
  STRUCTURING:     { label: "⊟ STRUCTURING", cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
  DORMANT:         { label: "◌ DORMANT",     cls: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  PROFILE_MISMATCH:{ label: "⊗ PROFILE",     cls: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
  WATCH:           { label: "◈ WATCH",       cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  UNDER_REVIEW:    { label: "◎ REVIEW",      cls: "bg-white/10 text-white/50 border-white/15" },
  CLEAN:           { label: "✓ CLEAN",       cls: "bg-[#CAFF33]/10 text-[#CAFF33] border-[#CAFF33]/20" },
};

const scoreRing = (s: number): string =>
  s >= 0.75 ? "#ef4444" : s >= 0.45 ? "#eab308" : "#CAFF33";

const BAR_COLORS: Record<keyof ScoreBreakdown, string> = {
  circular:         "#ef4444",
  layering:         "#f97316",
  profile_mismatch: "#a855f7",
  structuring:      "#06b6d4",
  dormant:          "#3b82f6",
};

// ─── Icon components ────────────────────────────────────────────────────────────

interface IconProps { size?: number; }

const SearchIcon = ({ size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);
const ShieldIcon = ({ size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const TrendUpIcon = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
  </svg>
);
const TrendDownIcon = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
  </svg>
);
const UsersIcon = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const ArrowInIcon = ({ size = 10 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
  </svg>
);
const ArrowOutIcon = ({ size = 10 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
  </svg>
);
const ExternalLinkIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);
const BriefcaseIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
  </svg>
);
const WifiOffIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
    <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);
const WifiIcon = ({ size = 11 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);
const FilterIcon = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);
const DownloadIcon = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);
const AlertTriIcon = ({ size = 28 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

// ─── Sub-components ─────────────────────────────────────────────────────────────

function FlagPill({ flag }: { flag: FlagKey }) {
  const m: FlagMeta = FLAG_META[flag] ?? FLAG_META["CLEAN"];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border ${m.cls}`}>
      {m.label}
    </span>
  );
}

function ScoreBreakdownBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 w-32 shrink-0">
        {label.replace("_", " ")}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-black font-mono w-8 text-right" style={{ color }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

interface MetricTileProps {
  icon:        React.ComponentType<IconProps>;
  label:       string;
  value:       string;
  note:        string;
  valueColor?: string;
}

function MetricTile({ icon: Icon, label, value, note, valueColor = "text-[#CAFF33]" }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-2 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center gap-2 text-white/30">
        <Icon size={13} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <p className={`text-2xl font-black font-mono leading-none ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-white/35 font-semibold leading-tight">{note}</p>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────────

type ActiveTab = "transactions" | "breakdown";

export default function AccountLookupSection() {
  const [query,     setQuery]     = useState<string>("");
  const [result,    setResult]    = useState<AccountResult | null>(null);
  const [notFound,  setNotFound]  = useState<boolean>(false);
  const [loading,   setLoading]   = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<string>("Last 30 days");
  const [usedMock,  setUsedMock]  = useState<boolean>(false);
  const [mockMsg,   setMockMsg]   = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("transactions");

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
    setMockMsg(null);
    setActiveTab("transactions");

    const days = DAYS_MAP[dateRange] ?? 30;
    const { data, usedMock: wasMock, error } = await fetchAccountData(key, days, getToken());
    setResult(data);
    setNotFound(!data);
    setUsedMock(wasMock);
    if (error) setMockMsg(error);
    setLoading(false);
  }, [query, dateRange, getToken]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        background: "#080808",
        minHeight: "100vh",
        color: "#fff",
        padding: "32px",
        boxSizing: "border-box",
        maxWidth: "full",
        margin: "0 auto",
      }}
    >
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.3em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 6 }}>
          Investigation
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Account Lookup</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6, fontFamily: "system-ui, sans-serif" }}>
          Search any account to trace its complete fund flow history
        </p>
      </div>

      {/* ── Search Bar ──────────────────────────────────────────────────────── */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          background: "#0d0d0d",
          padding: "20px 24px",
          marginBottom: 24,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 2 }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.25)", display: "flex" }}>
              <SearchIcon size={15} />
            </span>
            <input
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Account ID or PAN — e.g. ACC-8872"
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 14,
                padding: "12px 16px 12px 40px",
                fontSize: 13,
                color: "#fff",
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <select
            value={dateRange}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDateRange(e.target.value)}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 14,
              padding: "12px 16px",
              fontSize: 13,
              color: "rgba(255,255,255,0.6)",
              fontFamily: "inherit",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option>Last 30 days</option>
            <option>Last 7 days</option>
          </select>

          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              background: "#CAFF33",
              color: "#000",
              border: "none",
              borderRadius: 14,
              padding: "12px 24px",
              fontSize: 11,
              fontWeight: 900,
              fontFamily: "inherit",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
            }}
          >
            {loading
              ? <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(0,0,0,0.25)", borderTop: "2px solid #000", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              : <SearchIcon size={14} />
            }
            Search
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", marginRight: 4 }}>Try:</span>
          {Object.keys(MOCK_ACCOUNTS).map((id) => (
            <button
              key={id}
              onClick={() => setQuery(id)}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 10,
                fontFamily: "inherit",
                color: "rgba(255,255,255,0.35)",
                cursor: "pointer",
              }}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!loading && !result && !notFound && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            border: "1px dashed rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 28px", color: "rgba(255,255,255,0.1)",
          }}>
            <SearchIcon size={28} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 900, color: "rgba(255,255,255,0.15)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 10px" }}>
            Search any account
          </h3>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontFamily: "system-ui,sans-serif", maxWidth: 320, margin: "0 auto" }}>
            Enter an account ID or PAN to trace its complete fund flow history and AI risk profile.
          </p>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "80px 0", color: "rgba(255,255,255,0.3)" }}>
          <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid rgba(255,255,255,0.08)", borderTop: "2px solid rgba(255,255,255,0.4)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase" }}>Tracing fund flow…</span>
        </div>
      )}

      {/* ── Not found ────────────────────────────────────────────────────────── */}
      {notFound && !loading && (
        <div style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          background: "#0d0d0d",
          padding: "48px 32px",
          textAlign: "center",
        }}>
          <div style={{ color: "rgba(234,179,8,0.5)", marginBottom: 16 }}><AlertTriIcon /></div>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>No account found for "{query}"</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: "system-ui,sans-serif" }}>
            Try ACC-8872, ACC-2219, or ACC-5504
          </p>
        </div>
      )}

      {/* ── Result ───────────────────────────────────────────────────────────── */}
      {result && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Live / mock badge */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            {usedMock ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 12,
                background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)",
                color: "#eab308", fontSize: 10, fontWeight: 900,
              }}>
                <WifiOffIcon size={11} />
                {mockMsg ?? "Showing demo data — backend offline"}
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 12,
                background: "rgba(202,255,51,0.08)", border: "1px solid rgba(202,255,51,0.2)",
                color: "#CAFF33", fontSize: 10, fontWeight: 900,
              }}>
                <WifiIcon size={11} />
                LIVE DATA
              </div>
            )}
          </div>

          {/* Account card */}
          <div style={{
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 20,
            background: "#0d0d0d",
            padding: "24px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          }}>
            <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
              <div style={{
                width: 52, height: 52, borderRadius: 14,
                border: `2px solid ${scoreRing(result.score)}22`,
                background: `${scoreRing(result.score)}0d`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, color: scoreRing(result.score),
              }}>
                <ShieldIcon size={22} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontWeight: 900, fontSize: 15 }}>ACCOUNT FOUND — {result.id}</span>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>·</span>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", fontFamily: "system-ui,sans-serif", fontWeight: 600 }}>
                    {result.name}
                  </span>
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 12, fontWeight: 900, padding: "4px 12px",
                    borderRadius: 10,
                    border: `1px solid ${scoreRing(result.score)}33`,
                    background: `${scoreRing(result.score)}12`,
                    color: scoreRing(result.score),
                  }}>
                    AnomaScore {result.score.toFixed(2)}
                  </span>
                </div>

                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>
                  {result.type} · Status: {result.status}
                </p>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {result.flags.map((f) => <FlagPill key={f} flag={f} />)}
                </div>

                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "system-ui,sans-serif", lineHeight: 1.6, marginBottom: 16 }}>
                  This account has{" "}
                  <span style={{ color: "#ef4444", fontWeight: 700 }}>{result.flags.length} active AI flag{result.flags.length !== 1 ? "s" : ""}</span>
                  {" "}in the last 48 hours. Fund trail is traced below. All transactions are shown chronologically.
                  You can open an investigation case directly from here.
                </p>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 18px", borderRadius: 12, fontSize: 10, fontWeight: 900,
                    letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                    color: "#f87171", fontFamily: "inherit",
                  }}>
                    <ExternalLinkIcon size={11} /> View in Graph
                  </button>
                  <button style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 18px", borderRadius: 12, fontSize: 10, fontWeight: 900,
                    letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.6)", fontFamily: "inherit",
                  }}>
                    <BriefcaseIcon size={11} /> Open Case
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Metric tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <MetricTile
              icon={TrendUpIcon}
              label={`Total Inflow (${dateRange === "Last 7 days" ? "7d" : "30d"})`}
              value={result.inflow}
              note={result.inflowNote}
              valueColor="text-[#CAFF33]"
            />
            <MetricTile
              icon={TrendDownIcon}
              label={`Total Outflow (${dateRange === "Last 7 days" ? "7d" : "30d"})`}
              value={result.outflow}
              note={result.outflowNote}
              valueColor="text-red-400"
            />
            <MetricTile
              icon={UsersIcon}
              label="Unique Counterparties"
              value={String(result.counterparties)}
              note={result.counterpartiesNote}
              valueColor="text-yellow-400"
            />
          </div>

          {/* Tabs */}
          <div style={{
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 20,
            background: "#0d0d0d",
            overflow: "hidden",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          }}>
            <div style={{ display: "flex", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", gap: 4, flex: 1 }}>
                {(["transactions", "breakdown"] as ActiveTab[]).map((id) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    style={{
                      padding: "6px 14px", borderRadius: 10, fontSize: 10, fontWeight: 900,
                      letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                      fontFamily: "inherit",
                      background: activeTab === id ? "rgba(202,255,51,0.12)" : "transparent",
                      border: activeTab === id ? "1px solid rgba(202,255,51,0.25)" : "1px solid transparent",
                      color: activeTab === id ? "#CAFF33" : "rgba(255,255,255,0.3)",
                    }}
                  >
                    {id === "transactions" ? "Transaction History" : "Score Breakdown"}
                  </button>
                ))}
              </div>
              {activeTab === "transactions" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {[FilterIcon, DownloadIcon].map((Icon, i) => (
                    <button key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 32, height: 32, borderRadius: 10,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                      color: "rgba(255,255,255,0.4)", cursor: "pointer",
                    }}>
                      <Icon size={13} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Transactions tab */}
            {activeTab === "transactions" && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.015)" }}>
                      {["Time", "Ref", "Channel", "Counterparty", "Amount", "Direction", "Flag"].map((h) => (
                        <th key={h} style={{
                          padding: "10px 20px", textAlign: "left",
                          fontSize: 9, fontWeight: 900, letterSpacing: "0.25em",
                          textTransform: "uppercase", color: "rgba(255,255,255,0.3)",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.transactions.map((tx, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "14px 20px", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{tx.time}</td>
                        <td style={{ padding: "14px 20px", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>{tx.ref}</td>
                        <td style={{ padding: "14px 20px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{tx.channel}</td>
                        <td style={{ padding: "14px 20px", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{tx.counterparty}</td>
                        <td style={{ padding: "14px 20px", fontSize: 12, fontWeight: 900, color: tx.direction === "IN" ? "#CAFF33" : "#f87171" }}>
                          {tx.amount}
                        </td>
                        <td style={{ padding: "14px 20px" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "4px 8px", borderRadius: 6, fontSize: 9, fontWeight: 900,
                            background: tx.direction === "IN" ? "rgba(202,255,51,0.1)" : "rgba(239,68,68,0.1)",
                            border: `1px solid ${tx.direction === "IN" ? "rgba(202,255,51,0.2)" : "rgba(239,68,68,0.2)"}`,
                            color: tx.direction === "IN" ? "#CAFF33" : "#f87171",
                          }}>
                            {tx.direction === "IN" ? <ArrowInIcon size={9} /> : <ArrowOutIcon size={9} />}
                            {tx.direction}
                          </span>
                        </td>
                        <td style={{ padding: "14px 20px" }}>
                          <FlagPill flag={tx.flag} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "12px 24px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 700 }}>
                    Showing {result.transactions.length} transactions · {dateRange} · {usedMock ? "Demo data" : "Live from PostgreSQL"}
                  </p>
                </div>
              </div>
            )}

            {/* Score breakdown tab */}
            {activeTab === "breakdown" && (
              <div style={{ padding: 28 }}>
                <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
                    {(Object.entries(result.scoreBreakdown) as [keyof ScoreBreakdown, number][]).map(([k, v]) => (
                      <ScoreBreakdownBar
                        key={k}
                        label={k}
                        value={v}
                        color={BAR_COLORS[k]}
                      />
                    ))}
                  </div>

                  <div style={{
                    width: 180, flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 16, padding: 20,
                    background: "rgba(255,255,255,0.02)",
                  }}>
                    <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
                      AnomaScore
                    </p>
                    <p style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: scoreRing(result.score), marginBottom: 8 }}>
                      {result.score.toFixed(2)}
                    </p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                      {result.score >= 0.75 ? "High risk · Alert triggered" : result.score >= 0.45 ? "Medium risk · Under review" : "Low risk · Monitoring"}
                    </p>
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
                        Primary pattern
                      </p>
                      {result.flags[0] && <FlagPill flag={result.flags[0]} />}
                    </div>
                    <p style={{ marginTop: 16, fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
                      {usedMock ? "Demo · Mock ML score" : "Live · AnomaNet ML pipeline"}
                    </p>
                  </div>
                </div>

                <div style={{
                  marginTop: 24, padding: "12px 16px", borderRadius: 12,
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "system-ui,sans-serif", lineHeight: 1.6 }}>
                    <strong style={{ color: "rgba(255,255,255,0.4)" }}>Score source:</strong>{" "}
                    {usedMock
                      ? "Mock data — in production these values come from GET /api/alerts?accountId=… which returns the latest Alert entity's scoreBreakdown JSONB column."
                      : `Live — sourced from Alert.scoreBreakdown (JSONB) via GET /api/alerts?accountId=${result.id}&size=1`
                    }
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Backend wiring footer */}
          {usedMock && (
            <div style={{
              padding: "16px 20px", borderRadius: 16,
              background: "rgba(202,255,51,0.04)", border: "1px solid rgba(202,255,51,0.12)",
            }}>
              <p style={{ fontSize: 10, fontWeight: 900, color: "#CAFF33", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
                🔌 Backend wiring needed to go live
              </p>
              <div style={{ fontFamily: "system-ui,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
                <p>1. <code style={{ color: "#CAFF33", fontSize: 11 }}>GET /api/accounts/lookup?q=&days=</code> → AccountLookupService.java (Blueprint §8.3)</p>
                <p>2. <code style={{ color: "#CAFF33", fontSize: 11 }}>GET /api/alerts?accountId=&minScore=0&size=1</code> → AlertRepository.findWithFilters() + accountId param (Blueprint §8.1)</p>
                <p>3. Set <code style={{ color: "#CAFF33", fontSize: 11 }}>NEXT_PUBLIC_API_BASE=http://localhost:8080</code> and <code style={{ color: "#CAFF33", fontSize: 11 }}>FORCE_MOCK=false</code></p>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input::placeholder { color: rgba(255,255,255,0.22); }
        select option { background: #1a1a1a; }
      `}</style>
    </div>
  );
}