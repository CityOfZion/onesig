/**
 * onesig/react — a thin hook around the core.
 *
 * It caches the derived wallet per (owner, app, version, index) so the user
 * signs once, not every visit — and when the user re-derives (new device, or an
 * explicit "re-sign"), it compares the result to the cache and throws
 * `NonDeterministicWalletError` if the address changed. That's the free,
 * no-extra-popup way to catch an unsupported wallet.
 *
 * The cache holds the private key. That's acceptable ONLY because this is a
 * pocket-change hot wallet (see SPEC.md); never store value here you'd mind a
 * compromised browser draining.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildMessage,
  deriveSessionWallet,
  NonDeterministicWalletError,
  type Address,
  type Hex,
  type SessionWallet,
  type SignParams,
} from "./index.js";

type Cached = Pick<SessionWallet, "address" | "privateKey" | "owner" | "app" | "version" | "index">;

export interface UseSessionWalletOptions extends SignParams {
  /** Where to cache. Defaults to `localStorage`; pass `null` to disable caching
   *  (the user then re-signs every mount). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Cache-key prefix. Default "onesig". */
  cachePrefix?: string;
}

export type SessionWalletStatus = "idle" | "deriving" | "ready" | "error";

export interface UseSessionWalletResult {
  /** The derived wallet, or null until `derive()` has run (or a cache hit). */
  wallet: SessionWallet | null;
  /** Prompt the signature and derive (verifies against cache on re-derive). */
  derive: () => Promise<SessionWallet>;
  /** Forget the cached wallet for these params (does not touch funds). */
  clear: () => void;
  status: SessionWalletStatus;
  error: Error | null;
  /** The exact message the owner will be asked to sign. */
  message: string;
}

function defaultStorage(): UseSessionWalletOptions["storage"] {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* access can throw in sandboxed/private contexts */
  }
  return null;
}

function reviveAccount(c: Cached): SessionWallet {
  return { ...c, account: privateKeyToAccount(c.privateKey) };
}

export function useSessionWallet(opts: UseSessionWalletOptions): UseSessionWalletResult {
  const {
    app,
    owner,
    version = "1",
    index = 0,
    cachePrefix = "onesig",
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
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const c = JSON.parse(raw) as Cached;
        if (c?.privateKey?.startsWith("0x")) {
          setWallet(reviveAccount(c));
          setStatus("ready");
          return;
        }
      }
    } catch {
      /* corrupt/blocked cache — fall through to idle, derive() recovers */
    }
    setWallet(null);
    setStatus("idle");
  }, [key, storage]);

  const derive = useCallback(async () => {
    setStatus("deriving");
    setError(null);
    try {
      const w = await deriveSessionWallet(optsRef.current);
      // verify-on-re-derive: a different address than the cache means the wallet
      // didn't sign deterministically → unsupported.
      if (storage) {
        try {
          const raw = storage.getItem(key);
          if (raw) {
            const prev = JSON.parse(raw) as Cached;
            if (prev?.address && prev.address.toLowerCase() !== w.address.toLowerCase()) {
              throw new NonDeterministicWalletError(owner as Address);
            }
          }
        } catch (e) {
          if (e instanceof NonDeterministicWalletError) throw e;
          /* unreadable cache — ignore, just write the fresh one */
        }
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
      setWallet(w);
      setStatus("ready");
      return w;
    } catch (e) {
      setError(e as Error);
      setStatus("error");
      throw e;
    }
  }, [key, storage, owner]);

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
