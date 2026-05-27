const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "bhagat.ashish.a@gmail.com";
const FROM_EMAIL = process.env.EMAIL_FROM ?? "Korrali Growth <growth@korrali.com>";

export async function notifyFounderOfSignup(input: {
  userEmail: string;
  userName: string | null;
  userId: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const body = {
    from: FROM_EMAIL,
    to: [FOUNDER_EMAIL],
    subject: `New Growth signup — ${input.userEmail}`,
    text: [
      `New user signed up on Korrali Growth:`,
      ``,
      `Email: ${input.userEmail}`,
      `Name:  ${input.userName ?? "(not provided)"}`,
      `ID:    ${input.userId}`,
    ].join("\n"),
    reply_to: input.userEmail,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("notifyFounderOfSignup: resend non-2xx", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.error("notifyFounderOfSignup: fetch failed", e);
  }
}
