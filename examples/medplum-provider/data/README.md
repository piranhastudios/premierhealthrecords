# Premier Health provider app data

FHIR conformance resources that must be uploaded to the Medplum server for the
provider app to work correctly.

## premier-health-patient.json

`StructureDefinition` profile on FHIR R4 `Patient`
(`https://premierhealth.cm/fhir/StructureDefinition/premier-health-patient`) used by the
patient create/edit form:

- `Patient.telecom` is mandatory (`min = 1`), and `Patient.telecom.value` is mandatory
  within each entry (`min = 1`) — a valueless telecom row does not satisfy the phone
  requirement.
- `Patient.deceased[x]` is removed from data entry (`max = 0`).
- The snapshot element order drives the form field order: `name`, `birthDate`,
  `gender`, `telecom`, then all remaining fields. `multipleBirth[x]` is retained
  because twins are clinically significant.

The provider app requests this profile by URL (see
`src/pages/resource/utils.ts` `RESOURCE_PROFILE_URLS`). Until the profile is uploaded,
the patient create/edit form shows a yellow warning and falls back to the base FHIR
form — which silently drops the constraints above, so make sure the profile is
installed.

### Upload

Scripted and idempotent: `node scripts/seed-profiles.mjs [--base ... --email ...
--password ...]` (repo root) — also run as part of `scripts/seed-cameroon.mjs` on
every `scripts/dev.sh`. The manual CLI equivalent, after `npx medplum login`:

```bash
npx medplum put 'StructureDefinition?url=https://premierhealth.cm/fhir/StructureDefinition/premier-health-patient' "$(cat premier-health-patient.json)"
```

Note: the CLI `put` command takes the JSON body as a string argument (there is no
`@file` syntax), hence the `"$(cat ...)"`.

### Regenerating

The snapshot is derived from the base R4 Patient snapshot in
`packages/definitions/dist/fhir/r4/profiles-resources.json` with the two constraints
applied and the top-level element subtrees reordered. If you edit the profile, keep
each BackboneElement subtree (`contact.*`, `communication.*`, `link.*`) contiguous
and immediately after its parent element — the Medplum schema parser
(`parseStructureDefinition`) relies on document order to detect nested types.
