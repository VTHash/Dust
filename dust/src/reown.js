import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { linea } from "@reown/appkit/networks";

export function initReownAppKit() {
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

  if (!projectId) {
    return {
      appKit: null,
      error: "Missing VITE_REOWN_PROJECT_ID in .env (project root). Restart npm run dev."
    };
  }

  const metadata = {
    name: "DustClaim",
    description: "Claim your daily DUST on Linea",
    url: "https://dustclaim.eth.limo",
    icons: ["https://dustclaim.xyz/favicon.ico"]
  };

  const appKit = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [linea],
    projectId,
    metadata,

    // Full wallet directory
    allWallets: "SHOW"
  });

  return { appKit, error: null };
}