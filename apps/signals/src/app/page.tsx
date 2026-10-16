import { redirect } from "next/navigation";
import { access } from "@/lib/access";
export default async function Home() {
  const ctx = await access();
  redirect(ctx.isAdmin ? "/clients" : "/today");
}
