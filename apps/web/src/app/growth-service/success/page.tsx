export default function GrowthServiceSuccessPage() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-6">🎉</div>
        <h1 className="text-2xl font-bold tracking-tight mb-3">You&apos;re in!</h1>
        <p className="text-muted-foreground mb-6">
          Thank you for subscribing. Check your email — we&apos;ll reach out within 24 hours to
          schedule your ICP onboarding call and launch your first campaign.
        </p>
        <div className="rounded-xl border border-border bg-card p-5 text-left space-y-2 text-sm">
          <p className="font-semibold">What happens next:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>You receive a calendar invite for your 30-minute onboarding call</li>
            <li>We build your prospect list and write your sequences</li>
            <li>Campaign goes live within 48 hours of the call</li>
            <li>Interested replies start arriving in your inbox</li>
          </ol>
        </div>
        <a
          href="/"
          className="mt-6 inline-block text-sm text-accent hover:underline"
        >
          ← Back to home
        </a>
      </div>
    </main>
  );
}
