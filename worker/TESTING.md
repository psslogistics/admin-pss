# Non-production workflow testing

The Client booking flow can be exercised without real KYC documents or real
identity data, but only against a non-production Worker and an isolated test
data set.

## KYC fixture contract

Set these values only in the local/test or staging Worker environment:

```text
ENVIRONMENT=staging
KYC_TEST_MODE=true
```

The test client account must be explicitly classified with
`identity_environment = test`. The Worker requires every authenticated client
in scope to carry that classification; a mixed or missing classification fails
closed. The production Wrangler configuration intentionally does not enable
this mode.

The fixture does not store or upload GST, PAN, Aadhaar, documents, or OTPs. The
booking gate is satisfied by the Worker-side KYC fixture; no OTP is accepted or
persisted by this path. Never point this fixture at the production Worker or a
live Delhivery account.

## Provider boundary

KYC approval in this mode only unlocks the application flow. The provider
boundary now has a deterministic, network-free adapter for serviceability,
manifest/LR/AWB, tracking/weight, freight, and pickup operations. It is reached
only when all of these are true: Worker environment is `test` or `staging`,
`KYC_TEST_MODE=true`, and the scoped client account has
`identity_environment = test`. Do not enable production provider creation
flags for this fixture and do not add `KYC_TEST_MODE` to the production
Wrangler configuration.

## Local verification

Run the focused checks from `admin-pss`:

```text
node --experimental-strip-types --test worker/tools/kyc-test-identity.test.mjs worker/tools/provider-test-double.test.mjs
npx tsc --noEmit --pretty false
```

These tests prove the production gate and the deterministic provider contract;
they do not create a Delhivery shipment or charge a wallet.
