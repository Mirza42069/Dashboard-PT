export type Locale = "id" | "en";

const id = {
  locale: "id" as const,
  languageName: "Bahasa Indonesia",
  alternateLocale: "en" as const,
  alternateLabel: "EN",
  nav: {
    product: "Produk",
    workflow: "Alur kerja",
    security: "Akses data",
    faq: "FAQ",
    signIn: "Masuk",
    demo: "Jadwalkan demo",
    menu: "Buka navigasi",
  },
  hero: {
    eyebrow: "Kontrol progres konstruksi",
    titleStart: "Ketahui proyek mana yang perlu perhatian",
    titleAccent: "sebelum keterlambatan membesar.",
    body:
      "Fushin menyatukan baseline BoQ, progres rencana versus realisasi, pelaporan lapangan, dan tindakan proyek dalam satu ruang kontrol.",
    primary: "Jadwalkan demo",
    secondary: "Lihat cara kerjanya",
    note: "Demo 30 menit. Tanpa komitmen.",
  },
  proof: [
    "Impor BoQ dari spreadsheet",
    "Bahasa Indonesia & English",
    "Periode mingguan hingga bulanan",
    "Review dan persetujuan berbasis peran",
  ],
  attention: {
    eyebrow: "Mulai dari pengecualian",
    title: "Lihat yang perlu ditindak, bukan sekadar yang baru terjadi.",
    body:
      "Ringkasan portofolio mengarahkan perhatian ke deviasi jadwal, pelaporan yang tersendat, review yang menunggu keputusan, dan tindakan yang masih terbuka.",
    bullets: [
      "Bandingkan progres aktual dengan rencana pada tanggal data yang sama.",
      "Buka proyek dan tab yang tepat langsung dari setiap pengecualian.",
      "Pantau nilai kontrak dan pekerjaan terukur dalam satu konteks.",
    ],
  },
  workflow: {
    eyebrow: "Baseline → Laporan → Keputusan",
    title: "Satu alur yang menghubungkan rencana dengan catatan lapangan.",
    body:
      "Setiap angka progres dapat ditelusuri kembali ke pekerjaan, periode, dan keputusan yang membentuknya.",
    steps: [
      {
        number: "01",
        title: "Bangun baseline",
        body: "Impor atau susun BoQ, tetapkan bobot, lalu distribusikan pekerjaan ke periode pelaporan.",
      },
      {
        number: "02",
        title: "Catat realisasi",
        body: "Masukkan progres kumulatif berdasarkan volume atau persentase untuk setiap item pekerjaan.",
      },
      {
        number: "03",
        title: "Tinjau dan kunci",
        body: "Ajukan, tinjau, setujui, kembalikan, atau kunci periode dengan aktor dan alasan yang tercatat.",
      },
    ],
  },
  progress: {
    eyebrow: "Progres yang dapat dijelaskan",
    title: "Bukan hanya angka persentase. Tahu bagaimana angka itu terbentuk.",
    body:
      "Kurva-S, deviasi kumulatif, tanggal data, dan penyumbang keterlambatan dihitung dari baseline aktif—bukan angka status yang berdiri sendiri.",
    stats: [
      ["45.0%", "Realisasi"],
      ["60.0%", "Rencana"],
      ["−15.0%", "Deviasi"],
    ],
  },
  field: {
    eyebrow: "Dari lapangan ke portofolio",
    title: "Catatan harian tetap dekat dengan keputusan proyek.",
    body:
      "Kelola laporan harian, tindakan, dan catatan berfoto di proyek yang sama dengan baseline dan progres.",
    cards: [
      {
        title: "Laporan harian",
        body: "Cuaca, pekerjaan, kendala, keselamatan, tenaga kerja, alat, dan pengiriman dalam satu catatan harian.",
      },
      {
        title: "Tindakan proyek",
        body: "Catat isu, RFI, punch item, keselamatan, mutu, dan keterlambatan lengkap dengan prioritas dan tenggat.",
      },
      {
        title: "Catatan & foto",
        body: "Simpan catatan proyek yang memiliki waktu, penulis, dan bukti foto dengan akses privat.",
      },
    ],
  },
  access: {
    eyebrow: "Kontrol dan akuntabilitas",
    title: "Akses dibatasi. Keputusan tetap dapat ditelusuri.",
    body:
      "Fushin menerapkan batas perusahaan dan proyek di server, memisahkan hak input dari hak review, serta menyimpan riwayat perubahan penting.",
    items: [
      ["Ruang data perusahaan", "Akun biasa hanya mengakses data perusahaan dan proyek yang ditugaskan kepadanya."],
      ["Pemisahan tanggung jawab", "Hak mencatat progres tidak otomatis memberi hak review, persetujuan, atau penguncian."],
      ["Baseline terkendali", "Satu baseline aktif menjadi acuan progres, sementara revisi disiapkan sebagai draft terpisah."],
      ["Koreksi tercatat", "Periode yang dibuka kembali membutuhkan alasan dan tetap meninggalkan riwayat aktor serta waktu."],
    ],
  },
  roles: {
    eyebrow: "Satu sumber, beberapa sudut pandang",
    title: "Dibangun untuk tim yang mengendalikan pekerjaan konstruksi.",
    items: [
      ["Pimpinan konstruksi", "Mulai dari proyek yang paling perlu perhatian dan telusuri ke catatan pendukungnya."],
      ["Project control & QS", "Hubungkan nilai, bobot, jadwal, progres aktual, dan deviasi dalam satu baseline."],
      ["Tim proyek & lapangan", "Catat progres, laporan harian, tindakan, dan kondisi proyek tanpa memisahkan konteks."],
      ["Reviewer & administrator", "Kelola akses, keputusan review, persetujuan, dan koreksi dengan tanggung jawab yang jelas."],
    ],
  },
  faq: {
    eyebrow: "Pertanyaan umum",
    title: "Hal yang biasanya ditanyakan sebelum demo.",
    items: [
      ["Apakah BoQ yang sudah ada dapat diimpor?", "Ya. Fushin menerima workbook .xlsx, menyediakan pemetaan kolom dan pratinjau, lalu membuat draft untuk ditinjau sebelum diaktifkan."],
      ["Bagaimana progres dihitung?", "Progres aktual dan rencana dihitung dari item serta bobot pada baseline aktif, kemudian dibandingkan pada tanggal data yang sama."],
      ["Apakah pencatat progres dapat menyetujuinya sendiri?", "Hak input, review, persetujuan, dan penguncian dipisahkan berdasarkan peran. Pengaturan akses menentukan siapa yang dapat melakukan setiap langkah."],
      ["Periode pelaporan apa yang didukung?", "Proyek dapat menggunakan periode mingguan, dua mingguan, atau bulanan."],
      ["Apakah tersedia dalam Bahasa Indonesia?", "Ya. Seluruh antarmuka tersedia dalam Bahasa Indonesia dan English, dengan format tanggal dan nilai yang sesuai."],
      ["Apa yang terjadi ketika baseline direvisi?", "Baseline aktif tetap menjadi acuan sampai draft revisi selesai ditinjau dan diaktifkan. Riwayat versi sebelumnya tetap tersimpan."],
    ],
  },
  demo: {
    eyebrow: "Jadwalkan demo",
    title: "Bawa satu alur proyek yang paling sulit dikendalikan.",
    body:
      "Kami akan memetakan bagaimana BoQ, jadwal, progres, dan review Anda dapat berjalan di Fushin. Gratis, tanpa komitmen, sekitar 30 menit.",
    unavailable: "Form demo belum dikonfigurasi. Hubungi tim Fushin setelah alamat email penjualan tersedia.",
    fields: {
      name: "Nama",
      company: "Perusahaan",
      email: "Email kerja",
      role: "Peran",
      size: "Jumlah proyek aktif",
      challenge: "Apa yang paling ingin Anda rapikan?",
      challengePlaceholder: "Contoh: progres terlambat diketahui, review laporan lambat, atau data proyek tersebar.",
      submit: "Kirim permintaan demo",
      submitting: "Mengirim…",
    },
    privacy: "Dengan mengirim form ini, Anda setuju dihubungi terkait demo Fushin.",
  },
  footer: {
    tagline: "Kontrol progres konstruksi dari baseline hingga keputusan.",
    product: "Produk",
    legal: "Legal",
    privacy: "Privasi",
    terms: "Ketentuan",
    rights: "Hak cipta dilindungi.",
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
    product: "Product",
    workflow: "Workflow",
    security: "Data access",
    faq: "FAQ",
    signIn: "Sign in",
    demo: "Book a demo",
    menu: "Open navigation",
  },
  hero: {
    eyebrow: "Construction progress control",
    titleStart: "Know which projects need attention",
    titleAccent: "before delays get bigger.",
    body:
      "Fushin brings BoQ baselines, planned-versus-actual progress, field reporting, and project actions into one control room.",
    primary: "Book a demo",
    secondary: "See how it works",
    note: "30-minute demo. No commitment.",
  },
  proof: [
    "Import BoQ spreadsheets",
    "English & Bahasa Indonesia",
    "Weekly to monthly periods",
    "Role-based review and approval",
  ],
  attention: {
    eyebrow: "Start with exceptions",
    title: "See what needs action, not just what happened recently.",
    body:
      "The portfolio view directs attention to schedule variance, reporting gaps, reviews waiting for a decision, and actions still open.",
    bullets: [
      "Compare actual and planned progress at the same data date.",
      "Open the right project and tab directly from each exception.",
      "Keep contract value and measured work in the same context.",
    ],
  },
  workflow: {
    eyebrow: "Baseline → Report → Decide",
    title: "One workflow connects the plan to the field record.",
    body:
      "Every progress figure can be traced back to the work, reporting period, and decisions that shaped it.",
    steps: [
      {
        number: "01",
        title: "Build the baseline",
        body: "Import or create the BoQ, set the weights, then distribute work across reporting periods.",
      },
      {
        number: "02",
        title: "Record actuals",
        body: "Enter cumulative progress by quantity or percentage for every line of work.",
      },
      {
        number: "03",
        title: "Review and lock",
        body: "Submit, review, approve, return, or lock periods with actors and reasons recorded.",
      },
    ],
  },
  progress: {
    eyebrow: "Progress you can explain",
    title: "Not just a percentage. Know how the number was formed.",
    body:
      "S-curves, cumulative variance, data dates, and delay contributors are calculated from the active baseline—not a standalone status number.",
    stats: [
      ["45.0%", "Actual"],
      ["60.0%", "Planned"],
      ["−15.0%", "Deviation"],
    ],
  },
  field: {
    eyebrow: "From field to portfolio",
    title: "Daily records stay close to project decisions.",
    body:
      "Manage daily reports, project actions, and photo notes alongside the baseline and progress record.",
    cards: [
      {
        title: "Daily reports",
        body: "Weather, work, constraints, safety, labour, equipment, and deliveries in one daily record.",
      },
      {
        title: "Project actions",
        body: "Track issues, RFIs, punch items, safety, quality, and delays with priorities and due dates.",
      },
      {
        title: "Notes & photos",
        body: "Keep timestamped project notes with authorship and private photo evidence.",
      },
    ],
  },
  access: {
    eyebrow: "Control and accountability",
    title: "Access stays scoped. Decisions remain traceable.",
    body:
      "Fushin enforces company and project boundaries on the server, separates entry from review, and retains the history of important changes.",
    items: [
      ["Company data boundary", "Standard accounts only reach their company and the projects assigned to them."],
      ["Separation of duties", "The right to enter progress does not automatically grant review, approval, or locking rights."],
      ["Controlled baselines", "One active baseline measures progress while revisions are prepared separately as drafts."],
      ["Recorded corrections", "Reopening a period requires a reason and retains the actor and timestamp history."],
    ],
  },
  roles: {
    eyebrow: "One source, several viewpoints",
    title: "Built for the teams controlling construction work.",
    items: [
      ["Construction leadership", "Start with the projects needing attention and drill into their supporting records."],
      ["Project controls & QS", "Connect value, weights, schedule, actual progress, and variance in one baseline."],
      ["Project & site teams", "Record progress, daily reports, actions, and site conditions without losing context."],
      ["Reviewers & administrators", "Manage access, review decisions, approvals, and corrections with clear accountability."],
    ],
  },
  faq: {
    eyebrow: "Frequently asked",
    title: "What teams usually ask before a demo.",
    items: [
      ["Can we import an existing BoQ?", "Yes. Fushin accepts .xlsx workbooks, provides column mapping and preview, then creates a draft for review before activation."],
      ["How is progress calculated?", "Planned and actual progress use the items and weights in the active baseline and are compared at the same data date."],
      ["Can the person entering progress approve it?", "Entry, review, approval, and locking rights are separated by role. Access settings determine who can perform each step."],
      ["Which reporting periods are supported?", "Projects can use weekly, biweekly, or monthly reporting periods."],
      ["Is Bahasa Indonesia available?", "Yes. The full interface is available in English and Bahasa Indonesia with locale-aware dates and values."],
      ["What happens when a baseline is revised?", "The active baseline remains the measure until the draft revision is reviewed and activated. Earlier version history remains available."],
    ],
  },
  demo: {
    eyebrow: "Book a demo",
    title: "Bring the project workflow that is hardest to control.",
    body:
      "We will map how your BoQ, schedule, progress, and review process could run in Fushin. Free, non-binding, about 30 minutes.",
    unavailable: "Demo delivery is not configured yet. Contact the Fushin team once a sales address is available.",
    fields: {
      name: "Name",
      company: "Company",
      email: "Work email",
      role: "Role",
      size: "Active project count",
      challenge: "What would you most like to improve?",
      challengePlaceholder: "For example: delays discovered late, slow report reviews, or project data spread across files.",
      submit: "Send demo request",
      submitting: "Sending…",
    },
    privacy: "By submitting this form, you agree to be contacted about a Fushin demo.",
  },
  footer: {
    tagline: "Construction progress control from baseline to decision.",
    product: "Product",
    legal: "Legal",
    privacy: "Privacy",
    terms: "Terms",
    rights: "All rights reserved.",
  },
};

export const content: Record<Locale, Content> = { id, en };

export function localeHref(locale: Locale) {
  return locale === "id" ? "/" : "/en";
}
