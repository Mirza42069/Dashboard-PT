import { redirect } from "next/navigation";

// Previously issued setup links no longer grant access. Administrators can
// recover pending accounts by issuing a temporary password.
export default function SetPasswordPage() {
  redirect("/login");
}
