# Legal & Business Readiness Checklist — 2026-11-17

**Product scope lock:** cosmetics & FMCG wholesale only. Food sales stay
**disabled**; marketplace seller publishing stays disabled until the items
below are evidenced. This checklist asserts no legal conclusion — each item
needs documentary proof before it can be marked DONE. Nothing here invents
GSTINs, addresses, or approvals.

| # | Item | Status | Evidence / action needed |
|---|------|--------|--------------------------|
| 1 | GST registration & GSTIN displayed on invoices | ☐ PENDING | Owner to provide GSTIN certificate; wire into invoice template + `site_content` legal fields |
| 2 | HSN codes & GST rates per product | ☐ PENDING | HSN mapping for the live catalogue (cosmetics Ch. 33, FMCG varies); tax config review |
| 3 | Consumer grievance officer (name, email, phone, resolution SLA) published | ☐ PENDING | Consumer Protection (E-Commerce) Rules 2020 requirement; add to `/legal` pages |
| 4 | Privacy policy & terms of use — final legal text | ◐ PARTIAL | `/privacy`, `/legal` routes exist (0095 legal acceptance + privacy requests); text needs owner/counsel sign-off |
| 5 | Refund, cancellation, return & delivery policies | ◐ PARTIAL | `/returns`, `/shipping` pages exist; confirm content matches actual operations |
| 6 | Seller agreement & seller KYC | ◐ PARTIAL | 0098 seller agreement acceptance + marketplace gate exist in code; the agreement TEXT and KYC document set (PAN, GST, bank proof) need owner approval |
| 7 | Marketplace TCS (Income-tax §52-O) / TDS (§194-O) applicability review | ☐ PENDING | Applies once third-party sellers transact; CA opinion needed BEFORE enabling seller payouts |
| 8 | Prohibited/restricted product controls | ◐ PARTIAL | Super Admin moderation + prohibited-offer removal enforced (0109); publish a written prohibited-products policy |
| 9 | Cosmetics regulatory check (Drugs & Cosmetics Act labeling, manufacturer details on pack) | ☐ PENDING | Confirm supplier invoices/labels carry mandatory declarations |
| 10 | Data retention & privacy obligations (DPDP Act 2023) | ◐ PARTIAL | 0084/0055 retention jobs + 0095 privacy requests implemented; publish retention schedule in privacy policy |
| 11 | Payment collection | ☐ DISABLED BY DESIGN | Membership/ad live payments hard-blocked in DB (`live_payment_collection_enabled = false` CHECKs, 0109). Enable only after gateway agreement + owner approval |
| 12 | Marketplace seller registration/publishing | ☐ DISABLED BY DESIGN | Invite-only sellers (0070/0072), marketplace gate (0098), ad gate (0109). Keep OFF until items 1, 3, 6, 7 are DONE |

**Rule for go-live:** a ☐/◐ above is a blocker for the corresponding
revenue/marketplace feature, not for the B2B ordering site itself. Do not mark
this platform "legally ready" while any row lacks documentary evidence.
