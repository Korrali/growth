// Custom magic-link email sent via Resend.
//
// Replaces next-auth's built-in template, which is a lone "Sign in" button with
// the subject "Sign in to <host>" and no brand, copy, or footer. On a young
// sending domain that thin, link-only shape is scored as phishing by Outlook /
// SmartScreen and lands in Junk. A branded subject, real copy, a visible URL,
// and a footer identifying the sender materially improve inbox placement.

type VerificationParams = {
  identifier: string;
  url: string;
  provider: { apiKey?: string; from?: string };
};

type EmailBrand = {
  /** Product name shown in the subject and body, e.g. "Korrali Revenue". */
  brand: string;
  /** Reply/support address shown in the footer. */
  supportEmail: string;
  /** One-line sender identification for the footer. */
  companyLine: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSignInEmail(opts: EmailBrand & { url: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { brand, url, supportEmail, companyLine } = opts;
  const safeUrl = escapeHtml(url);
  const subject = `Your ${brand} sign-in link`;

  const text = [
    `Sign in to ${brand}`,
    ``,
    `Use the link below to sign in. It can be used once and expires in 24 hours.`,
    ``,
    url,
    ``,
    `If you didn't request this, you can safely ignore this email — your account stays secure and no one can sign in without this link.`,
    ``,
    `— ${brand}`,
    companyLine,
    `Questions? Reply to this email or contact ${supportEmail}.`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f5f7;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your secure ${escapeHtml(
      brand,
    )} sign-in link — expires in 24 hours.</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e6e8eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:18px;font-weight:700;color:#111827;">${escapeHtml(brand)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#374151;">
                  Click the button below to sign in to your ${escapeHtml(brand)} account.
                  This link can be used once and expires in 24 hours.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 8px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background:#4f46e5;">
                      <a href="${safeUrl}" target="_blank"
                         style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        Sign in
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 6px 0;font-size:13px;line-height:1.5;color:#6b7280;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 16px 0;font-size:13px;line-height:1.5;word-break:break-all;">
                  <a href="${safeUrl}" target="_blank" style="color:#4f46e5;">${safeUrl}</a>
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#6b7280;">
                  If you didn't request this, you can safely ignore this email — your account
                  stays secure and no one can sign in without this link.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;border-top:1px solid #f0f1f3;">
                <p style="margin:16px 0 4px 0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  ${escapeHtml(companyLine)}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  Questions? Reply to this email or contact
                  <a href="mailto:${escapeHtml(supportEmail)}" style="color:#9ca3af;">${escapeHtml(
                    supportEmail,
                  )}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Build a next-auth Resend `sendVerificationRequest` handler bound to a brand.
 * Posts directly to the Resend API, mirroring the provider's own default but
 * with our subject/body/footer.
 */
export function makeSendVerificationRequest(brand: EmailBrand) {
  return async function sendVerificationRequest(params: VerificationParams): Promise<void> {
    const { identifier: to, url, provider } = params;
    const { subject, text, html } = buildSignInEmail({ ...brand, url });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: provider.from, to, subject, html, text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend sendVerificationRequest failed (${res.status}): ${detail}`);
    }
  };
}
