"use client";
/**
 * components/Navbar.tsx
 * Uses our custom useSession() from lib/session-context instead of next-auth.
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useSession } from "@/lib/session-context";

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { session, status, logout } = useSession();

  const role = session?.user?.role as "ADMIN" | "INVESTIGATOR" | undefined;

  return (
    <nav className="relative w-full bg-[#1A1A1A] border-b border-gray-800 z-50">
      <div className="flex items-center justify-between px-4 md:px-8 py-4">
        {/* LEFT */}
        <div className="flex items-center gap-4">
          <button
            className="md:hidden text-gray-400 hover:text-[#CAFF33] transition-colors"
            onClick={() => setIsMenuOpen((o) => !o)}
            aria-label="Toggle Menu"
          >
            {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
          <Image
            src="/logo2.png"
            alt="Logo"
            width={130}
            height={35}
            className="object-contain"
            priority
          />
        </div>

        {/* CENTER */}
        <div className="hidden md:flex gap-8 text-gray-400 text-sm font-medium items-center">
          <NavContent role={role} />
        </div>

        {/* RIGHT */}
        <div className="flex items-center">
          {status === "loading" ? (
            <div className="h-8 w-20 bg-gray-800 animate-pulse rounded-full" />
          ) : session ? (
            <div className="flex items-center gap-3">
              <span className="hidden lg:block text-xs text-gray-500 font-mono uppercase tracking-tighter">
                {session.user.username}
              </span>
              <span className="hidden lg:block text-[10px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 font-mono">
                {role}
              </span>
              <button
                onClick={logout}
                className="text-xs text-gray-400 hover:text-[#CAFF33] border border-gray-700 px-3 py-1.5 rounded-full transition-all font-mono"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="bg-[#CAFF33] px-6 py-2 rounded-full text-black font-bold text-sm hover:bg-[#b8e62e] transition-all"
            >
              Login
            </Link>
          )}
        </div>
      </div>

      {/* MOBILE DROPDOWN */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 w-full bg-[#1A1A1A] border-b border-gray-800 flex flex-col p-6 gap-6 md:hidden animate-in slide-in-from-top-2 duration-200">
          <NavContent role={role} onLinkClick={() => setIsMenuOpen(false)} />
        </div>
      )}
    </nav>
  );
};

type NavContentProps = {
  role?: "ADMIN" | "INVESTIGATOR" | string;
  onLinkClick?: () => void;
};

const NavContent = ({ role, onLinkClick }: NavContentProps) => (
  <>
    <Link href="/"              onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Home</Link>
    <Link href="/monitoring"    onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Monitoring</Link>
    <Link href="/investigation" onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Investigation</Link>
    <Link href="/reporting"     onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Reporting</Link>
    <Link href="/service"       onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Request Service</Link>
    {role === "ADMIN" && (
      <Link
        href="/admin"
        onClick={onLinkClick}
        className="hover:text-[#CAFF33] transition-colors underline underline-offset-4 decoration-1"
      >
        Admin Dashboard
      </Link>
    )}
  </>
);

export default Navbar;