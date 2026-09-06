import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { draftMode } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { VisualEditing } from 'next-sanity/visual-editing'

import { LocaleSync } from '@/components/locale-sync'
import { SanityLive, showDrafts } from '@/sanity/lib/live'
import './globals.css'

const inter = Inter({
  subsets: ["latin"],
  variable: '--font-inter',
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: '--font-playfair',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('site')
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    icons: { icon: [{ url: '/favicon.ico' }] },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const t = await getTranslations('preview')
  const { isEnabled: isDraftMode } = await draftMode()

  return (
    <html lang={locale}>
      <body className={`${inter.variable} ${playfair.variable} font-sans antialiased`}>
        <NextIntlClientProvider>
          {showDrafts && (
            <div
              role="status"
              className="sticky top-0 z-[60] bg-accent px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-accent-foreground"
            >
              {t('banner')}
            </div>
          )}
          <LocaleSync />
          {children}
          <SanityLive />
          {isDraftMode && <VisualEditing />}
          <Analytics />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
