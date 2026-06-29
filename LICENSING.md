# Licensing

Premier Health EHR is a derivative work of [Medplum](https://www.medplum.com/)
and combines two categories of code under **different licenses**. This document
explains which terms apply where.

## Summary

| Category | License | Governing file |
|---|---|---|
| Medplum-derived code (the original work and modifications to it) | Apache License 2.0 | [`LICENSE.txt`](./LICENSE.txt), [`NOTICE`](./NOTICE) |
| Code newly developed by Piranha Studios | Proprietary | [`LICENSE-PREMIER.txt`](./LICENSE-PREMIER.txt) |

Your own proprietary code remains **closed**. The only obligations carried by
Apache 2.0 are attribution (keeping `LICENSE.txt` and `NOTICE`) and noting that
files were modified — not source disclosure.

## 1. Medplum-derived code — Apache License 2.0

The portions of this product derived from Medplum, including any modifications
Piranha Studios has made to Medplum's original files, remain licensed under the
Apache License, Version 2.0. When distributing the software (for example, an
on-premise install at a licensed clinic), you must:

1. Include a copy of `LICENSE.txt` (Apache 2.0).
2. Include the `NOTICE` file and its attribution contents.
3. Retain Medplum's existing copyright/attribution headers in those files.
4. Note that files have been modified (covered by the statement in `NOTICE`).
5. Use only Premier Health branding — not Medplum's trademarks.

> Note: "distribution" means handing the code or binaries to another party
> (e.g. on-premise deployment). Running the software as a hosted service that
> clinics merely access over the network is **not** distribution and does not
> trigger these obligations.

## 2. Piranha Studios proprietary code — Proprietary

All code, configuration, designs, and assets authored by Piranha Studios that
are **not** derived from Medplum or other open-source works are proprietary and
licensed under [`LICENSE-PREMIER.txt`](./LICENSE-PREMIER.txt). They are owned by
Piranha Studios and provided to licensed clinics for internal use only, under a
separate written agreement.

## How to tell which is which

- **Files with a Medplum copyright header** (or your edits to such files) →
  Apache 2.0.
- **New files authored by Piranha Studios** → proprietary. Going forward, new
  proprietary source files should carry the header below so the boundary stays
  unambiguous.

### Proprietary file header

Add to new source files authored from scratch by Piranha Studios:

```
Copyright © 2026 Piranha Studios. All rights reserved.
Proprietary and confidential. Licensed under LICENSE-PREMIER.txt.
SPDX-License-Identifier: LicenseRef-Premier-Proprietary
```

(Adapt the comment syntax to the file's language, e.g. `//`, `#`, or `<!-- -->`.)

---

This document is a plain-language summary to keep the licensing boundary clear;
it is not a substitute for the license texts themselves or for legal advice.
For licensing inquiries: info@piranha-studios.co.uk
