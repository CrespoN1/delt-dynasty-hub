import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delt Dynasty Hub",
  description: "Awards, recaps, and standings for the Delt Dynasty fantasy league.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen gradient-bg">
        {children}
      </body>
    </html>
  );
}
