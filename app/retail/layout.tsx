import RetailSidebar from "@/components/RetailSidebar";
export default function RetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas dark:bg-[#17140f]">
      <RetailSidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
