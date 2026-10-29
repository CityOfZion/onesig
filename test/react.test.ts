import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { privateKeyToAccount } from "viem/accounts";
import { useSessionWallet } from "../src/react.js";
import { deriveSessionWallet, NonDeterministicWalletError, type Hex } from "../src/index.js";

// react-test-renderer needs this flag to allow act() in React 18.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const signer = (message: string) => owner.signMessage({ message });
const keyFor = (app: string) => `onesig:${app}:v1:${owner.address.toLowerCase()}:0`;

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    size: () => m.size,
  };
}

type Result = ReturnType<typeof useSessionWallet>;

/** Mount a component that calls the hook; `box.current` tracks the latest render. */
async function renderHook(use: () => Result): Promise<{ current: Result }> {
  const box = { current: null as unknown as Result };
  function Probe() {
    box.current = use();
    return null;
  }
  await act(async () => {
    TestRenderer.create(createElement(Probe));
  });
  return box;
}

test("hook: cold derive caches after verifying a deterministic signer", async () => {
  const storage = memStorage();
  const box = await renderHook(() =>
    useSessionWallet({ app: "A", owner: owner.address, signMessage: signer, storage }),
  );
  await act(async () => {
    await box.current.derive();
  });
  assert.ok(box.current.wallet?.address.startsWith("0x"));
  assert.equal(box.current.status, "ready");
  assert.equal(storage.size(), 1);
});

test("hook: cold derive rejects a non-deterministic signer and caches nothing", async () => {
  const storage = memStorage();
  let n = 0;
  const flaky = async (): Promise<Hex> => `0x${String(++n).padStart(130, "0")}` as Hex;
  const box = await renderHook(() =>
    useSessionWallet({ app: "A", owner: owner.address, signMessage: flaky, storage }),
  );
  await act(async () => {
    await assert.rejects(box.current.derive(), (e: unknown) => e instanceof NonDeterministicWalletError);
  });
  assert.equal(storage.size(), 0);
});

test("hook: opting out of first-derive verification caches a single derivation", async () => {
  const storage = memStorage();
  let n = 0;
  const flaky = async (): Promise<Hex> => `0x${String(++n).padStart(130, "0")}` as Hex;
  const box = await renderHook(() =>
    useSessionWallet({ app: "A", owner: owner.address, signMessage: flaky, storage, verifyOnFirstDerive: false }),
  );
  await act(async () => {
    await box.current.derive();
  });
  // no second signature, so the non-determinism isn't caught — it caches.
  assert.equal(storage.size(), 1);
});

test("hook: evicts a cache entry whose stored address disagrees with its key", async () => {
  const storage = memStorage();
  const real = await deriveSessionWallet({ app: "A", owner: owner.address, signMessage: signer });
  storage.setItem(
    keyFor("A"),
    JSON.stringify({
      address: "0x000000000000000000000000000000000000dEaD", // wrong
      privateKey: real.privateKey,
      owner: real.owner,
      app: "A",
      version: "1",
      index: 0,
    }),
  );
  const box = await renderHook(() =>
    useSessionWallet({ app: "A", owner: owner.address, signMessage: signer, storage }),
  );
  assert.equal(box.current.wallet, null);
  assert.equal(storage.size(), 0);
});

test("hook: a consistent cache entry loads without a signature", async () => {
  const storage = memStorage();
  const real = await deriveSessionWallet({ app: "A", owner: owner.address, signMessage: signer });
  storage.setItem(
    keyFor("A"),
    JSON.stringify({
      address: real.address,
      privateKey: real.privateKey,
      owner: real.owner,
      app: "A",
      version: "1",
      index: 0,
    }),
  );
  const box = await renderHook(() =>
    useSessionWallet({ app: "A", owner: owner.address, signMessage: signer, storage }),
  );
  assert.equal(box.current.wallet?.address, real.address);
  assert.equal(box.current.status, "ready");
});
