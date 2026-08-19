export type Locale = "id" | "en";

/**
 * Indonesian is the master dictionary. `en` is typed as `Content`, which is
 * derived from this object, so a missing or misspelled key is a compile error
 * rather than a silently untranslated string.
 *
 * House style: short titles, one line of body at most, no em dashes.
 * Screenshot `alt` values are the exception. They stand in for the image for
 * anyone who cannot see it, so they stay descriptive.
 */
const id = {
  locale: "id" as const,
  languageName: "Bahasa Indonesia",
  alternateLocale: "en" as const,
  alternateLabel: "EN",
  nav: {
    home: "Beranda Fushin",
    skipToContent: "Lewati ke konten",
  },
  hero: {
    titleStart: "Kendalikan progres konstruksi.",
    titleAccent: "Dari baseline sampai keputusan.",
    body: "Baseline BoQ, rencana vs realisasi, dan laporan lapangan dalam satu tempat.",
    secondary: "Lihat cara kerjanya",
  },
  proof: {
    label: "Kemampuan inti",
    items: [
      "Impor Excel dibantu AI",
      "Bahasa Indonesia & English",
      "Periode mingguan sampai bulanan",
      "Review berbasis peran",
    ],
  },
  shots: {
    dashboard: {
      alt: "Dasbor portofolio Fushin menampilkan nilai portofolio, pekerjaan terukur, dan daftar proyek yang perlu perhatian.",
      title: "Kontrol portofolio",
      caption: "Dasbor",
    },
    progress: {
      alt: "Tab progres proyek Fushin dengan kurva-S rencana versus realisasi dan deviasi kumulatif.",
      title: "Progres proyek",
      caption: "Kurva-S",
    },
    import: {
      alt: "Dialog impor workbook Fushin pada langkah pemilihan berkas .xlsx, sebelum AI membaca tata letaknya.",
      title: "Impor workbook",
      caption: "Impor .xlsx",
    },
    boq: {
      alt: "Tab BoQ Fushin menampilkan item pekerjaan, bobot, volume, harga satuan, dan jumlah.",
      title: "Bill of Quantities",
      caption: "Baseline",
    },
  },
  liveDemo: {
    title: "Empat langkah per periode.",
    body: "Setiap langkah tercatat: siapa, kapan, alasannya.",
    steps: [
      { label: "Bangun baseline", detail: "142 item BoQ" },
      { label: "Catat realisasi", detail: "Volume kumulatif" },
      { label: "Tinjau deviasi", detail: "−15,0% vs rencana" },
      { label: "Setujui & kunci", detail: "Tercatat permanen" },
    ],
    running: "Memproses",
    complete: "Periode terkunci",
    replay: "Jalankan lagi",
    duration: "Selesai",
  },
  ai: {
    title: "Impor BoQ dari Excel.",
    body: "AI membaca tata letak workbook Anda, lalu menyusun draft baseline.",
    bullets: [
      ["Membaca format, bukan mengisi angka", "AI hanya mengenali tata letak. Semua angka tetap berasal dari workbook Anda."],
      ["Anda menyetujui dulu", "Pemetaan kolom ditampilkan untuk ditinjau sebelum baseline dibuat."],
      ["Ada cadangan deterministik", "Bila AI ragu, pembacaan berbasis aturan mengambil alih."],
    ],
    note: ".xlsx hingga 4 MB. File asli tidak disimpan.",
  },
  attention: {
    title: "Mulai dari yang bermasalah.",
    body: "Deviasi jadwal, pelaporan tersendat, dan tindakan terbuka muncul lebih dulu.",
    bullets: [
      "Rencana vs realisasi pada tanggal data yang sama.",
      "Buka proyek dan tab yang tepat dari tiap baris.",
      "Nilai kontrak dan pekerjaan terukur dalam satu tampilan.",
    ],
  },
  progress: {
    title: "Angka yang bisa ditelusuri.",
    body: "Kurva-S, deviasi, dan penyumbang keterlambatan dihitung dari baseline aktif.",
    stats: [
      ["45,0%", "Realisasi"],
      ["60,0%", "Rencana"],
      ["−15,0%", "Deviasi"],
    ],
  },
  baseline: {
    title: "Satu baseline aktif.",
    body: "Revisi berjalan sebagai draft. Versi lama tetap tersimpan.",
  },
  demo: {
    title: "Jadwalkan demo.",
    body: "Sekitar 30 menit. Gratis, tanpa komitmen.",
    unavailable: "Kirim email dan kami balas untuk menjadwalkan.",
    emailCta: "Email kami",
    mailSubject: "Permintaan demo Fushin",
    mailNote: "Email Anda hanya dipakai untuk membalas permintaan ini.",
    privacyLink: "Kebijakan privasi",
    sequence: ["BoQ", "Jadwal", "Progres", "Keputusan"],
    fields: {
      name: "Nama",
      company: "Perusahaan",
      email: "Email kerja",
      role: "Peran",
      size: "Jumlah proyek aktif",
      challenge: "Apa yang ingin Anda rapikan?",
      challengePlaceholder: "Contoh: progres terlambat diketahui.",
      submit: "Kirim permintaan",
      submitting: "Mengirim…",
    },
    privacy: "Dengan mengirim form ini, Anda setuju dihubungi terkait demo Fushin.",
  },
};

