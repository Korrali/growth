import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function RootPage() {
  const session = await auth();
  if (session?.user) redirect("/growth");

  const isUat = (process.env.NEXTAUTH_URL ?? "").includes("-uat.");
  const korraliHome = isUat ? "https://uat.korrali.com" : "https://korrali.com";
  const bookingUrl = "mailto:admin@korrali.com?subject=Growth Service — Book a walkthrough";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: "Korrali Growth",
            url: "https://growth.korrali.com",
            serviceType: "Done-for-you B2B outbound / cold email service",
            provider: { "@type": "Organization", name: "Korrali", url: "https://korrali.com" },
            description:
              "Done-for-you B2B outbound: AI-verified email discovery, personalized cold-email sequences, and AI reply classification.",
            offers: [
              { "@type": "Offer", name: "Retainer", price: "500", priceCurrency: "USD" },
              { "@type": "Offer", name: "Pay-per-meeting", price: "150", priceCurrency: "USD" },
            ],
          }),
        }}
      />

      {/* Header */}
      <header className="border-b border-border/60 bg-background sticky top-0 z-50">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <span className="inline-grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-white">K</span>
            <span className="text-base">Korrali Growth</span>
          </Link>
          <a href={korraliHome} className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 sm:inline-flex">
            <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">K</span>
            Korrali
          </a>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:inline-flex rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              Sign in
            </Link>
            <a href={bookingUrl} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90">
              Book a walkthrough
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-12 sm:pt-16 pb-14 sm:pb-18">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            done-for-you B2B outreach · AI-powered · verified emails only
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
            Wake up to interested prospects.<br />
            <span className="text-accent">We run your entire B2B outbound.</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed">
            We discover your ICP, verify every email before sending, write 4-step personalized cold-email sequences, classify every reply with AI, and forward you only the interested ones. You touch nothing until a prospect says they want to talk.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
            <a href={bookingUrl} className="rounded-lg bg-foreground px-6 py-3 text-sm font-semibold text-background transition-colors hover:bg-foreground/85">
              Book a 15-min walkthrough
            </a>
            <a href="#how-it-works" className="rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              See how it works →
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">$1,500 setup · $500/mo retainer · or $150/qualified meeting</p>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-foreground text-background">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-background/50 mb-6">What runs on autopilot</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {[
              { value: "100%", label: "of emails NeverBounce-verified before sending — zero guesses", accent: true },
              { value: "4-step", label: "personalized sequences written by AI for your specific ICP and product", accent: true },
              { value: "< 2h", label: "INTERESTED replies classified and forwarded to your inbox automatically", accent: true },
              { value: "$70K", label: "fully-loaded SDR cost vs $500/mo flat — 99% cost reduction", accent: false },
            ].map(({ value, label, accent }) => (
              <div key={value} className={`rounded-xl p-5 ${accent ? "bg-accent/20" : "bg-background/5"}`}>
                <p className={`text-3xl font-bold tabular-nums ${accent ? "text-white" : "text-background/50"}`}>{value}</p>
                <p className={`text-xs mt-3 leading-relaxed ${accent ? "text-white/70" : "text-background/35"}`}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">The founder outbound trap</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">A US SDR costs $70K/yr. Cold email done wrong burns your domain.</h2>
            <p className="mt-4 text-lg text-background/70 leading-relaxed">
              Most founders try cold email once, get a 40% bounce rate, and give up. The problem isn&apos;t the idea — it&apos;s guessing email patterns, sending to unverified addresses, and writing sequences that sound like spam.
            </p>
            <p className="mt-3 text-sm text-background/55 leading-relaxed">
              We&apos;ve built the infrastructure: NeverBounce mailbox verification, AI-personalized copy based on your ICP, Resend deliverability on dedicated domains, and AI reply classification so you only see the good stuff.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { title: "Verified emails only", body: "Every email pattern is checked via NeverBounce SMTP verification before a single send. No guesses, no bounces, no reputation damage." },
              { title: "Your ICP, not a template", body: "We profile your ideal customer at onboarding and the AI generates sequences grounded in their specific pain, signals, and language." },
              { title: "Dedicated sending domain", body: "We set up a clean sending domain for you (e.g. getacme.com), warm it slowly, then ramp. Your main domain stays safe." },
              { title: "AI filters the noise", body: "Every reply is classified — INTERESTED, objection, wrong person, not now. You only see the interested ones, forwarded to your inbox within 2 hours." },
            ].map(({ title, body }) => (
              <div key={title} className="rounded-lg border border-background/15 bg-background/5 p-5">
                <h3 className="font-semibold text-background">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-background/70">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we do */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">What&apos;s included</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">The full outbound stack. Done for you.</h2>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">Everything below runs automatically from day one. You check your email for interested prospects.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: "🔍",
              title: "ICP company discovery",
              body: "AI scans the web daily to find companies that match your ideal customer profile — firmographics, tech stack, recent signals like ProductHunt launches or job postings.",
            },
            {
              icon: "✅",
              title: "Verified contact finding",
              body: "We identify decision-makers (founders, heads of sales, CTOs) and verify their email via NeverBounce before saving. No contact is added without a confirmed deliverable mailbox.",
            },
            {
              icon: "✍️",
              title: "AI-personalized sequences",
              body: "4-step sequences written for your specific product and ICP — not generic cold email templates. Each step references your prospect&apos;s company, role, and pain signal.",
            },
            {
              icon: "📬",
              title: "Managed sending",
              body: "We handle SPF, DKIM, DMARC, and domain warm-up. Sequences send inside business hours at a safe volume — 20 per day per campaign, ramping slowly.",
            },
            {
              icon: "🤖",
              title: "AI reply classification",
              body: "Every reply is classified: INTERESTED, NOT_NOW, WRONG_PERSON, OBJECTION, UNSUBSCRIBE. Unsubscribes are suppressed immediately. You never see noise.",
            },
            {
              icon: "📩",
              title: "Interested reply forwarding",
              body: "When a prospect replies INTERESTED, it&apos;s forwarded to your inbox within 2 hours with their full profile and an AI-drafted suggested response. You take it from there.",
            },
          ].map(({ icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6 space-y-3">
              <span className="text-2xl">{icon}</span>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">How it works</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Live in under a week. Interested replies flowing by week two.</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-5">
            {[
              { n: 1, title: "Onboarding call (30 min)", body: "We learn your ICP, product, and what a qualified meeting looks like. You send us your from email — we handle the rest." },
              { n: 2, title: "Domain + deliverability setup", body: "We provision a clean sending domain, configure SPF/DKIM/DMARC, add inbound routing, and warm the domain over 5 days." },
              { n: 3, title: "Sequences launch", body: "AI discovers companies, verifies contacts, writes personalized sequences, and starts sending — 20/day, ramping to 50+/day as reputation builds." },
              { n: 4, title: "You receive interested replies", body: "Every interested reply arrives in your inbox, pre-classified, with the prospect&apos;s profile and an AI-drafted suggested response. You close the deal." },
            ].map(({ n, title, body }) => (
              <div key={n} className="rounded-xl border border-border bg-background p-6 space-y-3">
                <span className="inline-grid w-9 h-9 place-items-center rounded-md bg-accent/10 text-accent font-bold text-sm">{n}</span>
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fit check */}
      <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Honest fit check</p>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Who this is for — and who it isn&apos;t.</h2>
        <div className="mt-10 grid lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-success/30 bg-success/5 p-6">
            <p className="font-semibold text-foreground mb-4">Strong fit ✓</p>
            <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <li className="flex gap-2"><span className="text-success shrink-0">•</span><span>Early-stage B2B founders (software, services, or product), 2–20 employees, 6–36 months in. Selling to other businesses.</span></li>
              <li className="flex gap-2"><span className="text-success shrink-0">•</span><span>No dedicated SDR or sales hire yet — you&apos;re the closer, not the prospector.</span></li>
              <li className="flex gap-2"><span className="text-success shrink-0">•</span><span>You tried cold email, burned a domain, and gave up — or you&apos;ve been meaning to start and never had time.</span></li>
              <li className="flex gap-2"><span className="text-success shrink-0">•</span><span>Bootstrapped or seed-stage. A $70K SDR salary is off the table.</span></li>
              <li className="flex gap-2"><span className="text-success shrink-0">•</span><span>You want qualified meetings booked into your calendar, not a course on cold email.</span></li>
            </ul>
          </div>
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-6">
            <p className="font-semibold text-foreground mb-4">Not a fit !</p>
            <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <li className="flex gap-2"><span className="text-warning shrink-0">•</span><span><strong className="text-foreground">You sell B2C.</strong> Cold outbound doesn&apos;t work for consumer products.</span></li>
              <li className="flex gap-2"><span className="text-warning shrink-0">•</span><span><strong className="text-foreground">You already have a sales team.</strong> We fill a pipe gap, not an AE shortage.</span></li>
              <li className="flex gap-2"><span className="text-warning shrink-0">•</span><span><strong className="text-foreground">You want a list and a template.</strong> We run the whole thing — if you want DIY, we&apos;re not the right fit.</span></li>
              <li className="flex gap-2"><span className="text-warning shrink-0">•</span><span><strong className="text-foreground">Your ICP is too broad or undefined.</strong> Effective outbound requires a sharply defined ideal customer — we help refine it, but you need a starting point.</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20 space-y-8">
          <div className="text-center space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Two ways to pay. One result.</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">Setup covers onboarding, domain provisioning, ICP research, and sequence writing. Ongoing is fully managed — discovery, sending, classification, and forwarding.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {[
              {
                name: "Retainer",
                setup: "$1,500",
                ongoing: "$500–1,000 / mo",
                desc: "Flat monthly fee. Predictable cost, unlimited sequences, as many companies as we can reach in your ICP.",
                features: [
                  "Full ICP company discovery (daily)",
                  "NeverBounce-verified contact finding",
                  "AI-personalized 4-step sequences",
                  "20–50+ verified sends/day per campaign",
                  "AI reply classification + interested forwarding",
                  "Dedicated sending domain (we manage it)",
                  "Monthly performance report",
                ],
                cta: "Book a walkthrough",
                highlight: true,
                href: bookingUrl,
              },
              {
                name: "Pay-per-meeting",
                setup: "$1,500",
                ongoing: "$150 / qualified meeting",
                desc: "Pay only when a prospect books a meeting and qualifies. Lower risk if you&apos;re uncertain about volume.",
                features: [
                  "Everything in Retainer",
                  "Qualified meeting = shows up + fits your ICP",
                  "We pre-qualify interested replies before forwarding",
                  "No monthly fee — pay per outcome",
                  "Ideal for testing before committing to retainer",
                ],
                cta: "Book a walkthrough",
                highlight: false,
                href: bookingUrl,
              },
            ].map(({ name, setup, ongoing, desc, features, cta, highlight, href }) => (
              <div key={name} className={`rounded-xl border-2 p-6 flex flex-col space-y-4 ${highlight ? "border-accent bg-background shadow-sm" : "border-border bg-background/60"}`}>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{name}</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{setup} <span className="text-sm font-normal text-muted-foreground">setup</span></p>
                  <p className="text-lg font-semibold text-accent">{ongoing}</p>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
                <ul className="space-y-1.5 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-accent mt-0.5 shrink-0">✓</span>{f}
                    </li>
                  ))}
                </ul>
                <a href={href} className={`block w-full rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-colors ${highlight ? "bg-accent text-white hover:bg-accent/90" : "bg-foreground/5 border border-border text-foreground hover:bg-foreground/10"}`}>
                  {cta}
                </a>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Not sure which plan fits? Start with a 15-min call.{" "}
            <a href={bookingUrl} className="text-accent hover:underline underline-offset-4">Book here →</a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">We find your prospects, verify every email, and write the sequences. You close the deals.</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Book a 15-minute walkthrough. We&apos;ll show you the live pipeline, explain how the ICP profiling works, and confirm you&apos;re a fit before you commit to anything.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-sm mx-auto justify-center">
            <a href={bookingUrl} className="rounded-xl bg-foreground text-background px-6 py-3 text-sm font-semibold hover:bg-foreground/85 transition">
              Book a walkthrough
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">$1,500 setup · Retainer from $500/mo · Pay-per-meeting $150/qualified meeting</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <span className="inline-grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">K</span>
            <span className="font-semibold text-foreground">Korrali Growth</span>
            <span className="text-xs">· part of <a href={korraliHome} className="hover:text-foreground transition-colors">Korrali</a></span>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <a href="https://trust.korrali.com" className="hover:text-foreground transition-colors">Korrali Trust</a>
            <a href="https://revenue.korrali.com" className="hover:text-foreground transition-colors">Korrali Revenue</a>
            <a href={`${korraliHome}/privacy.html`} className="hover:text-foreground transition-colors">Privacy</a>
            <a href={`${korraliHome}/terms.html`} className="hover:text-foreground transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
