import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

// Growth is an internal tool since the 2026-07-07 DFY sunset — there is no
// public product to market here. Signed-in users go to the app; everyone
// else goes to the Korrali umbrella site. /login remains directly reachable.
export default async function RootPage() {
  const session = await auth();
  if (session?.user) redirect("/growth");

  const isUat = (process.env.NEXTAUTH_URL ?? "").includes("-uat.");
  redirect(isUat ? "https://uat.korrali.com" : "https://korrali.com");
}
