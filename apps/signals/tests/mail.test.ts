import { test } from "node:test";
import assert from "node:assert/strict";
import { sendInvitation } from "../src/lib/mail";
test("invitation transport uses the recipient, escapes HTML and supplies an idempotency key", async () => {
  process.env.RESEND_API_KEY = "fixture-key";
  process.env.RESEND_FROM = "Signals <signals@example.test>";
  const previous = global.fetch;
  let sent: Record<string, unknown> = {};
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    sent = options as unknown as Record<string, unknown>;
    return new Response('{"id":"fixture"}', { status: 200 });
  };
  try {
    await sendInvitation(
      "person@example.test",
      "Client <script>",
      "https://signals.example/accept-invite?token=fixture",
      "invitation",
    );
    const body = JSON.parse(String(sent.body));
    assert.deepEqual(body.to, ["person@example.test"]);
    assert.match(body.html, /Client &lt;script&gt;/);
    assert.ok(!body.html.includes("<script>"));
    assert.equal(
      (sent.headers as Record<string, string>)["Idempotency-Key"],
      "signals-invite-invitation",
    );
  } finally {
    global.fetch = previous;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  }
});
test("missing configuration and failed delivery never look like success", async () => {
  await assert.rejects(
    () =>
      sendInvitation(
        "person@example.test",
        "Client",
        "https://example.test",
        "id",
      ),
    /unavailable/,
  );
  process.env.RESEND_API_KEY = "fixture-key";
  process.env.RESEND_FROM = "signals@example.test";
  const previous = global.fetch;
  global.fetch = async () => new Response("{}", { status: 503 });
  try {
    await assert.rejects(
      () =>
        sendInvitation(
          "person@example.test",
          "Client",
          "https://example.test",
          "id",
        ),
      /failed/,
    );
  } finally {
    global.fetch = previous;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  }
});
