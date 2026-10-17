"use server";
import { requireUser } from "@/lib/access";
import { revalidatePath } from "next/cache";
export async function cardAction(
  delivery: string,
  action: string,
  draft: string | null = null,
  reason: string | null = null,
  note: string | null = null,
) {
  const { db } = await requireUser();
  const { error } = await db.rpc("signals_card_action", {
    p_delivery: delivery,
    p_action: action,
    p_draft: draft,
    p_reason: reason,
    p_note: note,
  });
  if (error) return { error: error.message };
  revalidatePath("/today");
  revalidatePath("/history");
  return { error: null };
}
export async function rewriteCard(delivery: string, channel: string) {
  const { db } = await requireUser();
  const { data, error } = await db.functions.invoke("signals-pipeline", {
    body: { action: "rewrite", delivery, channel },
  });
  if (error || data?.error)
    return {
      error: "Couldn't rewrite, try again",
      attempted: data?.attempted ?? false,
    };
  revalidatePath("/today");
  return data;
}

export async function findCardPerson(delivery: string, approvedCap?: number) {
  const { db } = await requireUser();
  const { data, error } = await db.functions.invoke("signals-pipeline", {
    body: { action: "find_person", delivery, approved_cap: approvedCap },
  });
  if (error || data?.error)
    return { error: data?.error ?? "Couldn't find a person, try again" };
  revalidatePath("/today");
  return data;
}
