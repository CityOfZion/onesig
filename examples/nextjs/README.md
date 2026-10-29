# onesig · Next.js example

A minimal Next.js (App Router) app showing `useSessionWallet` from
`@cityofzion/onesig/react`: connect an owner wallet, sign once, and get a
self-custodied session wallet that re-derives from cache on reload.

The page is a client component (`"use client"`) because the hook touches
`window.ethereum` and `localStorage`; the hook itself guards for SSR, so it's
safe to import anywhere.

## Run

From the repo root, build the package once, then start the example:

```bash
npm install          # (repo root) builds dist via the prepare script
cd examples/nextjs
npm install          # links the local @cityofzion/onesig (file:../..)
npm run dev
```

Open http://localhost:3000, click **Connect wallet** (MetaMask / Rabby), then
**Create session wallet** and approve the single signature. Reload the page —
the wallet comes back from cache without another signature.

> Needs a deterministic EOA wallet (MetaMask, Rabby, Ledger…). Smart-contract
> wallets are unsupported by design — see the project README and SPEC.
