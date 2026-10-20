# onesig — specification (v1)

*Status: informational / draft. This documents the derivation so other
implementations can reproduce the same wallet and so the security model is
explicit. It is not a novel construction — see [Prior art](#prior-art).*

## 1. Overview

A **session wallet** is a secp256k1 keypair derived deterministically from a single
signature made by an **owner** account over a fixed, app-namespaced message. The same
owner, app, version, and index always produce the same session wallet, so the keypair
need never be stored; any cache is a convenience, not the source of truth.

## 2. Parameters

| Name | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `app` | string | yes | — | Application namespace. Domain-separates the derivation. SHOULD be stable and human-readable. |
| `owner` | address | yes | — | The account that signs. Lower-cased in the message. |
| `version` | string | no | `"1"` | Scheme/key version. Changing it derives a new, unrelated wallet. |
| `index` | integer ≥ 0 | no | `0` | Allows multiple wallets per `(owner, app, version)`. |
| `consent` | string | no | (see §3) | The human-readable line shown in the wallet prompt. |

## 3. Message

The message signed by the owner is, exactly:

```
<app> session wallet v<version> · <owner>[ #<index>]
<LF>
<LF>
<consent>
```

- `<owner>` is the lower-cased `0x`-prefixed address.
- ` #<index>` is appended **only** when `index > 0`.
- `·` is U+00B7 (MIDDLE DOT). Lines are joined with LF (`\n`).
- Default `<consent>`:
  `This signature creates a self-custodied session wallet for <app> — free, no transaction. Only ever sign this on <app>; the signature controls the wallet.`

The message is human-readable so the wallet's signing popup serves as the consent
screen, and app-namespaced so a signature obtained for one app cannot derive another
app's wallet.

## 4. Derivation

```
sig         = sign_personal(message, owner)     // EIP-191 personal_sign
k           = keccak256(sig)                     // 32 bytes, hash of the signature BYTES
while k == 0 or k >= n:   k = keccak256(k)       // n = secp256k1 order; rejection sampling
privateKey  = k
address     = secp256k1_pubkey(privateKey) → EIP-55 address
```

`keccak256` is applied to the raw signature bytes (the decoded `0x…` hex), not to its
hex text. Rejection sampling makes the invalid-key case (probability ≈ 2⁻¹²⁸)
deterministic rather than an error.

## 5. Determinism requirement (normative)

The construction REQUIRES that `sign_personal(message, owner)` be **deterministic** —
the same `(message, owner)` MUST always yield byte-identical signatures. Externally
owned accounts implementing **RFC-6979** deterministic ECDSA satisfy this.

- Wallets that MUST NOT be assumed to work: smart-contract / ERC-4337 accounts, ERC-1271
  contract signers (Safe, Argent, …), and any signer using random ECDSA nonces.
- An implementation SHOULD detect non-determinism — e.g. by re-deriving and comparing
  the address to a prior value — and MUST fail loudly rather than silently return a
  different wallet.

## 6. Security model (normative)

- **The signature is key-equivalent.** Anyone who obtains the signature can derive and
  control the session wallet. Implementations and apps MUST treat it as a secret and
  MUST NOT transmit it.
- **Pocket change only.** The session wallet SHOULD hold only small balances, and the
  application SHOULD enforce a spend ceiling at its own server/boundary.
- **One message, one app.** An app MUST NOT reuse another app's exact message, and the
  owner MUST NOT be prompted with this message outside the app. (App + version namespacing
  is the defense; it is not a defense against a user signing a convincing clone.)
- **No on-chain revocation or rotation.** Compromise is mitigated only by small balances
  and spend caps. "Rotation" means bumping `version`, which derives a NEW wallet; funds
  must be swept across manually. Applications that need revocable, scoped authority over
  the owner's own account SHOULD use EIP-7702 / ERC-4337 session keys instead.

## 7. Caching (non-normative)

Implementations MAY cache `{address, privateKey, owner, app, version, index}` keyed by
`(owner, app, version, index)` to avoid re-prompting. A cache miss MUST be recoverable by
re-deriving (re-signing). A cache hit whose re-derivation yields a different address
indicates a non-deterministic wallet (§5) and MUST be surfaced as an error.

## 8. Interop

Two implementations that agree on §3 (message) and §4 (derivation) produce identical
wallets for the same parameters. This is intended for **re-derivation within one app
across devices/sessions**, not as a shared cross-app identity — see §6.

## Prior art

- ethresear.ch, *RFC: Hierarchical Deterministic Wallet Derivation Function* (2023) —
  proposes deriving accounts from a human-readable, app-named, indexed signature; the
  closest precedent to this scheme. It did not progress to an EIP.
  <https://ethresear.ch/t/rfc-hierarchical-deterministic-wallet-derivation-function/15214>
- Fluidkey — derives keys from a wallet signature in production (stealth addresses).
  <https://l2beat.com/privacy/projects/fluidkey>
- Burner — on the deterministic-signature requirement and wallets that depend on it.
  <https://help.burner.pro/en/articles/10310155-does-burner-support-deterministic-signatures>

## References

- RFC 6979 — Deterministic Usage of DSA and ECDSA. <https://datatracker.ietf.org/doc/html/rfc6979>
- EIP-191 — Signed Data Standard (`personal_sign`). <https://eips.ethereum.org/EIPS/eip-191>
- EIP-1193 — Ethereum Provider JavaScript API. <https://eips.ethereum.org/EIPS/eip-1193>
- EIP-7702 — Set EOA account code (Pectra). <https://eips.ethereum.org/EIPS/eip-7702>
