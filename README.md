# onesig

[![CI](https://github.com/CityOfZion/onesig/actions/workflows/ci.yml/badge.svg)](https://github.com/CityOfZion/onesig/actions/workflows/ci.yml)

**One signature → a self-custodied session wallet.** The owner signs one
human-readable message with their normal wallet; `onesig` turns that signature
into a ready-to-use [viem](https://viem.sh) account. Same owner + same app always
re-derives the **same** wallet — so there's nothing to store, no backend, no vendor.

```ts
import { deriveSessionWallet } from "@cityofzion/onesig";

const agent = await deriveSessionWallet({
  app: "MyApp",
  owner: address,            // the connected wallet
  provider: window.ethereum, // EIP-1193
});

agent.account; // a viem Account — sign txs/messages with it anywhere
```

It's ~150 lines doing one thing. The value is doing it **correctly**: curve-order
handling, a domain-separated versioned message, and a loud failure on wallets that
can't support it (below). Born on [Neo X](https://docs.banelabs.org/) for the
[WhisperDark](https://github.com/apisit/neo-x402) agent game; works on any EVM chain.

---

## ⚠️ Read this before you use it

Two properties decide whether `onesig` is safe for your case. They are not fine print.

1. **Deterministic-signing EOAs only (RFC-6979).** MetaMask, Ledger, Rabby, Coinbase
   Wallet, etc. sign the same message the same way every time, so the wallet always
   comes back. **Smart-contract wallets — Safe, ERC-4337, Argent — do _not_** (their
   ERC-1271 signatures aren't a stable blob to hash). The `useSessionWallet` hook
   **verifies this before trusting the first derivation** (one extra signature at setup;
   opt out with `verifyOnFirstDerive: false`) and on every re-derive, throwing
   `NonDeterministicWalletError` rather than silently minting a different wallet. With the
   bare `deriveSessionWallet`, run `assertDeterministic` once yourself.
2. **The signature _is_ the key.** Anyone who gets the owner to sign that exact message
   can derive — and drain — the wallet. So: keep **pocket change only** here, **cap what
   it can spend server-side**, and **never prompt this message anywhere but your app**.
   This is a convenience hot wallet, not a vault.

If you need scoped, revocable, on-chain authority over the user's *real* account, you
want EIP-7702 / ERC-4337 session keys instead — see [When to use this](#when-to-use-this).

## Install

Straight from GitHub (builds on install via the `prepare` script):

```bash
npm i github:CityOfZion/onesig viem
# pin to a release:
npm i github:CityOfZion/onesig#v0.2.0 viem
```

`viem` is a peer dependency. `react` is an optional peer (only for `/react`).

> Distributed via GitHub for now (not on npm) — pin a tag for stability.

## Try it

A runnable, no-browser example lives in
[`examples/node-basic.ts`](./examples/node-basic.ts). It plays the owner with a
throwaway viem account (a deterministic RFC-6979 signer — like a real EOA) and
prints the message that gets signed, the derived wallet, and proof it re-derives
identically:

```bash
npm install && npm run example
```

A browser example (Next.js + MetaMask, using the React hook) is in
[`examples/nextjs`](./examples/nextjs).

## Usage

### Core (any framework)

```ts
import { deriveSessionWallet } from "@cityofzion/onesig";

// with an EIP-1193 provider
const agent = await deriveSessionWallet({ app: "MyApp", owner, provider: window.ethereum });

// or bring your own signer (e.g. a viem wallet client)
const agent2 = await deriveSessionWallet({
  app: "MyApp",
  owner,
  signMessage: (message) => walletClient.signMessage({ account: owner, message }),
});
```

### React

```tsx
import { useSessionWallet } from "@cityofzion/onesig/react";

function Agent({ owner }: { owner: `0x${string}` }) {
  const { wallet, derive, status, error } = useSessionWallet({
    app: "MyApp",
    owner,
    provider: window.ethereum,
  });

  if (error) return <p>{error.message}</p>;
  if (!wallet) {
    return (
      <button onClick={() => derive()} disabled={status === "deriving"}>
        {status === "deriving" ? "Sign in your wallet…" : "Create agent wallet"}
      </button>
    );
  }
  return <p>Agent: {wallet.address}</p>; // re-derives from cache on next visit
}
```

The hook caches per `(owner, app, version, index)` so the user signs once after setup. It
**verifies determinism** — by default a *second* signature on the first derive (opt out
with `verifyOnFirstDerive: false`), then a free comparison against the cache on every
re-derive — throwing `NonDeterministicWalletError` for an unsupported wallet instead of
silently minting a different one. The cached address is always recomputed from the stored
key, and a tampered entry (address ≠ key) is evicted.

### Multiple wallets, and rotation

```ts
deriveSessionWallet({ app: "MyApp", owner, index: 1 });       // a second isolated wallet
deriveSessionWallet({ app: "MyApp", owner, version: 2 });     // a NEW wallet (sweep funds first)
```

### Verify a wallet is supported (optional, costs 2 popups)

```ts
import { assertDeterministic } from "@cityofzion/onesig";
await assertDeterministic({ app: "MyApp", owner, provider }); // throws if non-deterministic
```

## How it works

```
message   = "<app> session wallet v<version> · <owner>[ #<index>]\n\n<consent line>"
privateKey = keccak256( sign(message) )          // rejection-sampled onto the curve
account    = privateKeyToAccount(privateKey)      // viem
```

The message is human-readable and app-namespaced so a signature for your app can't
derive a wallet for someone else's, and the wallet popup doubles as the consent screen.
Full format and threat model: **[SPEC.md](./SPEC.md)**.

## API

| Export | What it does |
|---|---|
| `deriveSessionWallet(params)` | Prompt one signature, return a `SessionWallet`. |
| `deriveFromSignature(sig, params)` | Pure: derive from a signature you already have (tests, servers). |
| `buildMessage(params)` | The exact message that gets signed. |
| `assertDeterministic(params)` | Sign twice; throw if the wallet isn't deterministic. |
| `NonDeterministicWalletError` | Thrown for unsupported wallets. |
| `useSessionWallet(opts)` *(`/react`)* | Cache + determinism-verifying hook. |

## When to use this

| You want… | Use |
|---|---|
| A throwaway/agent wallet, **zero infra, any chain, today** | **onesig** |
| Scoped, revocable, on-chain authority over the user's *real* account | [EIP-7702](https://ethereum.org/roadmap/pectra/7702/) / ERC-4337 session keys |
| Managed custody, recovery, smart accounts, policies | Embedded-wallet SaaS (Privy, Dynamic, Turnkey, …) |

`onesig` is the simplest tier — it trades on-chain revocation and smart-wallet support
for having **no backend and no dependencies**. Pick accordingly.

## Prior art & credits

This is a clean, tested implementation of a known pattern — not a new invention:

- The scheme was proposed on
  [ethresear.ch (2023)](https://ethresear.ch/t/rfc-hierarchical-deterministic-wallet-derivation-function/15214)
  (human-readable, app-named message → secp256k1 key), which never shipped as an EIP.
- [Fluidkey](https://l2beat.com/privacy/projects/fluidkey) derives keys from a wallet
  signature in production (for stealth addresses).
- The determinism requirement is a documented real-world constraint — see
  [Burner's note](https://help.burner.pro/en/articles/10310155-does-burner-support-deterministic-signatures).

`onesig` adds the correctness, the loud failure modes, and the honest docs that a
copy-pasted gist doesn't.

## License

[MIT](./LICENSE) © City of Zion
