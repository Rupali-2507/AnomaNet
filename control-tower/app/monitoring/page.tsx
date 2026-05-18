"use client";

import { useState} from "react";
import {
  LayoutDashboard, 
  Bell, FileSearch, MoreHorizontal
} from "lucide-react";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

import dynamic from "next/dynamic";
import NodeInspector from "../components/graph/NodeInspector";
import AlertsSection from "../components/AlertSection";
import DashboardPage from "../components/DashboardPage";
import type { GraphNode } from "../components/graph/FraudGraph3D";

const FraudGraph3D = dynamic(
  () => import("../components/graph/FraudGraph3D"),
  { ssr: false }
);


const NAV = [
  { group: "Monitoring", items: [
    { id: "dashboard",  label: "Dashboard",  icon: LayoutDashboard, notifications: null },
    { id: "alerts",     label: "Alerts",     icon: Bell, notifications: 12 },
    { id: "graph",      label: "Graph Explorer", icon: FileSearch, notifications: null },
  ]},
   
] as const;

type View = typeof NAV[number]["items"][number]["id"];

// --- Section 2: GRAPH EXPLORER ---
function GraphExplorerSection() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  return (
    <div className="w-full h-full flex flex-col">

      {/* 🔹 HEADER */}
      <div className="flex justify-between items-center mb-4 px-2">
        <h2 className="text-2xl font-black text-white">
          Network Graph Explorer
        </h2>

        <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex gap-1">
          <button className="px-3 py-1.5 bg-[#CAFF33] text-black text-[10px] font-bold rounded-lg uppercase">
            3D View
          </button>
          <button className="px-3 py-1.5 text-white/60 text-[10px] font-bold rounded-lg uppercase">
            Cluster
          </button>
        </div>
      </div>

      {/*  GRAPH AREA (FULL RIGHT SIDE) */}
      <div className="flex-1 relative rounded-2xl overflow-hidden border border-white/10">

        {/* GRAPH */}
        <FraudGraph3D
          onNodeSelect={setSelectedNode}
          selectedNode={selectedNode}
        />

        {/*  INSPECTOR OVERLAY */}
        {selectedNode && (
          <div className="absolute top-0 right-0 h-full z-20">
            <NodeInspector
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}

      </div>
    </div>
  );
}




// --- Sidebar Component ---
const Sidebar = ({ active, setActive }: { active: View, setActive: (v: View) => void }) => {
  return (
<aside className="w-64 shrink-0 border-r border-white/[0.07] flex flex-col py-8 px-4 h-[90vh] sticky top-0 bg-[#070707] z-20 overflow-y-auto ">      

      <nav className="flex-1 space-y-10">
        {NAV.map(group => (
          <div key={group.group}>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30 px-3 mb-3">{group.group}</p>
            <div className="space-y-1">
              {group.items.map(({ id, label, icon: Icon, notifications }) => {
                const isActive = active === id;
                return (
                  <button key={id} onClick={() => setActive(id)}
                    className={`w-full flex items-center gap-3.5 px-3 py-3 rounded-2xl text-left transition-all duration-200 group ${isActive ? "bg-white/[0.04] border border-white/10" : "hover:bg-white/[0.02]"}`}>
                    <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-[#CAFF33]" : "text-white/40 group-hover:text-white/70"}`} />
                    <span className={`text-[12px] font-bold tracking-tight flex-1 ${isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}`}>{label}</span>
                    {notifications && (
                      <span className="text-[9px] font-black bg-red-500 text-white min-w-[18px] h-[18px] flex items-center justify-center rounded-lg leading-none">
                        {notifications}
                      </span>
                    )}
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#CAFF33]" style={{boxShadow: '0 0 10px #CAFF33'}} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/[0.07] pt-6 px-2">
        <div className="bg-white/5 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-black border border-white/10">SR</div>
          <div className="flex-1 min-w-0">
             <p className="text-xs font-bold text-white truncate leading-none">S. Rathore</p>
             <p className="text-[9px] text-white/40 font-bold uppercase mt-1">Lead Investigator</p>
          </div>
          <button className="text-white/20 hover:text-white"><MoreHorizontal size={16}/></button>
        </div>
      </div>
    </aside>
  );
};

// --- Main Layout ---
export default function FraudDashboard() {
  const [active, setActive] = useState<View>("dashboard");

  const renderSection = () => {
    switch (active) {
      case "dashboard": return <DashboardPage />;
      case "alerts":    return <AlertsSection />;
      case "graph":     return <GraphExplorerSection />;
      
      default:          return <DashboardPage />;
    }
  };

 return (
  <div className="bg-[#060606] text-white h-screen overflow-hidden flex flex-col">

    {/* FIXED HEADER */}
    <div className="shrink-0">
      <Navbar />
    </div>

    {/* BODY */}
    <div className="flex flex-1 overflow-hidden">

      {/* FIXED SIDEBAR */}
      <aside className="w-64 shrink-0 border-r border-white/[0.07] bg-[#070707] h-full overflow-hidden">
        <Sidebar active={active} setActive={setActive} />
      </aside>

      {/* ONLY THIS PART SCROLLS */}
      <main className="flex-1 overflow-y-auto">
        <div className="w-full min-h-full px-6 py-6">
          {renderSection()}
        </div>
      </main>

    </div>

    {/* FIXED FOOTER */}
    <div className="shrink-0">
      <Footer />
    </div>

  </div>
);
}