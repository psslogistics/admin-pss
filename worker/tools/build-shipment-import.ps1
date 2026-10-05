param(
  [Parameter(Mandatory = $true)][string]$CsvPath,
  [Parameter(Mandatory = $true)][string]$OutputSql,
  [string]$ClientId = '515f3d94-496d-4376-84e4-84d70d9fc068',
  [string]$ProviderAccountId = 'dlv-psschandigarhcargo6-b2bc'
)

$ErrorActionPreference = 'Stop'
$rows = Import-Csv -LiteralPath $CsvPath
$orderCounts = @{}
foreach ($sourceRow in $rows) {
  $sourceOrder = ([string]$sourceRow.'Order id').Trim()
  if ($sourceOrder) {
    $priorCount = if ($orderCounts.ContainsKey($sourceOrder)) { $orderCounts[$sourceOrder] } else { 0 }
    $orderCounts[$sourceOrder] = 1 + $priorCount
  }
}
$existingShipmentIds = @('b05c512f-78e7-40c6-845e-16e80bb47783')
$provider = 'delhivery'
$actor = 'system:csv-import:psschandigarhcargo6-b2bc'

function Sql([AllowNull()][object]$Value) {
  if ($null -eq $Value) { return 'NULL' }
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return 'NULL' }
  return "'" + $text.Replace("'", "''") + "'"
}

function NumberOr([object]$Value, [double]$Fallback) {
  $number = 0.0
  if ([double]::TryParse(([string]$Value).Trim(), [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -and -not [double]::IsNaN($number) -and -not [double]::IsInfinity($number)) { return $number }
  return $Fallback
}

function DateIso([object]$Value) {
  $text = ([string]$Value).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $date = [datetime]::MinValue
  $formats = @('M/d/yyyy H:mm', 'M/d/yyyy HH:mm', 'M/d/yyyy', 'MM/dd/yyyy H:mm', 'yyyy-MM-dd')
  foreach ($format in $formats) {
    if ([datetime]::TryParseExact($text, $format, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal, [ref]$date)) { return $date.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') }
  }
  if ([datetime]::TryParse($text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal, [ref]$date)) { return $date.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') }
  return $null
}

function StableId([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 32)
}

function Status([string]$Value) {
  $normalized = if ($null -eq $Value) { '' } else { $Value.Trim().ToLowerInvariant() }
  switch ($normalized) {
    'delivered' { return 'delivered' }
    'rto' { return 'rto' }
    'in transit' { return 'in_transit' }
    'dispatched' { return 'in_transit' }
    'pending' { return 'exception' }
    'manifested' { return 'booked' }
    default { return 'exception' }
  }
}

$sql = [System.Collections.Generic.List[string]]::new()
$imported = 0
$skipped = 0
foreach ($row in $rows) {
  $orderId = ([string]$row.'Order id').Trim()
  if ([string]::IsNullOrWhiteSpace($orderId)) { $skipped++; continue }
  $shipmentId = $orderId
  if ($existingShipmentIds -contains $shipmentId) { $skipped++; continue }
  if ($shipmentId -notmatch '^[0-9a-fA-F-]{20,}$') { $shipmentId = 'csv-psschandigarhcargo6-' + (StableId "$orderId|$(([string]$row.LRN).Trim())") }
  $lrn = ([string]$row.LRN).Trim()
  $status = Status $row.'Current Status'
  $weight = [math]::Max(0.001, (NumberOr $row.Weight 0.001))
  $pieces = [math]::Max(1, [int][math]::Round((NumberOr $row.'No of boxes' 1)))
  $declared = [math]::Max(0, (NumberOr $row.'Package Amount' 0))
  $origin = ([string]$row.'Origin City').Trim()
  $destination = ([string]$row.'Destination City').Trim()
  $state = ([string]$row.State).Trim()
  $pin = ([string]$row.'Pin code').Trim()
  $consignee = ([string]$row.'Consignee name').Trim()
  $pickupAddress = ([string]$row.'Pick up Address').Trim()
  $remarks = ([string]$row.Remarks).Trim()
  $invoice = ([string]$row.'Invoice Number').Trim().TrimStart('`')
  $payment = ([string]$row.'Payment Type').Trim()
  $description = ("Imported shipment {0} | Invoice {1} | Payment {2} | {3}" -f $orderId, $invoice, $payment, $remarks).Trim()
  if ($description.Length -gt 500) { $description = $description.Substring(0, 500) }
  $destAddress = @{ name = $consignee; address = ''; city = $destination; state = $state; country = 'India'; pincode = $pin }
  $originAddress = @{ name = ([string]$row.'Client Location/warehouse').Trim(); address = $pickupAddress; city = $origin; state = ''; country = 'India'; pincode = '' }
  $eventTime = DateIso $row.'Last Scan Date'
  if (-not $eventTime) { $eventTime = DateIso $row.'Delivered Date' }
  $deliveredAt = if ($status -eq 'delivered') { DateIso $row.'Delivered Date' } else { $null }
  $pssReference = $orderId
  if ($orderCounts[$orderId] -gt 1) { $pssReference = "$orderId-$lrn" }
  if ([string]::IsNullOrWhiteSpace($pssReference)) { $pssReference = "CSV-$shipmentId" }
  $sql.Add(("INSERT OR IGNORE INTO shipments (id, client_id, created_by_user_id, provider, provider_reference, tracking_number, status, description, origin, destination, origin_address_json, destination_address_json, consignee, total_weight_kg, declared_value, pieces, edd, delivered_at, provider_account_id, pss_reference) VALUES ({0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16},{17},{18},{19});" -f (Sql $shipmentId),(Sql $ClientId),(Sql $actor),(Sql $provider),(Sql $(if ($lrn) {$lrn} else {$null})),(Sql $(if ($lrn) {$lrn} else {$null})),(Sql $status),(Sql $description),(Sql $origin),(Sql $destination),(Sql ((ConvertTo-Json $originAddress -Compress))),(Sql ((ConvertTo-Json $destAddress -Compress))),(Sql $consignee),$weight,$declared,$pieces,(Sql (DateIso $row.'Expected Date')),(Sql $deliveredAt),(Sql $ProviderAccountId),(Sql $pssReference)))
  $eventDescription = ("{0}; {1}; Dispatches: {2}; Attempts: {3}; Payment: {4}" -f $remarks, ([string]$row.'Last Scan Location').Trim(), ([string]$row.'Dispatch Count').Trim(), ([string]$row.'Attempt Count').Trim(), $payment).Trim()
  if ($eventDescription.Length -gt 500) { $eventDescription = $eventDescription.Substring(0, 500) }
  $eventId = 'csv-event-' + $shipmentId
  $sql.Add(("INSERT OR IGNORE INTO tracking_events (id, shipment_id, status, location, description, created_by_user_id, event_time, created_at) VALUES ({0},{1},{2},{3},{4},{5},{6},CURRENT_TIMESTAMP);" -f (Sql $eventId),(Sql $shipmentId),(Sql $status),(Sql (([string]$row.'Last Scan Location').Trim())),(Sql $eventDescription),(Sql $actor),(Sql $eventTime)))
  $imported++
}
Set-Content -LiteralPath $OutputSql -Value ($sql -join [Environment]::NewLine) -Encoding utf8
Write-Output ("rows={0}; skipped={1}; statements={2}; output={3}" -f $imported,$skipped,$sql.Count,$OutputSql)
