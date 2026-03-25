import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Control Room',
  description: 'Multi-Agent Collaboration Console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
