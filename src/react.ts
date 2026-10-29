/**
 * onesig/react — a thin hook around the core.
 *
 * Caches the derived wallet per (owner, app, version, index) so the user signs
 * once, not every visit. Determinism — the property the whole scheme rests on —
 * is enforced here:
 *   • re-derive with a cache present → the fresh derivation is compared to the
 *     stored address (free, no extra popup);
 *   • first derive with NO cache (new device, caching off) → unless you opt out
 *     via `verifyOnFirstDerive: false`, it signs a SECOND time and confirms the
 *     result matches before trusting/caching it — so a non-deterministic
 *     (smart-contract / non-RFC-6979) wallet fails loudly with
 *     `NonDeterministicWalletError` instead of silently minting a different,
 *     unrecoverable wallet on each device.
 *
 * The cache holds the private key, and the live address is ALWAYS recomputed
 * from that key (an entry whose stored address and key disagree is evicted).
 * That is acceptable only because this is a pocket-change hot wallet (see
 * SPEC.md): any same-origin script can still read or overwrite the cache, so
 * never store value here you'd mind a compromised browser draining.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildMessage,
  deriveSessionWallet,
  NonDeterministicWalletError,
  type Address,
  type SessionWallet,
  type SignParams,
} from "./index.js";

type Cached = Pick<SessionWallet, "address" | "privateKey" | "owner" | "app" | "version" | "index">;
type CacheStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface UseSessionWalletOptions extends SignParams {
  /** Where to cache. Defaults to `localStorage`; pass `null` to disable caching
   *  (the user then re-signs every mount). */
  storage?: CacheStore | null;
  /** Cache-key prefix. Default "onesig". */
  cachePrefix?: string;
  /** On a COLD derive (no cache to compare against) sign a second time and
   *  confirm the wallet re-derives identically before trusting it — the loud
   *  guard against non-deterministic wallets. Costs one extra popup on first
   *  setup (per device). Default `true`; set `false` for a pure one-signature
   *  flow when you KNOW all your users sign deterministically (EOAs only). */
  verifyOnFirstDerive?: boolean;
}

export type SessionWalletStatus = "idle" | "deriving" | "ready" | "error";

export interface UseSessionWalletResult {
  /** The derived wallet, or null until `derive()` has run (or a cache hit). */
  wallet: SessionWallet | null;
  /** Prompt the signature(s) and derive — verifies determinism (see hook docs). */
  derive: () => Promise<SessionWallet>;
  /** Forget the cached wallet for these params (does not touch funds). */
  clear: () => void;
  status: SessionWalletStatus;
  error: Error | null;
  /** The exact message the owner will be asked to sign. */
  message: string;
}

function defaultStorage(): CacheStore | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* access can throw in sandboxed/private contexts */
  }
  return null;
}

function readCached(storage: CacheStore, key: string): Cached | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return typeof c?.privateKey === "string" && c.privateKey.startsWith("0x") ? c : null;
  } catch {
    return null;
  }
}

/** Rebuild the live wallet from a cache entry, ALWAYS recomputing the address
 *  from the stored private key (never trusting the stored `address`). */
function reviveAccount(c: Cached): SessionWallet {
  const account = privateKeyToAccount(c.privateKey);
  return { ...c, address: account.address, account };
}

function writeCache(storage: CacheStore, key: string, w: SessionWallet): void {
  const toCache: Cached = {
    address: w.address,
    privateKey: w.privateKey,
    owner: w.owner,
    app: w.app,
    version: w.version,
    index: w.index,
  };
  try {
    storage.setItem(key, JSON.stringify(toCache));
  } catch {
    /* storage full/blocked — still return the wallet */
  }
}

export function useSessionWallet(opts: UseSessionWalletOptions): UseSessionWalletResult {
  const {
    app,
    owner,
    version = "1",
    index = 0,
    cachePrefix = "onesig",
    verifyOnFirstDerive = true,
  } = opts;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;

  const key = useMemo(
    () => `${cachePrefix}:${app}:v${version}:${owner.toLowerCase()}:${index}`,
    [cachePrefix, app, version, owner, index],
  );
  const message = useMemo(
    () => buildMessage({ app, owner, version, index, consent: opts.consent }),
    [app, owner, version, index, opts.consent],
  );

  const [wallet, setWallet] = useState<SessionWallet | null>(null);
  const [status, setStatus] = useState<SessionWalletStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  // the latest opts, read inside derive() without making it a dependency
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // load from cache whenever the identity (key) changes
  useEffect(() => {
    if (!storage) {
      setWallet(null);
      setStatus("idle");
      return;
    }
    const c = readCached(storage, key);
    if (c) {
      const revived = reviveAccount(c);
      // tamper/corruption guard: if the stored address disagrees with the one
      // the key actually produces, the entry is untrustworthy — evict and reset.
      if (!c.address || c.address.toLowerCase() === revived.address.toLowerCase()) {
        setWallet(revived);
        setStatus("ready");
        return;
      }
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    setWallet(null);
    setStatus("idle");
  }, [key, storage]);

  const derive = useCallback(async () => {
    setStatus("deriving");
    setError(null);
    try {
      const cur = optsRef.current;
      const w = await deriveSessionWallet(cur);

      // Determinism enforcement.
      const prior = storage ? readCached(storage, key) : null;
      if (prior?.address) {
        // warm cache → compare to the stored address (free, no extra popup)
        if (prior.address.toLowerCase() !== w.address.toLowerCase()) {
          throw new NonDeterministicWalletError(owner as Address);
        }
      } else if (verifyOnFirstDerive) {
        // cold → nothing to compare against, so sign once more and confirm
        // before trusting (and caching) a single derivation.
        const again = await deriveSessionWallet(cur);
        if (again.address.toLowerCase() !== w.address.toLowerCase()) {
          throw new NonDeterministicWalletError(owner as Address);
        }
      }

      if (storage) writeCache(storage, key, w);
      setWallet(w);
      setStatus("ready");
      return w;
    } catch (e) {
      setError(e as Error);
      setStatus("error");
      throw e;
    }
  }, [key, storage, owner, verifyOnFirstDerive]);

  const clear = useCallback(() => {
    try {
      storage?.removeItem(key);
    } catch {
      /* ignore */
    }
    setWallet(null);
    setStatus("idle");
  }, [key, storage]);

  return { wallet, derive, clear, status, error, message };
}

export { NonDeterministicWalletError } from "./index.js";
export type { SessionWallet, SignParams } from "./index.js";
