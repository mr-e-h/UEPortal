import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ViewAsBar from "@/components/ViewAsBar";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: "MinUE",
  description: "Underentreprenør-rapportering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <ViewAsBar />
      </body>
    </html>
  );
}
