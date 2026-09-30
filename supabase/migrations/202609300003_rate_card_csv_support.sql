-- The pricing source workflow accepts the supplied CSV matrices as well as
-- PDF/XLSX source cards.
ALTER TABLE public.rate_cards DROP CONSTRAINT IF EXISTS rate_cards_mime_type_check;
ALTER TABLE public.rate_cards
  ADD CONSTRAINT rate_cards_mime_type_check CHECK (
    mime_type IN (
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  );

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
WHERE id = 'rate-cards';
