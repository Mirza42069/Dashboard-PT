"use server";

import { Resend } from "resend";

import { content } from "@/lib/content";
import { demoEmail, parseDemoLead, type DemoFormState } from "@/lib/demo-form";
import { isDemoConfigured } from "@/lib/site";

export async function requestDemo(
  _state: DemoFormState,
  data: FormData,
): Promise<DemoFormState> {
  const locale = data.get("locale") === "en" ? "en" : "id";
  const t = content[locale];
  if (!isDemoConfigured()) {
    return { status: "error", message: t.demo.unavailable, errors: {} };
  }
  const { lead, errors } = parseDemoLead(data);
  if (!lead) return { status: "error", message: "", errors };
  if (lead.website) return { status: "success", message: locale === "id" ? "Permintaan demo telah diterima." : "Your demo request has been received.", errors: {} };

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const message = demoEmail(lead);
    const result = await resend.emails.send({
      from: process.env.DEMO_FROM_EMAIL!,
      to: process.env.DEMO_TO_EMAIL!,
      replyTo: lead.email,
      subject: `V2 demo request · ${lead.company}`,
      ...message,
    });
    if (result.error) throw new Error(result.error.message);
    return {
      status: "success",
      message:
        locale === "id"
          ? "Terima kasih. Tim V2 akan menghubungi Anda untuk menjadwalkan demo."
          : "Thank you. The V2 team will contact you to schedule the demo.",
      errors: {},
    };
  } catch {
    return {
      status: "error",
      message:
        locale === "id"
          ? "Permintaan belum dapat dikirim. Coba lagi beberapa saat lagi."
          : "Your request could not be sent. Try again in a moment.",
      errors: {},
    };
  }
}
