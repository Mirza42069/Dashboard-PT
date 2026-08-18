import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fushin coming soon",
  description: "Fushin coming soon.",
  alternates: { canonical: "/en", languages: { id: "/", en: "/en" } },
  openGraph: { locale: "en_US", alternateLocale: "id_ID" },
};

export default function EnglishHomePage() {
  return (
    <main className="grid min-h-svh place-items-center">
      <h1 className="text-2xl font-semibold">Fushin coming soon</h1>
    </main>
  );
}
