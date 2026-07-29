import { redirect } from "next/navigation";

/** Chat/room redirects retired — ops home is the control plane (ADR 0006). */
export default function AlertPage() {
  redirect("/");
}
