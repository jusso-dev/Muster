import { IntegrationView } from "@/components/integration-view";
export default async function IntegrationPage({ params }: { params: Promise<{ product: string }> }) { const { product } = await params; return <IntegrationView product={["bower","tawny","kelpie"].includes(product) ? product as "bower" | "tawny" | "kelpie" : "sentinel"} />; }
