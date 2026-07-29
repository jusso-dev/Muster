import { redirect } from "next/navigation";

/** In-app room search removed with chat UI (ADR 0006). */
export default function SearchPage() {
  redirect("/");
}
