"use client";

import  { useState} from "react";
import {
  Zap, Briefcase, MoreHorizontal
} from "lucide-react";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";


import AccountLookupSection from "../components/AccountLookupSection";
import CasesPage from "../components/CaseSection";





const NAV = [
 
   { group: "INVESTIGATION", items: [
  
    { id: "account-lookup",  label: "Account Lookup",  icon: Zap, notifications: null },
    { id: "cases",      label: "Cases",      icon: Briefcase, notifications: 3 },
  ]},

] as const;

type View = typeof NAV[number]["items"][number]["id"];





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
  const [active, setActive] = useState<View>("account-lookup");

  const renderSection = () => {
    switch (active) {
      case "cases":     return <CasesPage />;
      case "account-lookup": return <AccountLookupSection />;
      default:          return <AccountLookupSection/>;
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