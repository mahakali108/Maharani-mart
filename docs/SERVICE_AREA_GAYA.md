# Gaya district default — configuration is not coverage

The PWA now labels its default service district as **Gaya, Bihar, India**. Migration
0071 changes only the default value for *new* `areas` records. It does not rewrite
existing service areas, retailer addresses, or orders.

There is no verified Gaya PIN-code/locality coverage list in this repository.
Therefore this change does **not** declare all of Gaya serviceable. Before enabling
orders, an authorized operator must review the actual configured active areas and
set up the supported localities/PIN codes and any delivery charges/minimums from
verified business information. Do not infer coverage from the district default.

The existing admin service-area controls manage named `areas`; they do not yet
provide postcode-level coverage, delivery-fee, or minimum-order configuration.
Those controls are a remaining product/database task and must be built and tested
before promising PIN-specific serviceability.

`docs/SERVICE_AREA_SARAN.md` records the earlier Saran default and is retained as
historical decision context; migration 0071 is the later forward-only default.
