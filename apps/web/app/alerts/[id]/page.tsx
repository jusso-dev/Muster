import { redirect } from "next/navigation";

export default function AlertPage() {
  redirect(
    process.env.MUSTER_DEMO_MODE === "true"
      ? "/rooms/alerts"
      : "/rooms/soc-operations",
  );
}
