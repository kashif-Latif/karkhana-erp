import OnlineSidebar from "@/components/OnlineSidebar";

export default function OnlineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas dark:bg-[#17140f]">
      <OnlineSidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
