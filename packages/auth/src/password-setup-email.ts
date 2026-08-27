const EXPIRY_HOURS = 24;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function passwordSetupEmail({
  name,
  email,
  url,
}: {
  name: string;
  email: string;
  url: string;
}) {
  const greeting = name.trim() ? `Hello ${name.trim()},` : "Hello,";
  const subject = "Set up your Fushin AI account";
  const text = `${greeting}

An administrator created or reset the Fushin AI account for ${email}.

Choose your password using this single-use link:
${url}

This link expires in ${EXPIRY_HOURS} hours. If you did not expect this email, contact your administrator.`;

  return {
    subject,
    text,
    html: `<p>${escapeHtml(greeting)}</p>
<p>An administrator created or reset the Fushin AI account for <strong>${escapeHtml(email)}</strong>.</p>
<p><a href="${escapeHtml(url)}">Choose your password</a></p>
<p>This single-use link expires in ${EXPIRY_HOURS} hours. If you did not expect this email, contact your administrator.</p>`,
  };
}
