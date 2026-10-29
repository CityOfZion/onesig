import type { ReactNode } from "react";

export const metadata = {
  title: "onesig · Next.js example",
  description: "One signature → a self-custodied session wallet (viem) with @cityofzion/onesig.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
