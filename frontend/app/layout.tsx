import type { Metadata } from "next";
import { AuthSessionSync } from "@/components/auth-session-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "Psychic Petals — Reading Room",
  description: "A quiet place to read Psychic Petals.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AuthSessionSync />
        {children}
      </body>
    </html>
  );
}