type DeepString<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { [K in keyof T]: DeepString<T[K]> }
    : T extends object
      ? { [K in keyof T]: DeepString<T[K]> }
      : T;

export type Content = Omit<DeepString<typeof id>, "locale" | "alternateLocale"> & {
  locale: Locale;
  alternateLocale: Locale;
};

const en: Content = {
  locale: "en",
  languageName: "English",
  alternateLocale: "id",
  alternateLabel: "ID",
  nav: {
    home: "Fushin home",
    skipToContent: "Skip to content",
  },
  hero: {
    titleStart: "Control construction progress.",
    titleAccent: "Baseline to decision.",
    body: "BoQ baselines, planned vs actual, and field reports in one place.",
    secondary: "See how it works",
  },
  proof: {
    label: "Core capabilities",
    items: [
      "AI-assisted Excel import",
      "English & Bahasa Indonesia",
      "Weekly to monthly periods",
      "Role-based review",
    ],
  },
  shots: {
    dashboard: {
      alt: "The Fushin portfolio dashboard showing portfolio value, measured work, and the list of projects needing attention.",
      title: "Portfolio control",
      caption: "Dashboard",
    },
    progress: {
      alt: "The Fushin project progress tab with a planned-versus-actual S-curve and cumulative variance.",
      title: "Project progress",
      caption: "S-curve",
    },
    import: {
      alt: "The Fushin workbook import dialog at the file selection step, before AI reads the layout.",
      title: "Workbook import",
      caption: ".xlsx import",
    },
    boq: {
      alt: "The Fushin BoQ tab showing work items with weights, quantities, unit rates, and amounts.",
      title: "Bill of Quantities",
      caption: "Baseline",
    },
  },
  liveDemo: {
    title: "Four steps per period.",
    body: "Every step is recorded: who, when, why.",
    steps: [
      { label: "Build the baseline", detail: "142 BoQ items" },
      { label: "Record actuals", detail: "Cumulative quantities" },
      { label: "Review variance", detail: "−15.0% vs plan" },
      { label: "Approve & lock", detail: "Recorded permanently" },
    ],
    running: "Running",
    complete: "Period locked",
    replay: "Run again",
    duration: "Done",
  },
  ai: {
    title: "Import your BoQ from Excel.",
    body: "AI reads your workbook layout, then drafts the baseline.",
    bullets: [
      ["Reads format, not figures", "AI only recognises the layout. Every number still comes from your workbook."],
      ["You approve first", "The column mapping is shown for review before any baseline is created."],
      ["Deterministic fallback", "If AI is unsure, rule-based parsing takes over."],
    ],
    note: ".xlsx up to 4 MB. The original file is not stored.",
  },
  attention: {
    title: "Start with what is off track.",
    body: "Schedule variance, reporting gaps, and open actions surface first.",
    bullets: [
      "Planned vs actual at the same data date.",
      "Open the right project and tab from any row.",
      "Contract value and measured work in one view.",
    ],
  },
  progress: {
    title: "Numbers you can trace.",
    body: "S-curves, variance, and delay contributors come from the active baseline.",
    stats: [
      ["45.0%", "Actual"],
      ["60.0%", "Planned"],
      ["−15.0%", "Deviation"],
    ],
  },
  baseline: {
    title: "One active baseline.",
    body: "Revisions run as drafts. Earlier versions stay available.",
  },
  demo: {
    title: "Book a demo.",
    body: "About 30 minutes. Free, no commitment.",
    unavailable: "Email us and we will reply to schedule it.",
    emailCta: "Email us",
    mailSubject: "Fushin demo request",
    mailNote: "We use your email only to reply to this request.",
    privacyLink: "Privacy policy",
    sequence: ["BoQ", "Schedule", "Progress", "Decision"],
    fields: {
      name: "Name",
      company: "Company",
      email: "Work email",
      role: "Role",
      size: "Active projects",
      challenge: "What would you like to fix?",
      challengePlaceholder: "For example: delays found too late.",
      submit: "Send request",
      submitting: "Sending…",
    },
    privacy: "By submitting this form, you agree to be contacted about a Fushin demo.",
  },
};

export const content: Record<Locale, Content> = { id, en };

export function localeHref(locale: Locale) {
  return locale === "id" ? "/" : "/en";
}
