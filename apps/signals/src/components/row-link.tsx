"use client";
import { useRouter } from "next/navigation";
export function RowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className="clickable-row"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a,button,input,select"))
          router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
