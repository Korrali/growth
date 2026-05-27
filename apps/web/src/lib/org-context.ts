import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function requireOrgContext() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
    include: { org: true },
    orderBy: { id: "asc" },
  });

  if (!membership) {
    redirect("/onboarding");
  }

  return {
    user: session.user,
    org: membership.org,
    role: membership.role,
  };
}
