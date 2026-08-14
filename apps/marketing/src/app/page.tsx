import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "V2 coming soon",
  description: "V2 coming soon.",
};

export default function HomePage() {
  return (
    <main className="grid min-h-svh place-items-center">
      <h1 className="text-2xl font-semibold">V2 coming soon</h1>
    </main>
  );
}
