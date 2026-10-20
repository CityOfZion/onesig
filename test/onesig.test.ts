import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertDeterministic,
  buildMessage,
  deriveFromSignature,
  deriveSessionWallet,
  NonDeterministicWalletError,
  type Hex,
} from "../src/index.js";

// two well-known test keys (Hardhat #0 / #1) — never use these for real funds
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const owner2 = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

// an RFC-6979 (deterministic) signer — viem accounts sign deterministically
const signer = (message: string) => owner.signMessage({ message });

test("buildMessage: canonical, versioned, app-namespaced", () => {
  const m = buildMessage({ app: "Infinity", owner: owner.address, version: 1 });
  assert.ok(m.startsWith(`Infinity session wallet v1 · ${owner.address.toLowerCase()}`));
  assert.ok(m.includes("Only ever sign this on Infinity"));
});

test("buildMessage: index shows only when > 0", () => {
  const head0 = buildMessage({ app: "A", owner: owner.address }).split("\n")[0]!;
  const head2 = buildMessage({ app: "A", owner: owner.address, index: 2 }).split("\n")[0]!;
  assert.ok(!head0.includes("#"));
  assert.ok(head2.endsWith("#2"));
});

test("deriveSessionWallet: deterministic — re-derive yields the same wallet", async () => {
  const a = await deriveSessionWallet({ app: "Infinity", owner: owner.address, signMessage: signer });
  const b = await deriveSessionWallet({ app: "Infinity", owner: owner.address, signMessage: signer });
  assert.equal(a.address, b.address);
  assert.equal(a.privateKey, b.privateKey);
  assert.equal(a.account.address, a.address);
});

test("isolation: app, index, and owner each change the wallet", async () => {
  const base = await deriveSessionWallet({ app: "A", owner: owner.address, signMessage: signer });
  const byApp = await deriveSessionWallet({ app: "B", owner: owner.address, signMessage: signer });
  const byIndex = await deriveSessionWallet({ app: "A", owner: owner.address, index: 1, signMessage: signer });
  const byOwner = await deriveSessionWallet({
    app: "A",
    owner: owner2.address,
    signMessage: (m) => owner2.signMessage({ message: m }),
  });
  assert.notEqual(base.address, byApp.address);
  assert.notEqual(base.address, byIndex.address);
  assert.notEqual(base.address, byOwner.address);
});

test("deriveFromSignature: pure path matches the signer path", async () => {
  const params = { app: "Infinity", owner: owner.address };
  const sig = await owner.signMessage({ message: buildMessage(params) });
  const fromSig = deriveFromSignature(sig, params);
  const fromSigner = await deriveSessionWallet({ ...params, signMessage: signer });
  assert.equal(fromSig.address, fromSigner.address);
});

test("deriveFromSignature: rejects a non-hex signature", () => {
  assert.throws(() => deriveFromSignature("0xZZ" as Hex, { app: "A", owner: owner.address }));
});

test("assertDeterministic: passes for an RFC-6979 signer", async () => {
  const w = await assertDeterministic({ app: "A", owner: owner.address, signMessage: signer });
  assert.ok(w.address.startsWith("0x"));
});

test("assertDeterministic: throws for a non-deterministic (smart-wallet-like) signer", async () => {
  let n = 0;
  const flaky = async (_m: string): Promise<Hex> => `0x${String(++n).padStart(130, "0")}` as Hex;
  await assert.rejects(
    () => assertDeterministic({ app: "A", owner: owner.address, signMessage: flaky }),
    (e: unknown) => e instanceof NonDeterministicWalletError,
  );
});
