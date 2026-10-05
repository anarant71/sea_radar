import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sea Radar",
  description: "Учебная карта судов в проливе Дувр",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
