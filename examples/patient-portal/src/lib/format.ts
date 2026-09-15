import type { HumanName, Identifier, Money, Patient } from '@medplum/fhirtypes';
import { CNI_SYSTEM, DEFAULT_CURRENCY, MRN_SYSTEM, PASSPORT_SYSTEM, RESIDENCE_PERMIT_SYSTEM } from './constants';

/** Stripe / display: currencies with no minor unit. */
const ZERO_DECIMAL = new Set(['XAF', 'XOF', 'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XPF']);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toUpperCase());
}

/** Format a Money (or value+currency) for display, e.g. "18 000 XAF" or "$30.50". */
export function formatMoney(money?: Money | null): string {
  if (!money || money.value === undefined) {
    return '—';
  }
  return formatAmount(money.value, money.currency ?? DEFAULT_CURRENCY);
}

export function formatAmount(value: number, currency = DEFAULT_CURRENCY): string {
  const fractionDigits = isZeroDecimal(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    // Fallback if the Intl currency data is unavailable on-device.
    return `${value.toFixed(fractionDigits)} ${currency}`;
  }
}

export function formatHumanName(name?: HumanName | HumanName[]): string {
  const n = Array.isArray(name) ? name[0] : name;
  if (!n) {
    return 'Unknown';
  }
  if (n.text) {
    return n.text;
  }
  return [n.given?.join(' '), n.family].filter(Boolean).join(' ').trim() || 'Unknown';
}

export function patientName(patient?: Patient): string {
  return formatHumanName(patient?.name);
}

export function patientInitials(patient?: Patient): string {
  const name = patientName(patient);
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function findIdentifier(patient: Patient | undefined, system: string): string | undefined {
  return patient?.identifier?.find((id: Identifier) => id.system === system)?.value;
}

export function patientCni(patient?: Patient): string | undefined {
  return findIdentifier(patient, CNI_SYSTEM);
}

/**
 * The strongest identity document on file, with a label to display beside it.
 *
 * Not every patient is a Cameroonian national, so a card that can only show a
 * CNI is blank for anyone else. Preference order is CNI, then passport, then
 * residence permit, then any other identifier that carries a value — a card
 * showing "Passport A1234567" is useful, one showing "—" is not.
 * @param patient - The patient.
 * @returns Label and value, or undefined when nothing is recorded.
 */
export function patientIdDocument(patient?: Patient): { label: string; value: string } | undefined {
  const cni = patientCni(patient);
  if (cni) {
    return { label: 'CNI', value: cni };
  }
  const passport = findIdentifier(patient, PASSPORT_SYSTEM);
  if (passport) {
    return { label: 'Passport', value: passport };
  }
  const permit = findIdentifier(patient, RESIDENCE_PERMIT_SYSTEM);
  if (permit) {
    return { label: 'Residence permit', value: permit };
  }
  const other = patient?.identifier?.find((id: Identifier) => id.value && id.system !== MRN_SYSTEM);
  return other?.value ? { label: other.type?.text ?? 'ID', value: other.value } : undefined;
}

export function patientMrn(patient?: Patient): string | undefined {
  return findIdentifier(patient, MRN_SYSTEM);
}

export function formatDate(value?: string): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value.slice(0, 10);
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
