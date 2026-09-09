import type { Route } from "next";
import { redirect } from "next/navigation";

import { LOGIN_URL } from "@/lib/site";

export default function EnglishHomePage() {
  redirect(`${LOGIN_URL}?locale=en` as Route);
}
