import { env } from "@DashboardV2/env/server";

/**
 * Transactional email through Resend's REST API — no SDK, one endpoint.
 *
 * Senders treat failures as non-fatal: a failed invite must not roll back the
 * account it belongs to, and a failed reset email must look identical to a
 * reset for an unknown address. Callers catch and log.
 */

const FROM = "Fushin <noreply@fushin.app>";

/** Base URL for links inside emails; unset means production. */
function appUrl(): string {
  return env.APP_URL?.replace(/\/+$/, "") ?? "https://fushin.app";
}

async function send(input: { to: string; subject: string; html: string }) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: input.to, subject: input.subject, html: input.html }),
  });
  if (!response.ok) throw new Error(`Resend rejected the message (${response.status})`);
}

/** The shared shell: plain, dark-mode-friendly, no images, no tracking. */
function layout(title: string, bodyHtml: string) {
  return `<!DOCTYPE html><html lang="id"><body style="margin:0;padding:24px;background:#f7f7f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:32px">
<p style="margin:0 0 16px;font-size:16px;font-weight:600">Fushin</p>
<h1 style="margin:0 0 16px;font-size:18px;font-weight:600">${title}</h1>
${bodyHtml}
</div>
<p style="max-width:480px;margin:16px auto 0;font-size:12px;color:#71717a">Email otomatis — balasan tidak dipantau.</p>
</body></html>`;
}

function actionButton(url: string, label: string) {
  return `<a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:6px">${label}</a>
<p style="margin:16px 0 0;font-size:12px;color:#71717a;word-break:break-all">Jika tombol tidak berfungsi, salin tautan ini: ${url}</p>`;
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Atur ulang kata sandi Fushin",
    html: layout(
      "Atur ulang kata sandi",
      `<p style="margin:0 0 20px;font-size:14px;line-height:1.6">Kami menerima permintaan atur ulang kata sandi untuk akun Fushin Anda. Tautan berlaku <strong>1 jam</strong> dan hanya bisa dipakai sekali.</p>
${actionButton(link, "Pilih kata sandi baru")}
<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#71717a">Abaikan email ini jika Anda tidak meminta pengaturan ulang — kata sandi Anda tidak berubah.</p>`,
    ),
  });
}

/**
 * Best-effort invite for flows that must survive a mail outage — creating an
 * account must not roll back because Resend hiccupped. Never throws; the
 * boolean tells the caller whether to offer manual delivery.
 */
export async function trySendInviteEmail(input: { to: string; name: string; temporaryPassword: string }): Promise<boolean> {
  try {
    await send({
      to: input.to,
      subject: "Akun Fushin Anda",
      html: layout(
        `Selamat datang, ${escapeHtml(input.name)}!`,
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.6">Akun Fushin Anda telah dibuat dengan email <strong>${escapeHtml(input.to)}</strong>. Gunakan kata sandi sementara di bawah untuk masuk pertama kali.</p>
<div style="margin:0 0 20px;padding:12px 16px;border:1px solid #e4e4e7;border-radius:6px;font-family:ui-monospace,monospace;font-size:16px;letter-spacing:1px">${escapeHtml(input.temporaryPassword)}</div>
${actionButton(`${appUrl()}/login`, "Masuk ke Fushin")}
<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#71717a">Anda akan diminta membuat kata sandi baru setelah masuk.</p>`,
      ),
    });
    return true;
  } catch (error) {
    console.error("Invite email could not be sent", error);
    return false;
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
