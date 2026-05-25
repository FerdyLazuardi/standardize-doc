import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Standardize Knowledge Studio",
  description: "PPT-to-Markdown studio for A-Pedi RAG ingestion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body
        className="min-h-screen bg-bg text-text antialiased"
        suppressHydrationWarning
      >
        {children}
        <Toaster position="top-right" theme="light" richColors closeButton />
      </body>
    </html>
  );
}
