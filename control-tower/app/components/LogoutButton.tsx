// components/LogoutButton.tsx
"use client";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";

export default function LogoutButton() {
  const router = useRouter();
  const { session } = useSession();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  if (!session) return null;

  return (
    <button
      onClick={handleLogout}
      className="bg-transparent border border-gray-700 px-4 py-1.5 rounded-full text-gray-400 font-mono text-xs hover:border-[#CAFF33] hover:text-[#CAFF33] transition-all cursor-pointer"
    >
      Logout
    </button>
  );
}