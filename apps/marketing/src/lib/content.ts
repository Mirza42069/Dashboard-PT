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
    home: "Beranda Fushin AI",
    skipToContent: "Lewati ke konten",
  },
  hero: {
    titleStart: "Kendalikan progres konstruksi.",
    titleAccent: "Dari baseline sampai keputusan.",
    body: "Baseline BoQ, rencana vs realisasi, dan alur review progres dalam satu tempat.",
    login: "Masuk ke dasbor",
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
      alt: "Dasbor portofolio Fushin AI menampilkan nilai portofolio, pekerjaan terukur, dan daftar proyek yang perlu perhatian.",
      title: "Kontrol portofolio",
      caption: "Dasbor",
    },
    progress: {
      alt: "Tab progres proyek Fushin AI dengan kurva-S rencana versus realisasi, berjalan sampai tanggal data.",
      title: "Progres proyek",
      caption: "Kurva-S",
    },
    import: {
      alt: "Dialog impor workbook Fushin AI pada langkah pemilihan berkas .xlsx, sebelum AI membaca tata letaknya.",
      title: "Impor workbook",
      caption: "Impor .xlsx",
    },
    boq: {
      alt: "Tab BoQ Fushin AI menampilkan item pekerjaan, bobot, volume, harga satuan, dan jumlah.",
      title: "Bill of Quantities",
      caption: "Baseline",
    },
  },
  liveDemo: {
    title: "Empat langkah per periode.",
    body: "Setiap langkah tercatat: siapa, kapan, alasannya.",
    steps: [
      { label: "Bangun baseline", detail: "20 item BoQ" },
      { label: "Catat realisasi", detail: "Volume kumulatif" },
      { label: "Tinjau deviasi", detail: "−5,5% vs rencana" },
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
      ["Membaca format, bukan mengisi angka", "Semua angka tetap dari workbook Anda."],
      ["Anda menyetujui dulu", "Pemetaan kolom ditinjau sebelum baseline dibuat."],
      ["Ada cadangan deterministik", "Bila AI ragu, pembacaan berbasis aturan mengambil alih."],
    ],
    note: ".xlsx hingga 50 MB. AI membaca sampel sel; salinan sementara dihapus permanen setelah diproses.",
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
  portfolio: {
    label: "Contoh portofolio",
    title: "Sepuluh proyek, satu tampilan.",
    body: "Gedung, jalan tol, rumah sakit, gudang, dan jembatan berjalan berdampingan.",
    items: [
      [
        "Nilai kontrak",
        "Rp1,7 T berjalan",
        "Sepuluh proyek berbaseline, sembilan masih berjalan.",
      ],
      [
        "Periode",
        "Mingguan sampai bulanan",
        "Periode dibuat dari tanggal kontrak tiap proyek.",
      ],
      [
        "Deviasi",
        "−15,1% pada yang terburuk",
        "Yang paling tertinggal muncul lebih dulu.",
      ],
    ],
    note: "Portofolio contoh yang dipakai untuk tangkapan layar di halaman ini, bukan data pelanggan.",
  },
  progress: {
    title: "Angka yang bisa ditelusuri.",
    body: "Kurva-S, deviasi, dan penyumbang keterlambatan dihitung dari baseline aktif.",
    stats: [
      ["80,6%", "Realisasi"],
      ["86,1%", "Rencana"],
      ["−5,5%", "Deviasi"],
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
    mailSubject: "Permintaan demo Fushin AI",
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
    privacy: "Dengan mengirim form ini, Anda setuju dihubungi terkait demo Fushin AI.",
  },
  /**
   * Six objections, in the order they come up on a call. Answers are one line:
   * the section sits below the demo form, so it removes a doubt rather than
   * restating the pitch.
   */
  faq: {
    label: "Tanya jawab",
    title: "Pertanyaan yang sering masuk.",
    items: [
      [
        "Apakah AI mengubah angka BoQ kami?",
        "Tidak. AI hanya membaca tata letak workbook. Semua angka tetap dari file Anda.",
      ],
      [
        "Apakah data proyek kami terpisah dari perusahaan lain?",
        "Ya. Setiap perusahaan punya ruang sendiri. Hanya akun yang Anda undang bisa melihatnya.",
      ],
      [
        "Tim kami sudah terbiasa Excel. Harus ganti?",
        "Tidak. Tim tetap pakai Excel, Fushin AI yang membaca dan merapikannya.",
      ],
      [
        "Berapa lama sampai bisa dipakai?",
        "Impor satu workbook, baseline langsung jadi. Umumnya kurang dari satu hari.",
      ],
      [
        "Bisa untuk berapa proyek sekaligus?",
        "Tidak dibatasi. Satu dasbor menampung periode mingguan sampai bulanan.",
      ],
      [
        "Berapa biayanya?",
        "Menyesuaikan jumlah proyek aktif. Kami bahas angkanya saat demo.",
      ],
    ],
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
    home: "Fushin AI home",
    skipToContent: "Skip to content",
  },
  hero: {
    titleStart: "Control construction progress.",
    titleAccent: "Baseline to decision.",
    body: "BoQ baselines, planned vs actual, and progress review in one place.",
    login: "Log in to the dashboard",
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
      alt: "The Fushin AI portfolio dashboard showing portfolio value, measured work, and the list of projects needing attention.",
      title: "Portfolio control",
      caption: "Dashboard",
    },
    progress: {
      alt: "The Fushin AI project progress tab with a planned-versus-actual S-curve running to the data date.",
      title: "Project progress",
      caption: "S-curve",
    },
    import: {
      alt: "The Fushin AI workbook import dialog at the file selection step, before AI reads the layout.",
      title: "Workbook import",
      caption: ".xlsx import",
    },
    boq: {
      alt: "The Fushin AI BoQ tab showing work items with weights, quantities, unit rates, and amounts.",
      title: "Bill of Quantities",
      caption: "Baseline",
    },
  },
  liveDemo: {
    title: "Four steps per period.",
    body: "Every step is recorded: who, when, why.",
    steps: [
      { label: "Build the baseline", detail: "20 BoQ items" },
      { label: "Record actuals", detail: "Cumulative quantities" },
      { label: "Review variance", detail: "−5.5% vs plan" },
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
      ["Reads format, not figures", "Every number still comes from your workbook."],
      ["You approve first", "You review the column mapping before any baseline is created."],
      ["Deterministic fallback", "If AI is unsure, rule-based parsing takes over."],
    ],
    note: ".xlsx up to 50 MB. AI reads sample cells; the temporary copy is permanently deleted after processing.",
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
  portfolio: {
    label: "Sample portfolio",
    title: "Ten projects, one view.",
    body: "Buildings, a toll road, a hospital, a warehouse, and a bridge running side by side.",
    items: [
      [
        "Contract value",
        "Rp1.7 T running",
        "Ten baselined projects, nine still running.",
      ],
      [
        "Periods",
        "Weekly to monthly",
        "Periods come from each project's contract dates.",
      ],
      [
        "Deviation",
        "−15.1% at the worst",
        "The project furthest behind surfaces first.",
      ],
    ],
    note: "The sample portfolio these screenshots were taken from, not customer data.",
  },
  progress: {
    title: "Numbers you can trace.",
    body: "S-curves, variance, and delay contributors come from the active baseline.",
    stats: [
      ["80.6%", "Actual"],
      ["86.1%", "Planned"],
      ["−5.5%", "Deviation"],
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
    mailSubject: "Fushin AI demo request",
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
    privacy: "By submitting this form, you agree to be contacted about a Fushin AI demo.",
  },
  faq: {
    label: "Questions",
    title: "What people ask first.",
    items: [
      [
        "Does AI change our BoQ figures?",
        "No. AI only reads the workbook layout. Every number stays as it is in your file.",
      ],
      [
        "Is our project data separate from other companies?",
        "Yes. Each company has its own space. Only the accounts you invite can see it.",
      ],
      [
        "Our team knows Excel. Do we have to switch?",
        "No. The team keeps using Excel, Fushin AI reads it and tidies it up.",
      ],
      [
        "How long until we can use it?",
        "Import one workbook and the baseline is ready. Usually under a day.",
      ],
      [
        "How many projects can it handle?",
        "No limit. One dashboard holds weekly through monthly periods.",
      ],
      [
        "What does it cost?",
        "It follows your active project count. We go through the numbers in the demo.",
      ],
    ],
  },
};

export const content: Record<Locale, Content> = { id, en };

export function localeHref(locale: Locale) {
  return locale === "id" ? "/" : "/en";
}
