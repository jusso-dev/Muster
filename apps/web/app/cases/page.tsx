import { redirect } from "next/navigation";

export default function CasesPage() {
  redirect("/rooms/active-incidents");
}
