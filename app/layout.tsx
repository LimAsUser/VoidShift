import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOID SHIFT",
  description: "双人合作废墟回收恐怖射击游戏。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
