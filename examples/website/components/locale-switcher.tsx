"use client"

import {useRouter} from "next/navigation"
import {useLocale, useTranslations} from "next-intl"
import {Check, ChevronDown} from "lucide-react"

import {Button} from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {persistLocale} from "@/i18n/client"
import {locales, type Locale} from "@/i18n/config"

export function LocaleSwitcher({className}: {className?: string}) {
  const locale = useLocale()
  const router = useRouter()
  const t = useTranslations("header")
  const names: Record<Locale, string> = {en: t("english"), fr: t("french")}

  function choose(next: Locale) {
    if (next === locale) return
    persistLocale(next)
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={`gap-1 ${className ?? ""}`} aria-label={t("language")}>
          {locale.toUpperCase()}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((code) => (
          <DropdownMenuItem key={code} onSelect={() => choose(code)} className="gap-2">
            <span className="w-4">{code === locale ? <Check className="h-4 w-4" /> : null}</span>
            {names[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
