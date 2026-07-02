# Premier Health provider app data

FHIR conformance resources that must be uploaded to the Medplum server for the
provider app to work correctly.

## premier-health-patient.json

`StructureDefinition` profile on FHIR R4 `Patient`
(`https://premierhealth.cm/fhir/StructureDefinition/premier-health-patient`) used by the
patient create/edit form:

- `Patient.telecom` is mandatory (`min = 1`) — every patient needs a phone number.
- `Patient.deceased[x]` is removed from data entry (`max = 0`).
- The snapshot element order drives the form field order: `name`, `birthDate`,
  `gender`, `telecom`, then all remaining fields. `multipleBirth[x]` is retained
  because twins are clinically significant.

The provider app requests this profile by URL (see
`src/pages/resource/utils.ts` `RESOURCE_PROFILE_URLS`). Until the profile is uploaded,
the patient create/edit form shows a red "Not found" alert
("Could not find the Premier Health Patient Profile") instead of the form.

### Upload

Idempotent conditional update by canonical URL (creates the resource on first run,
updates it in place on subsequent runs). Run from this directory with the
[Medplum CLI](https://www.medplum.com/docs/cli) after `npx medplum login`:

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
