import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TACTIC-FP Annotator — Tactical Intent Annotation Tool',
  description:
    'Professional football tactical intent annotation tool for the TACTIC-FP research framework.',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0c10] text-slate-200 antialiased">{children}</body>
    </html>
  );
}
