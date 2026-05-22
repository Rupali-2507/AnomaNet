/**
 * app/admin/page.tsx
 * Server component — uses getSession() from lib/session instead of next-auth auth().
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import dbConnect from "@/lib/mongodb";
import User from "@/models/User";
import Navbar from "../components/Navbar";
import AdminPanel from "../components/AdminPanel";

export default async function AdminPage() {
  const session = await getSession();

  if (!session || session.user.role !== "ADMIN") {
    redirect("/login");
  }

  await dbConnect();
  const realUsers = await User.find({}).lean();

  return (
    <main className="h-screen overflow-hidden flex flex-col bg-[#141414] text-white">
      <Navbar />
      <AdminPanel
        initialUsers={JSON.parse(JSON.stringify(realUsers))}
        session={session}
      />
      <footer className="bg-[#1A1A1A] py-4 border-t border-gray-800 text-center text-gray-500 text-[10px]">
        MULE HUNTER ADMINISTRATIVE CONTROL PANEL v1.0
      </footer>
    </main>
  );
}