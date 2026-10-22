/**
 * onesig — runnable Node example (no browser, no real wallet).
 *
 * We play the part of the "owner" (the user's normal wallet) with a throwaway
 * viem local account. Its `signMessage` is a deterministic, RFC-6979 secp256k1
 * signer — exactly the property onesig requires of a real wallet — so this
 * mirrors what MetaMask / Ledger / Rabby do in the browser.
 *
 * Run it:
 *
 *   npm run example
 *
 * You'll see the message that gets signed, the derived session wallet, proof it
 * re-derives identically (nothing is stored), and that `index` / `version`
 * produce brand-new wallets.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildMessage, deriveSessionWallet, type SignParams } from "@cityofzion/onesig";

async function main() {
  // The owner = the user's normal wallet. Here, a throwaway local account.
  const owner = privateKeyToAccount(generatePrivateKey());

  const params: SignParams = {
    app: "ExampleApp",
    owner: owner.address,
    // viem's signMessage is deterministic (noble RFC-6979) → onesig-safe.
    signMessage: (message) => owner.signMessage({ message }),
  };

  console.log("owner (signs once):", owner.address);
  console.log("\nmessage shown in the wallet popup:\n");
  console.log(buildMessage(params));

  // One signature → the session wallet.
  const agent = await deriveSessionWallet(params);
  console.log("\nderived session wallet:", agent.address);

  // Re-derive: same owner + app + message → the SAME wallet. Nothing stored.
  const again = await deriveSessionWallet(params);
  console.log("re-derives identically:", again.address === agent.address);

  // A second isolated wallet (index) and a rotated wallet (version) — both new.
  const second = await deriveSessionWallet({ ...params, index: 1 });
  const rotated = await deriveSessionWallet({ ...params, version: 2 });
  console.log("index: 1   →", second.address, "— new:", second.address !== agent.address);
  console.log("version: 2 →", rotated.address, "— new:", rotated.address !== agent.address);

  // agent.account is a ready-to-use viem Account.
  const receipt = await agent.account.signMessage({ message: "gm from the session wallet" });
  console.log("\nthe session wallet can sign (viem Account):", receipt.slice(0, 18) + "…");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
