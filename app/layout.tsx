import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Verifica AI | FortAds', description: 'Prospecção inteligente de empresas brasileiras' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
