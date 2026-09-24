// Who cold outbound is signed as. GROWTH_FROM_NAME is either a person
// ("Ashish Bhagat") or a team ("The Korrali Team"); a person's first name
// signs the AI-written emails and replies so the From line and the sign-off
// agree. A team name leaves the sign-off to the writer.
export function senderFirstName(fromName = process.env.GROWTH_FROM_NAME): string | null {
  const name = fromName?.trim();
  if (!name || /^the\s/i.test(name) || /\bteam\b/i.test(name)) return null;
  return name.split(/\s+/)[0] ?? null;
}

export function signOffRule(): string {
  const first = senderFirstName();
  return first
    ? `SIGN-OFF: end every email with just "${first}" on its own line — no title, company, or signature block.`
    : "";
}
