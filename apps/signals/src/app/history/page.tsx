import Link from "next/link";
import { cardContext } from "@/lib/cards";
import { Frame } from "@/components/frame";
import { History } from "./table";
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; viewAs?: string; show?: string }>;
}) {
  const q = await searchParams,
    ctx = await cardContext(q, true),
    base = "workspace=" + ctx.workspace.id + (ctx.viewing ? "&viewAs=1" : "");
  return (
    <Frame
      email={ctx.user.email ?? ""}
      workspace={ctx.workspace.name}
      clientViewQuery={base}
    >
      {ctx.viewing && (
        <p className="viewing-bar">
          Viewing as {ctx.workspace.name}.{" "}
          <Link href={"/clients/" + ctx.workspace.id}>Exit</Link>
        </p>
      )}
      <h1>Sent and history</h1>
      <History
        data={ctx.data}
        query={base + (ctx.data.can_export ? "&show=everyone" : "")}
      />
    </Frame>
  );
}
