import type { Route } from "next";
import { redirect } from "next/navigation";

import { LOGIN_URL } from "@/lib/site";

export default function HomePage() {
  redirect(`${LOGIN_URL}?locale=id` as Route);
}
