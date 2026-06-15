"use client";

import { useState } from "react";

const FEATURES = [
  "AI identifies your ICP across 50M+ companies",
  "Verifies every email before sending (zero bounces)",
  "Writes personalized 4-step sequences for each prospect",
  "Classifies every reply — you only see 'Interested'",
  "INTERESTED replies forwarded to your inbox instantly",
];

const STEPS = [
  { n: "1", title: "You sign up + tell us your ICP", body: "30-minute onboarding call. Tell us who your ideal customer is." },
  { n: "2", title: "We build and launch your campaign", body: "We set up the sequences, verify the emails, and start sending within 48 hours." },
  { n: "3", title: "You wake up to interested replies", body: "Every reply that says 'yes' or 'tell me more' lands in your inbox, pre-screened." },
];

export default function GrowthServicePage() {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/self-serve-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="inline-block rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent mb-6">
          AI-Powered B2B Outbound
        </span>
        <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">
          Wake up to qualified meetings.<br />No SDR required.
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          We run the full outreach engine for you — discovery, personalization, sending, and reply triage.
          You only touch the "I&apos;m interested" replies.
        </p>
        <div className="mt-8 inline-flex items-center gap-3 rounded-xl bg-accent/10 px-6 py-3 text-sm font-medium">
          <span className="text-2xl font-bold text-foreground">$300</span>
          <span className="text-muted-foreground">/mo · cancel any time · no setup fee</span>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-2xl px-6 pb-16">
        <ul className="space-y-3">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex-shrink-0 text-accent font-bold">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-2xl px-6 pb-16">
        <h2 className="text-xl font-semibold mb-8 text-center">How it works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="rounded-xl border border-border bg-card p-5">
              <div className="text-2xl font-bold text-accent mb-2">{step.n}</div>
              <div className="font-semibold text-sm mb-1">{step.title}</div>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Signup form */}
      <section className="mx-auto max-w-md px-6 pb-24">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h2 className="text-lg font-semibold mb-1">Start for $300/mo</h2>
          <p className="text-sm text-muted-foreground mb-6">
            No setup fee. Cancel any time. Onboarding call scheduled after checkout.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Founder"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                required
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Redirecting to checkout…" : "Start for $300/mo →"}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground text-center">
            Secured by Stripe. No card stored by us.
          </p>
        </div>

        {/* DFY upgrade CTA */}
        <div className="mt-6 rounded-xl border border-border p-5 text-center">
          <p className="text-sm font-medium">Need full Done-For-You management?</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            $1,500 setup + $500–1,000/mo. We handle strategy, copy, and campaign optimization.
          </p>
          <a
            href="mailto:ashish@korrali.com?subject=DFY Growth Inquiry"
            className="text-xs font-semibold text-accent hover:underline"
          >
            Contact us about DFY →
          </a>
        </div>
      </section>
    </main>
  );
}
