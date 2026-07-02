# Grants maintenance: revoking expired QR access grants

`Patient/$grant` gives a provider Organization time-boxed access to a patient's record: it
creates an active `Consent` (category `qr-access-grant`, bounded `provision.period`) and adds the
org to `meta.accounts` on the Patient and every resource in the patient compartment.

Expiry is enforced by revocation, which happens in two places:

1. **Opportunistically** — every `Patient/:id/$grant` call first revokes that patient's already
   expired grants.
2. **Globally** — the system-level `POST /fhir/R4/$revoke-expired-grants` operation
   (super-admin only) sweeps all expired, still-active grant Consents, removes the org from
   `meta.accounts` across each patient's entire compartment (the exact reverse of the grant
   propagation), and flips each Consent to `inactive`. It returns `Parameters` with a `revoked`
   integer count.

The opportunistic path alone is not sufficient — a grant for a patient who never calls `$grant`
again would otherwise linger. **Schedule the global sweep from an ops cron.**

## Manual invocation

```sh
curl -X POST 'https://records.premierhealth.cm/fhir/R4/$revoke-expired-grants' \
  -H "Authorization: Bearer $SUPER_ADMIN_ACCESS_TOKEN" \
  -H 'Content-Type: application/fhir+json'
```

## Cron example

Run every 5 minutes (grants are minute-granular; tighten the cadence if needed):

```cron
*/5 * * * * curl -fsS -X POST 'https://records.premierhealth.cm/fhir/R4/$revoke-expired-grants' -H "Authorization: Bearer $(cat /etc/premierhealth/superadmin-token)" -H 'Content-Type: application/fhir+json' >> /var/log/premierhealth/revoke-expired-grants.log 2>&1
```

Notes:

- The token must belong to a **super-admin** membership; other callers get `403 Forbidden`.
- The operation is idempotent — running it again immediately revokes nothing and returns
  `revoked: 0`.
- Implementation: `revokeExpiredGrants` in `packages/server/src/fhir/operations/grant.ts`.
