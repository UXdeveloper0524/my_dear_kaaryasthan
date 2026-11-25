import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kaaryasthan',
  description:
    'A workspace for projects, tasks, and the work waiting between them.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
