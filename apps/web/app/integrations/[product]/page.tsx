import { IntegrationView } from "@/components/integration-view";
import { redirect } from "next/navigation";

export default async function IntegrationPage({ params }: { params: Promise<{ product: string }> }) {
  if (process.env.MUSTER_DEMO_MODE !== "true") redirect("/settings");
  const { product } = await params;
  return <IntegrationView product={["bower","tawny","kelpie"].includes(product) ? product as "bower" | "tawny" | "kelpie" : "sentinel"} />;
}
