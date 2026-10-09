# Fujiyama PSS API

Fujiyama integrations call PSS only. Delhivery credentials remain private in
the PSS Worker and are never sent to Fujiyama.

## Authentication

Use the one-time secret returned when Super Admin creates a live API key for
the Fujiyama client. Send it on every request as:

```http
Authorization: ApiKey <FUJIYAMA_PSS_LIVE_KEY>
```

The key must contain only these scopes:

- `tracking.read`
- `shipments.create`

The key is tenant-scoped to Fujiyama's client record. It cannot read or create
records for another client.

## Tracking

Tracking is read-only. PSS resolves the shipment within Fujiyama's tenant,
refreshes the assigned Delhivery account through the PSS Worker, persists any
normalized provider event, and returns the combined PSS history. Delhivery
credentials are never exposed to Fujiyama. A request for an unknown AWB
first checks the client's active Delhivery accounts directly; if Delhivery
returns a normalized result, it is returned with `source: "delhivery"` without
creating a PSS shipment. If neither PSS nor Delhivery finds it, the endpoint
returns HTTP 200 with `found: false` and an empty `events` array.

```bash
curl --fail-with-body --request GET \
  'https://pss-api.psslogisticsadmin.workers.dev/v1/fujiyama/tracking?trackingType=VENDOR-AWB&awb=314893714' \
  --header 'Authorization: ApiKey <FUJIYAMA_PSS_LIVE_KEY>'
```

The response is a normalized PSS response. Delhivery's raw response and
credentials are not exposed.

## Booking

Booking uses the same server-side PSS rate-card, wallet, audit, idempotency,
and Delhivery B2B flow as the client panel. Send a unique
`Idempotency-Key` for every booking attempt.

```bash
curl --fail-with-body --request POST \
  'https://pss-api.psslogisticsadmin.workers.dev/v1/fujiyama/bookings' \
  --header 'Authorization: ApiKey <FUJIYAMA_PSS_LIVE_KEY>' \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: fujiyama-order-<YOUR_UNIQUE_ID>' \
  --data '{
    "description": "Solar inverter",
    "origin": "New Delhi",
    "destination": "Mumbai",
    "origin_address": {
      "name": "Fujiyama Power Systems",
      "line": "53A/6 Rama Road Industrial Area",
      "city": "New Delhi",
      "state": "Delhi",
      "pincode": "110015",
      "phone": "<10_DIGIT_PHONE>"
    },
    "destination_address": {
      "name": "Consignee",
      "line": "Complete destination address",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001",
      "phone": "<10_DIGIT_PHONE>"
    },
    "consignee": "Consignee",
    "total_weight_kg": 20,
    "pieces": 1,
    "declared_value": 1000,
    "provider": "delhivery",
    "pricing_quote_id": "<OPTIONAL_PSS_QUOTE_ID>",
    "provider_account_id": "<OPTIONAL_ASSIGNED_DELHIVERY_ACCOUNT_ID>"
  }'
```

For production booking, Fujiyama should first request a PSS quote and send the
returned `pricing_quote_id`. The Worker recalculates and validates the quote
before debiting the Fujiyama wallet. The Delhivery/provider amount is never
returned as the client billing amount.

## Key lifecycle

Create and revoke keys from the Super Admin API-key workspace. Secrets are
shown once only; if a key is lost, revoke it and issue a replacement. Never
put a Delhivery token in Fujiyama's application.

## Local verification

From the `admin-pss` repository, run:

```bash
node worker/tools/fujiyama-contract-acceptance.mjs
node --experimental-strip-types worker/tools/pricing-engine-acceptance.mjs
```

The first command verifies the route, scope, tenant-isolation, reference
return, and documentation contract without contacting a courier or creating a
shipment.
