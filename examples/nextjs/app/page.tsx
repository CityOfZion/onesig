"use client";

import { useState, type CSSProperties } from "react";
import { useSessionWallet } from "@cityofzion/onesig/react";

// Minimal EIP-1193 provider shape — structurally what onesig expects.
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export default function Page() {
  const [owner, setOwner] = useState<`0x${string}` | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);

  async function connectOwner() {
    setConnectErr(null);
    try {
      if (!window.ethereum) throw new Error("No injected wallet found — install MetaMask or Rabby.");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.[0]) throw new Error("No account returned by the wallet.");
      setOwner(accounts[0] as `0x${string}`);
    } catch (e) {
      setConnectErr((e as Error).message);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>onesig · Next.js example</h1>
      <p style={styles.lede}>
        Connect your normal wallet (the “owner”). One signature spawns a self-custodied session
        wallet — the same owner + app always re-derives the same one, so there’s nothing to store.
      </p>

      {!owner ? (
        <>
          <button style={styles.btn} onClick={connectOwner}>Connect wallet</button>
          {connectErr && <p style={styles.err}>{connectErr}</p>}
        </>
      ) : (
        <Agent owner={owner} />
      )}

      <p style={styles.note}>
        Pocket-change hot wallet only — the signature IS the key. Needs a deterministic EOA
        (MetaMask, Rabby, Ledger…); smart-contract wallets are unsupported by design.
      </p>
    </main>
  );
}

function Agent({ owner }: { owner: `0x${string}` }) {
  const { wallet, derive, clear, status, error, message } = useSessionWallet({
    app: "OnesigNextExample",
    owner,
    provider: window.ethereum,
  });

  return (
    <section style={styles.card}>
      <div>
        Owner: <code style={styles.code}>{owner}</code>
      </div>

      {error && <p style={styles.err}>{error.message}</p>}

      {wallet ? (
        <>
          <div style={{ marginTop: 10 }}>
            Session wallet: <code style={styles.code}>{wallet.address}</code>
          </div>
          <p style={styles.note}>Re-derives from cache on reload — nothing stored server-side.</p>
          <button style={styles.btnGhost} onClick={clear}>Forget (clear cache)</button>
        </>
      ) : (
        <>
          <details style={{ margin: "10px 0" }}>
            <summary>Message you’ll sign</summary>
            <pre style={styles.pre}>{message}</pre>
          </details>
          <button
            style={styles.btn}
            disabled={status === "deriving"}
            onClick={() => void derive().catch(() => {})}
          >
            {status === "deriving" ? "Sign in your wallet…" : "Create session wallet"}
          </button>
        </>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 640, margin: "48px auto", padding: "0 20px", fontFamily: "ui-sans-serif, system-ui, sans-serif", lineHeight: 1.5, color: "#1a1a1a" },
  h1: { fontSize: 24, marginBottom: 6 },
  lede: { color: "#444" },
  card: { border: "1px solid #e2e2e2", borderRadius: 12, padding: 18, margin: "18px 0" },
  btn: { background: "#3b4ff7", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 15, cursor: "pointer" },
  btnGhost: { background: "transparent", color: "#555", border: "1px solid #ccc", borderRadius: 8, padding: "7px 14px", fontSize: 14, cursor: "pointer", marginTop: 10 },
  code: { background: "#f2f2f5", padding: "2px 6px", borderRadius: 5, fontSize: 13, wordBreak: "break-all" },
  pre: { background: "#f7f7fa", padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  note: { color: "#888", fontSize: 13, marginTop: 14 },
  err: { color: "#c0152f", fontSize: 14, marginTop: 10 },
};
