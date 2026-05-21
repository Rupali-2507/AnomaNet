// components/Navbar.tsx
"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import LogoutButton from "./LogoutButton";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

  return (
    <nav className="relative w-full bg-[#1A1A1A] border-b border-gray-800 z-50">
      <div className="flex items-center justify-between px-4 md:px-8 py-4">

        {/* LEFT: Logo & mobile hamburger */}
        <div className="flex items-center gap-4">
          <button
            className="md:hidden text-gray-400 hover:text-[#CAFF33] transition-colors"
            onClick={() => setIsMenuOpen((o) => !o)}
            aria-label="Toggle Menu"
          >
            {isMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
          <div className="flex items-center shrink-0">
            <Image
              src="/logo2.png"
              alt="Logo"
              width={130}
              height={35}
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* CENTER: desktop nav links */}
        <div className="hidden md:flex gap-8 text-gray-400 text-sm font-medium items-center">
          <NavContent session={session} />
        </div>

        {/* RIGHT: auth */}
        <div className="flex items-center">
          {status === "loading" ? (
            <div className="h-8 w-20 bg-gray-800 animate-pulse rounded-full" />
          ) : session ? (
            <div className="flex items-center gap-3">
              {/* username */}
              <span className="hidden lg:block text-xs text-gray-500 font-mono uppercase tracking-tighter">
                {session.user?.email} {/* email stores username — see lib/auth.ts */}
              </span>
              {/* role badge */}
              <span className="hidden lg:block text-[10px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400 font-mono">
                {(session.user as any)?.role}
              </span>
              <LogoutButton />
            </div>
          ) : (
            <button
              onClick={() => router.push("/login")}
              className="bg-[#CAFF33] px-6 py-2 rounded-full text-black font-bold text-sm hover:bg-[#b8e62e] transition-all cursor-pointer"
            >
              Login
            </button>
          )}
        </div>
      </div>

      {/* MOBILE DROPDOWN */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 w-full bg-[#1A1A1A] border-b border-gray-800 flex flex-col p-6 gap-6 md:hidden animate-in slide-in-from-top-2 duration-200">
          <NavContent session={session} onLinkClick={() => setIsMenuOpen(false)} />
        </div>
      )}
    </nav>
  );
};

type NavContentProps = {
  session: ReturnType<typeof useSession>["data"];
  onLinkClick?: () => void;
};

const NavContent = ({ session, onLinkClick }: NavContentProps) => (
  <>
    <Link href="/"            onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Home</Link>
    <Link href="/monitoring"  onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Monitoring</Link>{/* fixed typo */}
    <Link href="/investigation" onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Investigation</Link>
    <Link href="/reporting"   onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Reporting</Link>
    <Link href="/service"     onClick={onLinkClick} className="hover:text-[#CAFF33] transition-colors">Request Service</Link>

    {/* Admin link — role comes from server as "ADMIN" (uppercase) */}
    {(session?.user as any)?.role === "ADMIN" && (
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