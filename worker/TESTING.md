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
application should provide mocked KYC responses and mocked OTP verification in
the test harness. Never point this fixture at the production Worker or a live
Delhivery account.

## Provider boundary

KYC approval in this mode only unlocks the application flow. A booking test
must still use a provider sandbox/mock adapter with deterministic LR/AWB,
tracking, weight, and pickup responses. Do not enable production provider
creation flags for this fixture.
