/**
 * onesig — one signature → a self-custodied session wallet.
 *
 * The owner signs ONE human-readable, app-namespaced message with their normal
 * wallet. We hash that signature into a secp256k1 private key and hand back a
 * ready-to-use viem `Account`. Same owner + same app + same message always
 * re-derives the SAME wallet, so there is nothing to store — a cache is only a
 * convenience, never the source of truth.
 *
 * Read SPEC.md for the message format and the threat model. Two rules decide
 * whether this is safe for you:
 *   1. Deterministic-signing EOAs only (RFC-6979 — MetaMask, Ledger, Rabby…).
 *      Smart-contract wallets (Safe, ERC-4337, Argent) return non-deterministic
 *      ERC-1271 signatures and CANNOT be used — `assertDeterministic` catches it.
 *   2. The signature IS the key. Only ever hold pocket change here, cap spend
 *      server-side, and never prompt this exact message anywhere but your app.
 */

import { keccak256, toHex, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// re-exported for consumers (so you don't need a direct viem import for types)
export type { Address, Hex, PrivateKeyAccount } from "viem";

/** The slice of an EIP-1193 provider (e.g. `window.ethereum`) we use. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** Inputs that define WHICH wallet is derived (no signer). */
export interface DeriveParams {
  /** Your app's namespace. Domain-separates the wallet so a signature for your
   *  app can never derive the wallet for another. Keep it stable. Required. */
  app: string;
  /** The owner address that signs. Lower-cased into the message. Required. */
  owner: Address;
  /** Scheme version baked into the message. Default "1". Bump to rotate (a new
   *  version = a brand-new wallet; sweep funds across). */
  version?: string | number;
  /** Optional index for multiple wallets under one owner+app. Default 0. */
  index?: number;
  /** Override the consent line shown in the wallet popup. The default already
   *  states it's free and warns to only sign on your app. */
  consent?: string;
}

/** `DeriveParams` plus exactly one signer. */
export interface SignParams extends DeriveParams {
  /** EIP-1193 provider — signs via `personal_sign`. */
  provider?: Eip1193Provider;
  /** Bring-your-own signer: given the message, return the signature hex.
   *  (e.g. viem `account.signMessage({ message })`.) Takes precedence. */
  signMessage?: (message: string) => Promise<Hex>;
}

export interface SessionWallet {
  /** The derived wallet's address. */
  address: Address;
  /** The derived private key. Treat as a secret; pocket change only. */
  privateKey: Hex;
  /** A viem account, ready to sign txs/messages. */
  account: PrivateKeyAccount;
  owner: Address;
  app: string;
  version: string;
  index: number;
}

/** Thrown when re-derivation yields a different address than before — i.e. the
 *  wallet did NOT sign deterministically (a smart-contract wallet, or one that
 *  doesn't implement RFC-6979). Such wallets cannot be used with onesig. */
export class NonDeterministicWalletError extends Error {
  readonly owner: Address;
  constructor(owner: Address) {
    super(
      `onesig: ${owner} did not sign deterministically — re-derivation produced a ` +
        `different wallet. Smart-contract wallets (Safe, ERC-4337, Argent) and any ` +
        `wallet without RFC-6979 signatures are unsupported.`,
    );
    this.name = "NonDeterministicWalletError";
    this.owner = owner;
  }
}

// The " · " that separates fields in the signed header. Interpolated fields must
// not contain it (or control characters), or one (app, owner, index) tuple could
// be made to collide with another's message — or re-flow the human-readable
// prompt the user reads and signs.
const FIELD_SEP = " · ";
const CONTROL_CHARS = /[\u0000-\u001F]/; // C0 controls incl. CR/LF
const CONTROL_CHARS_KEEP_NL = /[\u0000-\u0009\u000B-\u001F]/; // allow \n only

function assertHeaderField(name: string, v: string): void {
  if (CONTROL_CHARS.test(v)) {
    throw new Error(`onesig: ${name} must not contain line breaks or control characters`);
  }
  if (v.includes(FIELD_SEP)) {
    throw new Error(`onesig: ${name} must not contain the "${FIELD_SEP.trim()}" field separator`);
  }
}

/** Build the canonical, human-readable message the owner signs. Deterministic:
 *  the same params always produce the same string (see SPEC.md).
 *
 *  Validates its inputs so they can't collide across (app, owner, index) or
 *  re-flow the consent the user sees: `owner` must be a 20-byte address, `index`
 *  a non-negative integer, and `app`/`version`/`consent` free of control
 *  characters (and the field separator). These fields are SECURITY-RELEVANT —
 *  keep them trusted constants, never attacker-controlled (see SPEC §6). */
export function buildMessage(p: DeriveParams): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.owner)) {
    throw new Error("onesig: owner must be a 0x-prefixed 20-byte address");
  }
  const index = p.index ?? 0;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("onesig: index must be a non-negative integer");
  }
  if (p.app.length === 0) throw new Error("onesig: app must not be empty");
  const version = String(p.version ?? "1");
  assertHeaderField("app", p.app);
  assertHeaderField("version", version);
  if (p.consent !== undefined && CONTROL_CHARS_KEEP_NL.test(p.consent)) {
    throw new Error("onesig: consent must not contain control characters");
  }

  const owner = p.owner.toLowerCase();
  const head = `${p.app} session wallet v${version}${FIELD_SEP}${owner}${index > 0 ? ` #${index}` : ""}`;
  const consent =
    p.consent ??
    `This signature creates a self-custodied session wallet for ${p.app} — ` +
      `free, no transaction. Only ever sign this on ${p.app}; the signature controls the wallet.`;
  return `${head}\n\n${consent}`;
}

