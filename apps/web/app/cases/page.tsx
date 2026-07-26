import { redirect } from "next/navigation";

export default function CasesPage() {
  redirect(
    process.env.MUSTER_DEMO_MODE === "true"
      ? "/rooms/active-incidents"
      : "/rooms/soc-operations",
  );
}
