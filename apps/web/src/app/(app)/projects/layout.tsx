import { requireVertical } from "@/lib/session";

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireVertical("construction");
  return children;
}
