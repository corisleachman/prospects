import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/security";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const db = await sessionClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(
          safeNext(request.nextUrl.searchParams.get("next")),
          process.env.APP_ORIGIN!,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=link", process.env.APP_ORIGIN!),
  );
}
