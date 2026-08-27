import type { MessageDictionary } from "./en";

/**
 * Bahasa Indonesia. `satisfies MessageDictionary` makes any missing or extra key
 * a compile error, so the two locales cannot drift apart silently.
 *
 * Vocabulary follows `apps/web/src/i18n/id.ts` — the same product, so the same
 * words: draf, progres, berkas, buku kerja, kurva S, tindakan, and the
 * construction terms Indonesian site engineers use untranslated (baseline, BoQ,
 * bobot, volume, item).
 *
 * Indonesian does not inflect nouns for number, so every `one`/`other` pair here
 * holds the same string. That is the point of carrying both: the shape is the
 * contract, and en.ts genuinely needs two forms — writing "item(s)" instead is
 * not a plural rule, it is a way of not choosing one.
 */
export const id = {
  auth: {
    required: "Perlu masuk terlebih dahulu",
    insufficientRole: "Peran Anda tidak mencukupi",
    trialEnded: "Masa uji coba ini telah berakhir",
    passwordChangeRequired: "Atur kata sandi baru sebelum melanjutkan.",
    noCompanyAssigned:
      "Akun ini belum terhubung ke perusahaan mana pun. Minta administrator untuk mengaturnya.",
    noCompaniesYet: "Belum ada perusahaan. Buat satu di Admin → Perusahaan.",
    companyAccountRequired: "Perlu akun yang terhubung ke sebuah perusahaan",
    superAdminNotPinned: "Akun System tidak terikat pada satu perusahaan",
    unsupportedRole: "Peran akun tidak dikenali",
    noPermission: "Anda tidak memiliki izin untuk melakukan perubahan itu.",
  },
  archived: {
    project: "Proyek ini diarsipkan. Pulihkan terlebih dahulu untuk mengubahnya.",
    note: "Catatan ini diarsipkan. Pulihkan terlebih dahulu untuk mengubahnya.",
  },
  project: {
    notFound: "Proyek tidak ditemukan",
    noneFound: "Tidak ada proyek yang ditemukan",
    codeInUse: "Kode proyek {code} sudah dipakai",
    endBeforeStart: "Tanggal selesai lebih awal dari tanggal mulai",
    cannotAssignManager: "Anda tidak dapat menugaskan manajer proyek ini",
    cadenceFromTiming: "Atur siklus pelaporan khusus dari pengaturan waktu baseline jadwal.",
    changedRefresh: "Proyek ini berubah. Muat ulang lalu coba lagi.",
    deleteHasTickets: {
      one: "Proyek ini memiliki {count} tindakan yang akan ikut terhapus. Konfirmasi untuk melanjutkan.",
      other:
        "Proyek ini memiliki {count} tindakan yang akan ikut terhapus. Konfirmasi untuk melanjutkan.",
    },
    bulkDeleteHasTickets: {
      one: "Proyek yang dipilih memiliki {count} tindakan yang akan ikut terhapus. Konfirmasi untuk melanjutkan.",
      other:
        "Proyek yang dipilih memiliki {count} tindakan yang akan ikut terhapus. Konfirmasi untuk melanjutkan.",
    },
  },
  company: {
    notFound: "Perusahaan tidak ditemukan",
    codeInUse: "Kode perusahaan {code} sudah dipakai",
    cannotDeleteLast: "Perusahaan terakhir yang tersisa tidak dapat dihapus",
    pickOne: "Pilih perusahaan untuk akun ini",
  },
  user: {
    notFound: "Pengguna tidak ditemukan",
    someNotFound: "Satu atau beberapa pengguna tidak ditemukan",
    emailExists: "Sudah ada akun dengan email tersebut",
    nameExists: "Sudah ada akun dengan nama tersebut",
    nameInvalid: "Masukkan nama hingga 120 karakter Latin dasar tanpa @",
    onlySuperAdminCreatesAdmins:
      "Hanya akun System yang dapat membuat akun admin atau System",
    ownCompanyOnly: "Anda hanya dapat membuat pengguna di perusahaan Anda sendiri",
    couldNotAssignCompany:
      "Perusahaan tidak dapat ditetapkan — akun tidak jadi dibuat. Silakan coba lagi.",
    accountEmailNotConfigured: "Pengiriman email akun sedang dinonaktifkan.",
    currentPasswordRequired: "Kata sandi saat ini wajib diisi",
    passwordTooShort: "Kata sandi minimal 12 karakter",
    passwordMustDiffer: "Pilih kata sandi yang berbeda dari yang sekarang",
    systemPasswordResetNotAllowed:
      "Kata sandi akun System tidak dapat diatur ulang dari akun lain. Gunakan prosedur pemulihan operator.",
    systemNoTrial: "Akun System tidak dapat diberi uji coba",
    notLastSuperAdmin: "Akun System terakhir yang tersisa tidak dapat {action}.",
    notOwnAccount: "Akun Anda sendiri tidak dapat {action}.",
  },
  boq: {
    versionNotFound: "Versi BoQ tidak ditemukan",
    itemNotFound: "Item BoQ tidak ditemukan",
    lineNotFound: "Baris BoQ tidak ditemukan",
    unknownLine: "Baris BoQ tidak dikenali",
    parentSectionNotFound: "Bagian induk tidak ditemukan",
    couldNotCreate: "BoQ tidak dapat dibuat",
    baselinedLocked: "BoQ ini sudah menjadi baseline. Volume tidak dapat diubah lagi.",
    baselinedWhileEditing:
      "BoQ ini dijadikan baseline saat sedang diubah. Muat ulang lalu coba lagi.",
    notEditableDraft: "Baseline ini bukan draf yang dapat diubah.",
    noSchedulableLines: "BoQ ini tidak memiliki baris yang dapat dijadwalkan.",
    codeUsedAtLevel: "Kode {code} sudah dipakai pada tingkat ini",
    weightsMustTotal:
      "Total bobot harus 100% sebelum dijadikan baseline — saat ini totalnya {total}%. Tambahkan item berharga satuan, atau periksa baris yang bobotnya diisi manual.",
    scheduleRowsIncomplete: {
      one: "{count} baris jadwal harus berjumlah 100% sebelum diaktifkan.",
      other: "{count} baris jadwal harus berjumlah 100% sebelum diaktifkan.",
    },
    changedWhileActivating:
      "Baseline berubah saat sedang diaktifkan. Tinjau kembali lalu coba lagi.",
  },
  schedule: {
    activeLocked: "Jadwal ini aktif dan terkunci.",
    activatedWhileEditing: "Jadwal ini diaktifkan saat sedang diubah. Muat ulang lalu coba lagi.",
    onlyPricedLines:
      "Hanya baris BoQ berharga satuan yang dapat dijadwalkan — bagian mengikuti jumlah barisnya.",
    unknownPeriod: "Periode pelaporan tidak dikenali",
    baselineNotThisProject: "Baseline tersebut bukan milik proyek ini.",
    endBeforeStart: "Tanggal selesai lebih awal dari tanggal mulai.",
    reportingBeforeProject: "Pelaporan tidak boleh dimulai sebelum proyeknya.",
    timingFixed: "Pengaturan waktu baseline terkunci setelah baseline pertama diaktifkan.",
    customCadenceRange: "Siklus khusus memerlukan {min} sampai {max} hari.",
    needsProjectDates: "Isi tanggal mulai dan target selesai proyek terlebih dahulu.",
    generatePeriodsFirst: "Buat periode pelaporan terlebih dahulu.",
    noPeriodsInDates: "Tidak ada periode yang jatuh dalam rentang tanggal tersebut.",
    progressBlocksRebuild:
      "Progres sudah tercatat, sehingga periode pelaporan tidak dapat disusun ulang.",
    historyBlocksRebuild:
      "Catatan riwayat sudah memakai periode ini, sehingga tidak dapat disusun ulang.",
    actionsBlockRebuild:
      "Tindakan sudah memakai periode ini, sehingga tidak dapat disusun ulang.",
    activeScheduleBlocksRebuild:
      "Jadwal aktif memakai periode ini, sehingga tidak dapat disusun ulang.",
    becameInUse: "Periode pelaporan mulai dipakai, sehingga tidak dapat disusun ulang lagi.",
    windowNeedsBothEnds: "Rentang rencana memerlukan periode mulai dan periode selesai.",
    finishBeforeStart: "Periode selesai tidak boleh mendahului periode mulai.",
    periodsRunFrom: "Periode berjalan dari {first} sampai {last}.",
    chooseLineToCopy: "Pilih setidaknya satu baris sebagai tujuan salinan rencana.",
    tooManyCellsSpread: {
      one: "Itu akan menulis {count} sel rencana sekaligus. Terapkan rencana pada lebih sedikit baris.",
      other:
        "Itu akan menulis {count} sel rencana sekaligus. Terapkan rencana pada lebih sedikit baris.",
    },
    tooManyCellsCopy: {
      one: "Itu akan menulis {count} sel rencana sekaligus. Salin ke lebih sedikit baris.",
      other: "Itu akan menulis {count} sel rencana sekaligus. Salin ke lebih sedikit baris.",
    },
  },
  progress: {
    periodNotFound: "Periode pelaporan tidak ditemukan",
    needsBaseline: "Jadikan BoQ baseline sebelum mencatat progres.",
    needsSchedule: "Aktifkan jadwal sebelum mencatat progres.",
    onlyPricedLines:
      "Progres hanya dapat dicatat pada baris berharga satuan dari baseline yang aktif.",
    reportNotEditable: "Laporan ini berstatus {status} dan tidak dapat diubah lagi.",
    periodNotEditable: "Periode ini tidak dapat diubah lagi. Muat ulang lalu coba lagi.",
    periodChangedRefresh: "Periode ini berubah saat Anda membukanya. Muat ulang lalu coba lagi.",
    invalidTransition: "Laporan berstatus {from} tidak dapat diubah menjadi {to}.",
    missingLines: {
      one: "{count} baris belum memiliki angka maupun tanda “tanpa progres”.",
      other: "{count} baris belum memiliki angka maupun tanda “tanpa progres”.",
    },
  },
  ticket: {
    notFound: "Tindakan tidak ditemukan",
    noneFound: "Tidak ada tindakan yang ditemukan",
    someNotFound: "Satu atau beberapa tindakan tidak ditemukan",
    lineNotThisProject: "Item BoQ tersebut bukan bagian dari proyek ini.",
    periodNotThisProject: "Periode pelaporan tersebut bukan bagian dari proyek ini.",
    closeWithResolution:
      "Tutup tindakan ini beserta penyelesaiannya, bukan dengan mengubah statusnya langsung.",
    alreadyClosed: "Tindakan ini sudah ditutup.",
    changedRefresh: "Tindakan ini berubah saat Anda membukanya. Muat ulang lalu coba lagi.",
    someChangedRefresh:
      "Satu atau beberapa tindakan berubah saat Anda membukanya. Muat ulang lalu coba lagi.",
  },
  note: {
    notFound: "Catatan tidak ditemukan",
    photoNotFound: "Foto tidak ditemukan",
    couldNotCreate: "Catatan tidak dapat dibuat",
  },
  support: {
    notFound: "Permintaan dukungan tidak ditemukan",
    changedRefresh: "Permintaan dukungan berubah; muat ulang lalu coba lagi",
    systemCannotSubmit: "Akun System tidak dapat mengirim permintaan dukungan",
    closeBeforeDelete: "Tutup permintaan dukungan ini sebelum menghapusnya",
    conversationClosed: "Percakapan ini sudah ditutup",
    invalidTransition: "Permintaan dukungan berstatus {status} tidak dapat {action}.",
  },
  upload: {
    photoTooLarge: "Ukuran foto melebihi batas unggah 4 MB",
    workbookTooLarge: "Ukuran buku kerja melebihi batas unggah 4 MB",
    empty: "Berkas yang diunggah kosong",
    noWorkbook: "Tidak ada buku kerja yang dilampirkan.",
    notConfigured: "Unggahan buku kerja sementara belum dikonfigurasi.",
    invalidRequest: "Permintaan unggah tidak valid.",
    rateLimited: "Terlalu banyak {operation} buku kerja. Coba lagi dalam beberapa menit.",
    aiAllowanceUsedUp: "Kuota impor AI untuk uji coba ini sudah habis.",
    chooseWorksheet: "Pilih lembar kerja yang akan dianalisis.",
    planUnreadable: "Rencana impor yang dikonfirmasi tidak dapat dibaca.",
    mappingUnreadable: "Pemetaan kolom tidak dapat dibaca.",
    notXlsx: "Berkas itu tidak dapat dibaca sebagai buku kerja .xlsx.",
    importFailed: "Buku kerja tidak dapat diimpor.",
    unsupportedImageType: "Jenis gambar tidak didukung: {type}",
    unknownImageType: "tidak diketahui",
    projectCodeInUse: "Kode proyek itu sudah dipakai.",
  },
  enums: {
    // Copied verbatim from apps/web/src/i18n/id.ts `status.period`, so a toast
    // and the table beside it call a period the same thing.
    periodStatus: {
      open: "Belum dimulai",
      draft: "Sedang diisi",
      submitted: "Diajukan",
      reviewed: "Ditinjau",
      approved: "Disetujui",
      locked: "Terkunci",
      returned: "Dikembalikan",
    },
    // Likewise from `support.status`.
    supportStatus: {
      new: "Baru",
      accepted: "Diterima",
      answered: "Dijawab",
      closed: "Ditutup",
    },
    supportAction: {
      accept: "diterima",
      reply: "dibalas",
      userReply: "dibalas",
      close: "ditutup",
    },
    adminAction: {
      demote: "diturunkan",
      disable: "dinonaktifkan",
      delete: "dihapus",
      trial: "diberi uji coba",
      resetPassword: "diatur ulang kata sandinya",
    },
    workbookOperation: {
      uploads: "pengunggahan",
      analyses: "analisis",
      updates: "pembaruan",
      reviews: "peninjauan",
      imports: "impor",
    },
  },
} as const satisfies MessageDictionary;
