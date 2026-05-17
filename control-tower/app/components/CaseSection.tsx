"use client";

import { useState } from "react";
import {
  Briefcase, ChevronRight, Check, Clock, User, AlertTriangle,
  TrendingUp, FileText, GitBranch, Search, Plus, X,
  ArrowUpRight, Shield, Layers, Circle, Activity,
  MoreHorizontal, Eye, ExternalLink, ChevronDown, Filter,
  LayoutDashboard, Bell, Globe, LogIn, Download
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type CaseStatus = "IN_REVIEW" | "IN_PROGRESS" | "ESCALATED" | "CLOSED_FP" | "CLOSED_FIU";
type Priority   = "HIGH" | "MEDIUM" | "LOW";
type StepStatus = "done" | "active" | "pending";

interface WorkflowStep {
  label: string;
  sublabel: string;
  status: StepStatus;
}

interface AuditEntry {
  time: string;
  date: string;
  actor: string;
  actorType: "ai" | "human";
  message: string;
  isPending?: boolean;
}

interface Investigator {
  initials: string;
  color: string;
}

interface Case {
  id: string;
  status: CaseStatus;
  priority?: Priority;
  title: string;
  subtitle: string;
  openedDate: string;
  assignedTo: string;
  alertRef: string;
  description: string;
  investigators: Investigator[];
  anomaScore: number;
  patternType: string;
  workflow: WorkflowStep[];
  auditTrail: AuditEntry[];
}

// ── Mock Data ──────────────────────────────────────────────────────────────
const CASES: Case[] = [
  {
    id: "CASE-0041",
    status: "IN_REVIEW",
    priority: "HIGH",
    title: "Circular Transaction — ACC-8872 Cluster",
    subtitle: "Opened 15 May 2026 · Assigned: Arjun Mehta · Alert: ALT-0091",
    openedDate: "15 May 2026",
    assignedTo: "Arjun Mehta",
    alertRef: "ALT-0091",
    description: "Three-account circular fund flow detected across branches in Mumbai and Delhi. Total cycle value ₹48.2L completed in 3.8 hours.",
    investigators: [
      { initials: "AM", color: "#00C2A8" },
      { initials: "SR", color: "#7C6BF8" },
    ],
    anomaScore: 0.91,
    patternType: "CIRCULAR",
    workflow: [
      { label: "AI Alert",  sublabel: "Raised",   status: "done"    },
      { label: "Graph",     sublabel: "Reviewed", status: "done"    },
      { label: "Human",     sublabel: "Decision", status: "active"  },
      { label: "Manager",   sublabel: "Approval", status: "pending" },
      { label: "FIU",       sublabel: "Report",   status: "pending" },
    ],
    auditTrail: [
      { time: "14:31", date: "15 May 2026", actor: "AnomaNet AI",  actorType: "ai",    message: "AI flagged circular pattern · AnomaScore 0.91" },
      { time: "14:33", date: "15 May 2026", actor: "Arjun Mehta",  actorType: "human", message: "Graph reviewed · Fund flow traced across ACC-8872, ACC-9912, ACC-3341" },
      { time: "14:36", date: "15 May 2026", actor: "Arjun Mehta",  actorType: "human", message: "Case CASE-0041 opened · Pattern consistent with round-tripping" },
      { time: "",      date: "",            actor: "",              actorType: "human", message: "Human decision required →", isPending: true },
    ],
  },
  {
    id: "CASE-0042",
    status: "IN_PROGRESS",
    priority: "HIGH",
    title: "Structuring Ring — Meena Iyer Network",
    subtitle: "Opened 14 May 2026 · Assigned: Priya Nair · Alert: ALT-0088",
    openedDate: "14 May 2026",
    assignedTo: "Priya Nair",
    alertRef: "ALT-0088",
    description: "Three deposits of ₹9.6L, ₹9.7L, ₹9.9L within 40 minutes from same entity — all below CTR threshold. Aggregate ₹29.2L.",
    investigators: [
      { initials: "PN", color: "#CAFF33" },
      { initials: "VK", color: "#F87171" },
    ],
    anomaScore: 0.83,
    patternType: "STRUCTURING",
    workflow: [
      { label: "AI Alert",  sublabel: "Raised",   status: "done"    },
      { label: "Graph",     sublabel: "Reviewed", status: "active"  },
      { label: "Human",     sublabel: "Decision", status: "pending" },
      { label: "Manager",   sublabel: "Approval", status: "pending" },
      { label: "FIU",       sublabel: "Report",   status: "pending" },
    ],
    auditTrail: [
      { time: "09:14", date: "14 May 2026", actor: "AnomaNet AI", actorType: "ai",    message: "Structuring pattern detected · 3 txns below ₹10L threshold · AnomaScore 0.83" },
      { time: "09:41", date: "14 May 2026", actor: "Priya Nair",  actorType: "human", message: "Graph explorer opened · Tracing counterparty ACC-7712" },
      { time: "",      date: "",            actor: "",             actorType: "human", message: "Graph review in progress →", isPending: true },
    ],
  },
  {
    id: "CASE-0043",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    title: "Dormant Activation — ACC-5504",
    subtitle: "Opened 13 May 2026 · Assigned: Rahul Sen · Alert: ALT-0085",
    openedDate: "13 May 2026",
    assignedTo: "Rahul Sen",
    alertRef: "ALT-0085",
    description: "Account silent for 14 months received ₹1.8 Cr from flagged cluster. No outbound activity yet — potential pre-positioned mule account.",
    investigators: [
      { initials: "RS", color: "#FB923C" },
    ],
    anomaScore: 0.88,
    patternType: "DORMANT",
    workflow: [
      { label: "AI Alert",  sublabel: "Raised",   status: "done"    },
      { label: "Graph",     sublabel: "Reviewed", status: "active"  },
      { label: "Human",     sublabel: "Decision", status: "pending" },
      { label: "Manager",   sublabel: "Approval", status: "pending" },
      { label: "FIU",       sublabel: "Report",   status: "pending" },
    ],
    auditTrail: [
      { time: "17:02", date: "13 May 2026", actor: "AnomaNet AI", actorType: "ai",    message: "Dormant activation detected · 14mo dormancy · ₹1.8Cr inbound · AnomaScore 0.88" },
      { time: "17:28", date: "13 May 2026", actor: "Rahul Sen",   actorType: "human", message: "Account KYC reviewed · Address mismatch flagged" },
      { time: "",      date: "",            actor: "",             actorType: "human", message: "Graph review in progress →", isPending: true },
    ],
  },
  {
    id: "CASE-0040",
    status: "CLOSED_FIU",
    priority: undefined,
    title: "Circular Transaction — ACC-3310",
    subtitle: "Closed 12 May 2026",
    openedDate: "10 May 2026",
    assignedTo: "Arjun Mehta",
    alertRef: "ALT-0079",
    description: "Round-tripping confirmed across 4 accounts. STR filed with FIU-IND goAML portal. Case closed.",
    investigators: [
      { initials: "AM", color: "#00C2A8" },
    ],
    anomaScore: 0.94,
    patternType: "CIRCULAR",
    workflow: [
      { label: "AI Alert",  sublabel: "Raised",   status: "done" },
      { label: "Graph",     sublabel: "Reviewed", status: "done" },
      { label: "Human",     sublabel: "Decision", status: "done" },
      { label: "Manager",   sublabel: "Approval", status: "done" },
      { label: "FIU",       sublabel: "Report",   status: "done" },
    ],
    auditTrail: [
      { time: "11:04", date: "10 May 2026", actor: "AnomaNet AI", actorType: "ai",    message: "Circular pattern detected · AnomaScore 0.94" },
      { time: "11:31", date: "10 May 2026", actor: "Arjun Mehta", actorType: "human", message: "Graph reviewed and confirmed" },
      { time: "13:10", date: "11 May 2026", actor: "Arjun Mehta", actorType: "human", message: "Escalated to Manager · Sufficient evidence" },
      { time: "09:00", date: "12 May 2026", actor: "V. Krishnan",  actorType: "human", message: "Manager approved STR filing" },
      { time: "10:22", date: "12 May 2026", actor: "AnomaNet AI", actorType: "ai",    message: "FIU report generated and submitted to goAML portal" },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────
const statusConfig: Record<CaseStatus, { label: string; className: string }> = {
  IN_REVIEW:   { label: "In Review",            className: "bg-amber-500/10 text-amber-400 border border-amber-500/20" },
  IN_PROGRESS: { label: "In Progress",          className: "bg-[#00C2A8]/10 text-[#00C2A8] border border-[#00C2A8]/20" },
  ESCALATED:   { label: "Escalated",            className: "bg-red-500/10 text-red-400 border border-red-500/20" },
  CLOSED_FP:   { label: "Closed · FP",          className: "bg-white/5 text-white/30 border border-white/10" },
  CLOSED_FIU:  { label: "Closed · FIU Reported",className: "bg-[#CAFF33]/10 text-[#CAFF33] border border-[#CAFF33]/20" },
};

const priorityConfig: Record<Priority, { label: string; className: string }> = {
  HIGH:   { label: "High Priority", className: "bg-red-500/10 text-red-400 border border-red-500/20" },
  MEDIUM: { label: "Med Priority",  className: "bg-amber-500/10 text-amber-400 border border-amber-400/20" },
  LOW:    { label: "Low Priority",  className: "bg-white/5 text-white/30 border border-white/10" },
};

const patternIcon: Record<string, React.ReactNode> = {
  CIRCULAR:    <Circle size={12} />,
  STRUCTURING: <Layers size={12} />,
  DORMANT:     <Activity size={12} />,
  LAYERING:    <GitBranch size={12} />,
};

const scoreColor = (s: number) =>
  s >= 0.75 ? "text-red-400" : s >= 0.45 ? "text-amber-400" : "text-[#CAFF33]";

const scoreBorder = (s: number) =>
  s >= 0.75 ? "border-red-500/30 bg-red-500/5" : s >= 0.45 ? "border-amber-500/30 bg-amber-500/5" : "border-[#CAFF33]/30 bg-[#CAFF33]/5";




// ── Step Circle ────────────────────────────────────────────────────────────
const StepCircle = ({ step, index }: { step: WorkflowStep; index: number }) => {
  const isDone   = step.status === "done";
  const isActive = step.status === "active";
  return (
    <div className="flex flex-col items-center gap-2 z-10">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
        ${isDone   ? "bg-[#00C2A8] border-[#00C2A8] text-black" : ""}
        ${isActive ? "bg-amber-500/10 border-amber-400 text-amber-400" : ""}
        ${!isDone && !isActive ? "bg-white/[0.04] border-white/10 text-white/20" : ""}
      `}>
        {isDone ? <Check size={14} strokeWidth={2.5} /> : isActive ? <User size={13} /> : index + 1}
      </div>
      <div className="text-center">
        <p className={`text-[10px] font-semibold uppercase tracking-wide leading-none
          ${isDone ? "text-[#00C2A8]" : isActive ? "text-amber-400" : "text-white/20"}`}>
          {step.label}
        </p>
        <p className={`text-[9px] mt-0.5 ${isDone ? "text-[#00C2A8]/60" : isActive ? "text-amber-400/60" : "text-white/15"}`}>
          {step.sublabel}
        </p>
      </div>
    </div>
  );
};

// ── Workflow Bar ───────────────────────────────────────────────────────────
const WorkflowBar = ({ steps }: { steps: WorkflowStep[] }) => {
  const doneCount  = steps.filter(s => s.status === "done").length;
  const progressPct = (doneCount / (steps.length - 1)) * 100;
  return (
    <div className="relative flex items-start justify-between pt-4 pb-2">
      <div className="absolute top-[2rem] left-[1rem] right-[1rem] h-[2px] bg-white/[0.07] rounded-full">
        <div
          className="h-full bg-[#00C2A8] rounded-full transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      {steps.map((step, i) => <StepCircle key={i} step={step} index={i} />)}
    </div>
  );
};

// ── Audit Entry ────────────────────────────────────────────────────────────
const AuditItem = ({ entry }: { entry: AuditEntry }) => {
  if (entry.isPending) {
    return (
      <div className="flex items-center gap-3 pl-1">
        <div className="w-2 h-2 rounded-full bg-white/20 shrink-0" />
        <div>
          <p className="text-[10px] text-white/25 italic">Pending…</p>
          <p className="text-xs text-white/25">{entry.message}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 pl-1">
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5
          ${entry.actorType === "ai" ? "bg-[#00C2A8]" : "bg-amber-400"}`} />
        <div className="w-px flex-1 bg-white/[0.05] min-h-[1.5rem]" />
      </div>
      <div className="pb-4">
        <div className="flex items-center gap-2 mb-1">
          {entry.time && (
            <span className="text-[10px] text-white/25 font-medium">
              {entry.time} · {entry.date}
            </span>
          )}
          {entry.actor && (
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md
              ${entry.actorType === "ai"
                ? "text-[#00C2A8] bg-[#00C2A8]/8"
                : "text-amber-400 bg-amber-500/8"}`}>
              {entry.actorType === "ai" ? "⚡" : "👤"} {entry.actor}
            </span>
          )}
        </div>
        <p className="text-[12px] text-white/60 leading-relaxed">{entry.message}</p>
      </div>
    </div>
  );
};

// ── Case Detail Panel ──────────────────────────────────────────────────────
const CaseDetail = ({ c, onClose }: { c: Case; onClose: () => void }) => {
  const activeStep = c.workflow.findIndex(s => s.status === "active");
  const stepLabel  = activeStep >= 0 ? c.workflow[activeStep].label : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[11px] font-bold text-[#00C2A8]">{c.id}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${statusConfig[c.status].className}`}>
              {statusConfig[c.status].label}
            </span>
            {c.priority && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${priorityConfig[c.priority].className}`}>
                {priorityConfig[c.priority].label}
              </span>
            )}
          </div>
          <h2 className="text-[15px] font-bold text-white leading-tight mb-1 tracking-tight">{c.title}</h2>
          <p className="text-[11px] text-white/35 font-medium">{c.subtitle}</p>
        </div>
        <div className="flex gap-2 ml-4 shrink-0 items-start">
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/10 text-[10px] font-semibold text-white/45 rounded-lg hover:bg-white/[0.08] transition-colors">
            <Eye size={11} /> View Graph
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00C2A8]/10 border border-[#00C2A8]/20 text-[10px] font-semibold text-[#00C2A8] rounded-lg hover:bg-[#00C2A8]/20 transition-colors">
            <FileText size={11} /> Build FIU Package
          </button>
          <button onClick={onClose} className="p-1.5 text-white/25 hover:text-white/50 transition-colors">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Meta bar */}
        <div className="flex items-center gap-4 px-6 py-2.5 border-b border-white/[0.04] bg-white/[0.01]">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-bold ${scoreColor(c.anomaScore)} ${scoreBorder(c.anomaScore)}`}>
            <Shield size={11} /> {c.anomaScore.toFixed(2)}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            {patternIcon[c.patternType]}
            <span>{c.patternType}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            <User size={11} /> <span>{c.assignedTo}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/35 font-medium">
            <AlertTriangle size={11} /> <span>{c.alertRef}</span>
          </div>
        </div>

        {/* Workflow */}
        <div className="px-6 py-5 border-b border-white/[0.06]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30 mb-4">Investigation Workflow</p>
          <WorkflowBar steps={c.workflow} />

          {activeStep >= 0 && (
            <div className="mt-5 p-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <User size={13} className="text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-bold text-amber-400 mb-1">
                  You are here — {stepLabel} Required (Step {activeStep + 1} of {c.workflow.length})
                </p>
                <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
                  Review all evidence collected so far. Add your findings below. Then either escalate to your manager for step {activeStep + 2}, or close the case if the evidence is insufficient.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/25 text-[10px] font-semibold uppercase tracking-wide text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors">
                    Escalate to Manager
                  </button>
                  <button className="px-3 py-1.5 bg-white/[0.04] border border-white/10 text-[10px] font-semibold uppercase tracking-wide text-white/40 rounded-lg hover:bg-white/[0.08] transition-colors">
                    Mark False Positive
                  </button>
                  <button className="px-3 py-1.5 bg-white/[0.04] border border-white/10 text-[10px] font-semibold uppercase tracking-wide text-white/40 rounded-lg hover:bg-white/[0.08] transition-colors">
                    Re-examine Graph
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Audit Trail */}
        <div className="px-6 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30 mb-4">Audit Trail</p>
          <div>
            {c.auditTrail.map((entry, i) => <AuditItem key={i} entry={entry} />)}
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.05]">
            <textarea
              placeholder="Add investigator note…"
              rows={2}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-[12px] text-white placeholder:text-white/20 focus:outline-none focus:border-[#00C2A8]/30 transition-all resize-none"
            />
            <div className="flex justify-end mt-2">
              <button className="px-4 py-2 bg-[#00C2A8] text-black text-[10px] font-bold uppercase tracking-wide rounded-lg hover:bg-[#00a894] transition-colors">
                Add Note
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Case Card ──────────────────────────────────────────────────────────────
const CaseCard = ({ c, onClick, isActive }: { c: Case; onClick: () => void; isActive: boolean }) => {
  const isClosed  = c.status === "CLOSED_FP" || c.status === "CLOSED_FIU";
  const doneSteps = c.workflow.filter(s => s.status === "done").length;

  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border cursor-pointer transition-all duration-200
        ${isActive
          ? "border-[#00C2A8]/30 bg-[#00C2A8]/[0.04]"
          : isClosed
            ? "border-white/[0.05] bg-white/[0.01] hover:border-white/10"
            : "border-white/[0.07] bg-[#111] hover:border-[#00C2A8]/20 hover:bg-[#00C2A8]/[0.03]"
        }
      `}
    >
      {isClosed ? (
        <div className="flex items-center gap-4 px-4 py-3">
          <span className="text-[11px] font-bold text-white/30">{c.id}</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${statusConfig[c.status].className}`}>
            {statusConfig[c.status].label}
          </span>
          <p className="text-[12px] text-white/40 flex-1 min-w-0 truncate font-medium">{c.title}</p>
          <p className="text-[10px] text-white/25 shrink-0 font-medium">{c.subtitle}</p>
          <ChevronRight size={13} className="text-white/15 group-hover:text-white/35 shrink-0 transition-colors" />
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border
              ${c.anomaScore >= 0.75 ? "bg-red-500/8 border-red-500/20" : "bg-amber-500/8 border-amber-500/20"}`}>
              <Briefcase size={14} className={c.anomaScore >= 0.75 ? "text-red-400" : "text-amber-400"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[10px] font-bold text-[#00C2A8]">{c.id}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${statusConfig[c.status].className}`}>
                  {statusConfig[c.status].label}
                </span>
                {c.priority && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${priorityConfig[c.priority].className}`}>
                    {priorityConfig[c.priority].label}
                  </span>
                )}
              </div>
              <p className="text-[13px] font-bold text-white leading-tight tracking-tight">{c.title}</p>
            </div>
            <div className={`text-[12px] font-bold shrink-0 ${scoreColor(c.anomaScore)}`}>
              {c.anomaScore.toFixed(2)}
            </div>
          </div>

          <p className="text-[11px] text-white/40 leading-relaxed mb-4 line-clamp-2 font-medium">{c.description}</p>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-semibold text-white/25 uppercase tracking-wider">Workflow Progress</span>
              <span className="text-[9px] font-semibold text-white/25">{doneSteps}/{c.workflow.length} steps</span>
            </div>
            <div className="h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00C2A8] rounded-full transition-all duration-500"
                style={{ width: `${(doneSteps / c.workflow.length) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-1 mt-2">
              {c.workflow.map((step, i) => (
                <div key={i} className={`flex-1 h-[2px] rounded-full transition-colors
                  ${step.status === "done"   ? "bg-[#00C2A8]" :
                    step.status === "active" ? "bg-amber-400" : "bg-white/[0.07]"}`} />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex -space-x-1.5">
              {c.investigators.map((inv, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold"
                  style={{ backgroundColor: `${inv.color}18`, color: inv.color, borderColor: "#111" }}
                >
                  {inv.initials}
                </div>
              ))}
              <span className="ml-3 text-[10px] text-white/25 self-center font-medium">
                {c.investigators.length} investigator{c.investigators.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-white/25 font-medium">
              {patternIcon[c.patternType]}
              <span className="uppercase tracking-wider">{c.patternType}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────
export default function CasesPage() {
  const [selectedId, setSelectedId] = useState<string | null>("CASE-0041");
  const [search, setSearch]         = useState("");
  const [filter, setFilter]         = useState<"ALL" | CaseStatus>("ALL");

  const selectedCase = CASES.find(c => c.id === selectedId) ?? null;

  const filtered = CASES.filter(c => {
    const matchSearch = search === "" ||
      c.id.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "ALL" || c.status === filter;
    return matchSearch && matchFilter;
  });

  const openCases   = CASES.filter(c => c.status !== "CLOSED_FP" && c.status !== "CLOSED_FIU");
  const closedCases = CASES.filter(c => c.status === "CLOSED_FP" || c.status === "CLOSED_FIU");

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
    

      <div className="flex flex-1 overflow-hidden">
        

        {/* ── Case List ── */}
        <div className={`flex flex-col border-r border-white/[0.06] transition-all duration-300 ${selectedCase ? "w-[400px] min-w-[340px]" : "flex-1"}`}>

          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/30 mb-1">Investigation</p>
                <h1 className="text-[22px] font-bold text-white tracking-tight">Case Management</h1>
              </div>
              <button className="flex items-center gap-1.5 px-4 py-2 bg-[#CAFF33] text-black text-[11px] font-bold uppercase tracking-wide rounded-xl hover:bg-[#b8e62e] transition-colors">
                <Plus size={12} /> New Case
              </button>
            </div>

            <div className="relative mb-3">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search cases…"
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-8 pr-4 py-2 text-[12px] text-white placeholder:text-white/20 focus:outline-none focus:border-[#00C2A8]/30 transition-all font-medium"
              />
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {(["ALL", "IN_REVIEW", "IN_PROGRESS", "ESCALATED", "CLOSED_FIU"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors
                    ${filter === f
                      ? "bg-[#00C2A8] text-black"
                      : "bg-white/[0.04] text-white/30 hover:text-white/50 border border-white/[0.07]"}`}
                >
                  {f === "ALL" ? "All" : f === "IN_REVIEW" ? "In Review" : f === "IN_PROGRESS" ? "In Progress" : f === "ESCALATED" ? "Escalated" : "FIU Reported"}
                </button>
              ))}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-b border-white/[0.06] shrink-0">
            {[
              { label: "Open Cases",    value: openCases.length,   color: "text-[#00C2A8]" },
              { label: "High Priority", value: CASES.filter(c => c.priority === "HIGH").length, color: "text-red-400" },
              { label: "FIU Reported",  value: closedCases.filter(c => c.status === "CLOSED_FIU").length, color: "text-[#CAFF33]" },
            ].map(stat => (
              <div key={stat.label} className="px-4 py-3 text-center">
                <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[9px] text-white/25 font-semibold uppercase tracking-wider mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-white/20">
                <Briefcase size={26} className="mx-auto mb-3 opacity-30" />
                <p className="text-[12px] font-semibold">No cases match your filters</p>
              </div>
            ) : (
              <>
                {filtered.filter(c => c.status !== "CLOSED_FP" && c.status !== "CLOSED_FIU").map(c => (
                  <CaseCard key={c.id} c={c} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)} isActive={selectedId === c.id} />
                ))}
                {filtered.filter(c => c.status === "CLOSED_FP" || c.status === "CLOSED_FIU").length > 0 && (
                  <>
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-white/[0.05]" />
                      <span className="text-[9px] font-semibold text-white/20 uppercase tracking-widest">Closed</span>
                      <div className="flex-1 h-px bg-white/[0.05]" />
                    </div>
                    {filtered.filter(c => c.status === "CLOSED_FP" || c.status === "CLOSED_FIU").map(c => (
                      <CaseCard key={c.id} c={c} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)} isActive={selectedId === c.id} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Case Detail ── */}
        {selectedCase && (
          <div className="flex-1 min-w-0 bg-[#0d0d0d] overflow-hidden">
            <CaseDetail c={selectedCase} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}