import type { Resource } from '@medplum/fhirtypes';
import type { SummarySection } from './constants';

/** Human-facing titles for each curated section. */
export const SECTION_LABEL: Record<SummarySection, string> = {
  allergy: 'Allergies',
  medication: 'Medications',
  condition: 'Conditions',
  immunization: 'Vaccines',
  lab: 'Recent labs',
  encounter: 'Recent visits',
};

/** What an empty section should say — vaguer wording would read as an error. */
export const SECTION_EMPTY_HINT: Record<SummarySection, string> = {
  allergy: 'No allergies are recorded on your Premier Health file.',
  medication: 'No medications are recorded on your Premier Health file.',
  condition: 'No conditions are recorded on your Premier Health file.',
  immunization: 'No vaccinations are recorded on your Premier Health file.',
  lab: 'No lab results have been shared with you yet.',
  encounter: 'No past visits are recorded yet.',
};

/** One row of a summary list, flattened out of whatever FHIR type it came from. */
export interface SummaryItem {
  title: string;
  /** Dosage, measured value, reaction — whatever is most useful for this type. */
  detail?: string;
  /** Reference range, route, site — secondary clinical context. */
  note?: string;
  /** ISO date, already picked from the right field for the resource type. */
  date?: string;
  /** `active`, `completed`, `resolved`… rendered as a badge. */
  status?: string;
  /** True when a result is outside its reference range. Flagged, not hidden. */
  abnormal?: boolean;
}

type Loose = Record<string, unknown>;
interface Coded {
  text?: string;
  coding?: { display?: string; code?: string }[];
}

/** FHIR puts the display name in several optional places; take the first that reads well. */
function codedText(value: unknown): string | undefined {
  const cc = value as Coded | undefined;
  return cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code;
}

function statusOf(resource: Loose): string | undefined {
  const clinical = codedText(resource.clinicalStatus);
  if (clinical) {
    return clinical;
  }
  return typeof resource.status === 'string' ? resource.status : undefined;
}

/** Quantities render as "5.4 mmol/L"; fall back through the other value[x] shapes. */
function valueText(resource: Loose): string | undefined {
  const q = resource.valueQuantity as { value?: number; unit?: string } | undefined;
  if (q?.value !== undefined) {
    return `${q.value}${q.unit ? ` ${q.unit}` : ''}`;
  }
  if (typeof resource.valueString === 'string') {
    return resource.valueString;
  }
  const coded = codedText(resource.valueCodeableConcept);
  if (coded) {
    return coded;
  }
  return typeof resource.valueBoolean === 'boolean' ? String(resource.valueBoolean) : undefined;
}

/**
 * Flattens an IPS resource into something displayable.
 *
 * Every field here is optional in FHIR, and records coming from a real clinic
 * are frequently sparse, so each lookup falls through rather than assuming a
 * shape. A row with only a title is still useful; a crash is not.
 * @param resource - Any resource from the curated offline summary.
 * @returns The fields worth showing for this resource type.
 */
export function summaryItemOf(resource: Resource): SummaryItem {
  const r = resource as unknown as Loose;
  const status = statusOf(r);

  switch (resource.resourceType) {
    case 'AllergyIntolerance': {
      const reactions = r.reaction as { manifestation?: Coded[] }[] | undefined;
      const manifestation = codedText(reactions?.[0]?.manifestation?.[0]);
      const criticality = typeof r.criticality === 'string' ? r.criticality : undefined;
      return {
        title: codedText(r.code) ?? 'Allergy',
        detail: [manifestation, criticality ? `${criticality} risk` : undefined].filter(Boolean).join(' · ') || undefined,
        date: (r.recordedDate ?? r.onsetDateTime) as string | undefined,
        status,
      };
    }
    case 'MedicationRequest': {
      const instruction = (r.dosageInstruction as { text?: string; route?: Coded; timing?: { code?: Coded } }[] | undefined)?.[0];
      const route = codedText(instruction?.route);
      const timing = codedText(instruction?.timing?.code);
      return {
        title: codedText(r.medicationCodeableConcept) ?? (r.medicationReference as { display?: string })?.display ?? 'Medication',
        detail: instruction?.text,
        note: [route, timing].filter(Boolean).join(' · ') || undefined,
        date: r.authoredOn as string | undefined,
        status,
      };
    }
    case 'MedicationStatement':
    case 'MedicationDispense':
    case 'Medication': {
      const dosage = (r.dosage as { text?: string }[] | undefined)?.[0]?.text;
      return {
        title: codedText(r.medicationCodeableConcept) ?? (r.medicationReference as { display?: string })?.display ?? codedText(r.code) ?? 'Medication',
        detail: dosage,
        date: (r.effectiveDateTime ?? r.whenHandedOver) as string | undefined,
        status,
      };
    }
    case 'Condition':
      return {
        title: codedText(r.code) ?? 'Condition',
        detail: codedText(r.severity),
        date: (r.onsetDateTime ?? r.recordedDate) as string | undefined,
        status,
      };
    case 'Immunization':
      return {
        title: codedText(r.vaccineCode) ?? 'Vaccination',
        detail: (r.lotNumber as string | undefined) ? `Lot ${String(r.lotNumber)}` : undefined,
        date: r.occurrenceDateTime as string | undefined,
        status,
      };
    case 'Observation': {
      // A lab value without its reference range is not actionable by a
      // clinician who does not know this lab's units or normals.
      const range = (r.referenceRange as { low?: { value?: number; unit?: string }; high?: { value?: number; unit?: string }; text?: string }[] | undefined)?.[0];
      const rangeText =
        range?.text ??
        (range?.low?.value !== undefined || range?.high?.value !== undefined
          ? `Ref ${range?.low?.value ?? ''}–${range?.high?.value ?? ''}${range?.high?.unit ? ` ${range.high.unit}` : ''}`.trim()
          : undefined);
      const interpretation = codedText((r.interpretation as unknown[] | undefined)?.[0]);
      return {
        title: codedText(r.code) ?? 'Result',
        detail: valueText(r),
        note: [rangeText, interpretation].filter(Boolean).join(' · ') || undefined,
        // H/L/A/HH/LL are the HL7 abnormal codes; anything but N is worth a flag.
        abnormal: Boolean(interpretation) && !/^normal$/i.test(interpretation as string) && !/^N$/i.test(interpretation as string),
        date: (r.effectiveDateTime ?? r.issued) as string | undefined,
        status,
      };
    }
    case 'Encounter': {
      const period = r.period as { start?: string } | undefined;
      return {
        title: codedText((r.type as unknown[] | undefined)?.[0]) ?? 'Visit',
        detail: codedText((r.reasonCode as unknown[] | undefined)?.[0]),
        date: period?.start,
        status,
      };
    }
    default:
      return { title: codedText(r.code) ?? resource.resourceType, status };
  }
}
