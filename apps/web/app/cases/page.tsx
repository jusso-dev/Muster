import { redirect } from "next/navigation";

/** Chat/room redirects retired — case SoR is Kelpie; chat is Slack (ADR 0006). */
export default function CasesPage() {
  redirect("/");
}
