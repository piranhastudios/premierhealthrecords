import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { draftMode } from 'next/headers'
import { VisualEditing } from 'next-sanity/visual-editing'
import { SanityLive } from '@/sanity/lib/live'
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-inter',
});

const playfair = Playfair_Display({ 
  subsets: ["latin"],
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: 'Premier Health Centres | Affordable Quality Healthcare in Cameroon',
  description: 'A one-stop, multidisciplinary health centre for your medical needs. Providing affordable quality healthcare in Cameroon.',
  icons: {
    icon: [
      {
        url: '/favicon.ico',
      },
    ],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { isEnabled: isDraftMode } = await draftMode()

  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable} font-sans antialiased`}>
        {children}
        <SanityLive />
        {isDraftMode && <VisualEditing />}
        <Analytics />
      </body>
    </html>
  )
}
