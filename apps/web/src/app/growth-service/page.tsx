import { redirect } from "next/navigation";

// DFY SDR service sunset 2026-07-07 — no new signups. Old links land on the
// umbrella site. The /growth-service/success page stays for any in-flight
// Stripe redirects.
export default function GrowthServicePage() {
  redirect("https://korrali.com");
}
