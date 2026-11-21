import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;

export function verifyGithubSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  const match = SIGNATURE.exec(header?.trim() ?? "");
  const hex = match?.[1];
  if (!hex || secret.length === 0) return false;
  const actual = Buffer.from(hex, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
