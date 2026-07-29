import { redirect } from "next/navigation";

/** Chat UI removed from product surface — see ADR 0006. */
export default function RoomPage() {
  redirect("/");
}
