import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { createOrgAction } from "@/lib/actions/org";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
  });
  if (membership) redirect("/growth");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 inline-grid h-10 w-10 place-items-center rounded-lg bg-accent text-white text-lg font-bold">
            K
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set up your workspace</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Create your organization to access Korrali Growth
          </p>
        </div>

        <form action={createOrgAction} className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="name">
              Organization name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="Korrali"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Create workspace
          </button>
        </form>
      </div>
    </main>
  );
}
