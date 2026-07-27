import { redirect } from "next/navigation";

/** There is no public landing page — the dashboard is the product. */
export default function HomePage() {
  redirect("/dashboard");
}