/** Derive a session wallet from an ALREADY-OBTAINED signature. Pure (no signer):
 *  ideal for tests, or for a server that was handed the signature. The signature
 *  must be over `buildMessage(params)`. */
export function deriveFromSignature(signature: Hex, params: DeriveParams): SessionWallet {
  // A personal_sign / EIP-191 signature is exactly 65 bytes (r‖s‖v) = 132 hex
  // chars. Enforcing the length rejects truncated/short inputs that would
  // otherwise hash to a plausible-but-WRONG wallet.
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error("onesig: signature must be a 0x-prefixed 65-byte (132-char) hex string");
  }
  // keccak the signature BYTES into a 32-byte key. In the astronomically
  // unlikely case the hash is 0 or ≥ the curve order, privateKeyToAccount throws
  // and we re-hash — rejection sampling onto [1, n-1]. Keep the validated account
  // from inside the loop (no double derivation) and fail loud on the impossible
  // exhaustion rather than returning a wallet built from an unchecked key.
  let pk = keccak256(signature);
  let account: PrivateKeyAccount | null = null;
  for (let i = 0; i < 8 && !account; i++) {
    try {
      account = privateKeyToAccount(pk);
    } catch {
      pk = keccak256(pk);
    }
  }
  if (!account) {
    throw new Error("onesig: could not derive a valid key from the signature");
  }
  return {
    address: account.address,
    privateKey: pk,
    account,
    owner: params.owner.toLowerCase() as Address,
    app: params.app,
    version: String(params.version ?? "1"),
    index: params.index ?? 0,
  };
}

async function sign(p: SignParams, message: string): Promise<Hex> {
  if (p.signMessage) return p.signMessage(message);
  if (p.provider) {
    // personal_sign takes (hex-encoded message, signer address)
    const sig = await p.provider.request({
      method: "personal_sign",
      params: [toHex(message), p.owner],
    });
    return sig as Hex;
  }
  throw new Error("onesig: provide either `provider` (EIP-1193) or `signMessage`");
}

/** Prompt one signature and derive the session wallet. */
export async function deriveSessionWallet(params: SignParams): Promise<SessionWallet> {
  const message = buildMessage(params);
  const signature = await sign(params, message);
  return deriveFromSignature(signature, params);
}

/** Sign TWICE and confirm both derive the same wallet — a loud check that the
 *  wallet signs deterministically (RFC-6979) before you trust it. Costs the user
 *  two popups, so call it once at setup (or behind a "verify" action), not every
 *  load. Throws `NonDeterministicWalletError` if they differ. For the free,
 *  no-extra-popup check, compare a re-derivation against your cache instead. */
export async function assertDeterministic(params: SignParams): Promise<SessionWallet> {
  const a = await deriveSessionWallet(params);
  const b = await deriveSessionWallet(params);
  if (a.address.toLowerCase() !== b.address.toLowerCase()) {
    throw new NonDeterministicWalletError(params.owner);
  }
  return a;
}
