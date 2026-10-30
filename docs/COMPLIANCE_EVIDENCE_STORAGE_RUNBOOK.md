# Compliance evidence Storage — Phase 2D.1 review runbook

> Design and migration source only. Nothing in this document authorizes a remote
> bucket change, document upload, production migration, or evidence collection.

## Intended private bucket contract

Migration `0087_phase_2d1_compliance_security_and_evidence_storage.sql` defines one
private bucket: `compliance-evidence`.

The migration uses the same 10 MiB image/PDF boundary already used by the
repository's private retailer and supplier document buckets. It fails loudly if
an existing bucket with this ID is public or differs from that allowlist. The
release owner must explicitly confirm that this technical limit and the bucket
identifier remain appropriate before applying any migration; do not change them
informally in the Storage dashboard.

Accepted MIME types:

- `image/png`
- `image/jpeg`
- `image/webp`
- `application/pdf`

No public bucket, public object URL, browser-controlled object path, update
policy, or delete policy is part of this design.

## Canonical object paths

Object paths contain only subject UUIDs, controlled evidence-type labels, and a
random UUID filename. They must never contain a person name, PAN, GSTIN,
business name, user filename, bank detail, or review information.

- Centrally held product evidence:
  `products/<product-id>/central/<evidence-type>/<object-id>.<extension>`
- Seller-provided product evidence:
  `products/<product-id>/sellers/<seller-id>/<evidence-type>/<object-id>.<extension>`
- Seller evidence:
  `sellers/<seller-id>/<evidence-type>/<object-id>.<extension>`

The database rejects new evidence metadata that is not bound to this bucket,
these layouts, and an allowed MIME/extension pair. Existing Phase 2D metadata
with no bucket binding is retained unchanged and must be reviewed separately;
it is not silently claimed to be safely stored in this bucket.

## Access model

- **Anonymous:** no bucket read, insert, update, or delete access.
- **Seller:** may upload only into their own canonical seller-owned path; may
  read only evidence metadata/object paths tied to their own seller identity.
- **Super Admin:** may review canonical evidence objects and metadata.
- **Other authenticated roles:** no evidence object access.
- **Deletion/replacement:** intentionally unavailable from browser/API Storage
  policies. Any future retention or correction process needs a separate,
  owner-approved server-side design that preserves audit requirements.

The server-only helper `lib/compliance/evidence-storage.ts` validates the
received file name, size, MIME type, and canonical path inputs before upload,
uses the caller-scoped write authorization predicate, and disallows object
replacement. It also mints a fixed five-minute signed URL only after the caller
passes the same Database authorization predicate used by the Storage read
policy. No helper caller may supply a longer lifetime.

## Rollback strategy

There is intentionally no destructive down migration. If an authorized staging
or release rollback is needed, use a separately reviewed **forward** corrective
migration that:

1. disables the new write path or restores only the prior function/policy
   behavior after taking a schema/ACL snapshot;
2. retains `product_compliance_reviews`, `seller_compliance_reviews`, both audit
   tables, all evidence metadata, and every Storage object;
3. leaves the evidence bucket private and its public-object prohibition intact;
4. does not reclassify, activate, publish, delete, or rewrite products, sellers,
   offers, historical orders, or fulfilment records; and
5. keeps stale/unreviewed products and sellers fail-closed until the owner
   approves a replacement safety design.

Never "roll back" by deleting review evidence/audit records or by changing the
bucket to public. A rollback that re-enables legacy sale eligibility needs a
separate owner risk decision because it could re-expose unreviewed records.

## Required isolated-staging verification before any rollout

1. Confirm `storage.buckets` marks `compliance-evidence` as private and has the
   expected MIME/size configuration.
2. Confirm `storage.objects` policies deny anon, unrelated authenticated users,
   and a second seller.
3. Confirm the owning seller and an authenticated Super Admin receive only the
   expected access.
4. Confirm direct public URLs fail and signed URLs expire.
5. Confirm an unsupported type, over-limit file, mismatched extension, non-
   canonical key, and cross-seller key are rejected before metadata is accepted.
6. Confirm existing evidence metadata has either been owner-reviewed/migrated
   through an authorized process or remains unavailable; never silently rewrite
   historical object locations.
