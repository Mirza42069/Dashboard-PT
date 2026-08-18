export type DemoFormErrors = Partial<
  Record<"name" | "company" | "email" | "role" | "size" | "challenge", string>
>;

export type DemoFormState = {
  status: "idle" | "success" | "error";
  message: string;
  errors: DemoFormErrors;
};

type DemoLead = {
  locale: "id" | "en";
  name: string;
  company: string;
  email: string;
  role: string;
  size: string;
  challenge: string;
  website: string;
};

function value(data: FormData, key: string) {
  const raw = data.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export function parseDemoLead(data: FormData): { lead?: DemoLead; errors: DemoFormErrors } {
  const locale = value(data, "locale") === "en" ? "en" : "id";
  const lead: DemoLead = {
    locale,
    name: value(data, "name"),
    company: value(data, "company"),
    email: value(data, "email"),
    role: value(data, "role"),
    size: value(data, "size"),
    challenge: value(data, "challenge"),
    website: value(data, "website"),
  };
  const errors: DemoFormErrors = {};
  const required = locale === "id" ? "Wajib diisi" : "Required";
  if (!lead.name) errors.name = required;
  else if (lead.name.length > 120) errors.name = locale === "id" ? "Maksimal 120 karakter" : "Use 120 characters or fewer";
  if (!lead.company) errors.company = required;
  else if (lead.company.length > 120) errors.company = locale === "id" ? "Maksimal 120 karakter" : "Use 120 characters or fewer";
  if (!lead.email) errors.email = required;
  else if (lead.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    errors.email = locale === "id" ? "Masukkan email kerja yang valid" : "Enter a valid work email";
  }
  if (!lead.role) errors.role = required;
  else if (lead.role.length > 120) errors.role = locale === "id" ? "Maksimal 120 karakter" : "Use 120 characters or fewer";
  if (lead.size && (!/^\d{1,5}$/.test(lead.size) || Number(lead.size) < 0)) {
    errors.size = locale === "id" ? "Masukkan jumlah proyek" : "Enter a project count";
  }
  if (!lead.challenge) errors.challenge = required;
  else if (lead.challenge.length > 2000) errors.challenge = locale === "id" ? "Maksimal 2.000 karakter" : "Use 2,000 characters or fewer";
  return Object.keys(errors).length > 0 ? { errors } : { lead, errors };
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function demoEmail(lead: DemoLead) {
  const fields = [
    ["Name", lead.name],
    ["Company", lead.company],
    ["Work email", lead.email],
    ["Role", lead.role],
    ["Active projects", lead.size || "Not provided"],
    ["Language", lead.locale.toUpperCase()],
  ];
  const text = `New Fushin demo request\n\n${fields.map(([label, entry]) => `${label}: ${entry}`).join("\n")}\n\nChallenge:\n${lead.challenge}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#171717;line-height:1.6"><h1 style="font-size:22px">New Fushin demo request</h1><table style="border-collapse:collapse;width:100%;max-width:640px">${fields.map(([label, entry]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;color:#666">${escapeHtml(label)}</td><td style="padding:8px 12px;border-bottom:1px solid #e5e5e5"><strong>${escapeHtml(entry)}</strong></td></tr>`).join("")}</table><h2 style="font-size:16px;margin-top:24px">Main challenge</h2><p style="white-space:pre-wrap">${escapeHtml(lead.challenge)}</p></div>`;
  return { text, html };
}
