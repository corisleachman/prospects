import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeNext,
  clientRole,
  validToken,
  emailAddress,
  escapeHtml,
} from "../src/lib/security";
test("redirects cannot leave the known app routes", () => {
  for (const value of [
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/auth/callback?next=https://evil.example",
    "/clients\r\nLocation: evil",
  ])
    assert.equal(safeNext(value), "/today");
  assert.equal(
    safeNext("/accept-invite?token=abc"),
    "/accept-invite?token=abc",
  );
});
test("role tampering and malformed invitation tokens fail closed", () => {
  for (const role of ["owner", "super_admin", "researcher", null])
    assert.throws(() => clientRole(role));
  assert.equal(clientRole("client_admin"), "client_admin");
  assert.equal(clientRole("client_user"), "client_user");
  assert.equal(validToken("a".repeat(64)), true);
  assert.equal(validToken("a".repeat(63)), false);
  assert.throws(() => emailAddress("a\n@b.com"));
  assert.equal(emailAddress(" Person@Example.com "), "person@example.com");
  assert.equal(escapeHtml('<a "b">'), "&lt;a &quot;b&quot;&gt;");
});
