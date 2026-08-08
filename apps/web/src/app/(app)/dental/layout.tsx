import { requireVertical } from "@/lib/session";

export default async function DentalLayout({ children }: { children: React.ReactNode }) {
  await requireVertical("dental");
  return <div className="dental-product contents">{children}</div>;
}
