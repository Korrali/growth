import { requireOrgContext } from "@/lib/org-context";
import { AppHeader } from "@/components/AppHeader";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org, user } = await requireOrgContext();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader orgName={org.name} userEmail={user.email ?? ""} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
