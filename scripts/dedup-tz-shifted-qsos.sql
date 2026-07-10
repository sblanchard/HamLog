-- One-off dedup of timezone-shifted duplicate QSOs. Ran 2026-07-10 against the
-- live DB (backup: ~/hamlog-backups/backup-pre-dedup-20260710-1414.sql).
--
-- Situation: a 24,868-row ADIF import contained the log twice — one export
-- with true UTC times, one with Central European local times written as UTC
-- (plus ~2.5k rows double-shifted from an earlier bad merge). Import dedup
-- can't catch these: the timestamps genuinely differ.
--
-- Rule: a row is a shifted copy when another row exists with identical
-- callsign, band, mode, frequency and both signal reports, whose DST-aware
-- Europe/Berlin local rendering equals this row's timestamp. The earlier
-- (true-UTC) row is kept. Requires MySQL tz tables (CONVERT_TZ).
--
-- Result: 13,565 copies deleted, 11,303 QSOs kept. 208 unique rows from the
-- local-time export remain with likely +1/-2h-off times (no twin to verify
-- against, left untouched).
--
-- BACKUP FIRST: mysqldump HamLogDB > backup-YYYYMMDD-HHMM.sql

START TRANSACTION;

CREATE TEMPORARY TABLE dedup_ids AS
SELECT DISTINCT b.QSO_ID AS id
FROM Contacts a
JOIN Contacts b
  ON a.user_id = b.user_id
  AND a.QSO_Callsign = b.QSO_Callsign
  AND a.band <=> b.band
  AND a.mode <=> b.mode
  AND a.frequency_mhz <=> b.frequency_mhz
  AND a.QSO_Sent <=> b.QSO_Sent
  AND a.QSO_Received <=> b.QSO_Received
  AND b.QSO_ID <> a.QSO_ID
  AND b.qso_datetime_utc = CONVERT_TZ(a.qso_datetime_utc, 'UTC', 'Europe/Berlin');

-- Eyeball this count before deleting.
SELECT COUNT(*) AS ids_to_delete FROM dedup_ids;

DELETE FROM Contacts WHERE QSO_ID IN (SELECT id FROM dedup_ids);

SELECT COUNT(*) AS remaining FROM Contacts;

COMMIT;

-- Verify: all must return 0 (and the table count must match expectations).
SELECT COUNT(*) AS remaining_shift_pairs
FROM Contacts a
JOIN Contacts b
  ON a.user_id = b.user_id
  AND a.QSO_Callsign = b.QSO_Callsign
  AND a.band <=> b.band
  AND a.mode <=> b.mode
  AND a.frequency_mhz <=> b.frequency_mhz
  AND a.QSO_Sent <=> b.QSO_Sent
  AND a.QSO_Received <=> b.QSO_Received
  AND b.QSO_ID <> a.QSO_ID
  AND b.qso_datetime_utc = CONVERT_TZ(a.qso_datetime_utc, 'UTC', 'Europe/Berlin');

SELECT COUNT(*) AS orphaned_pota
FROM POTA_QSOs p
LEFT JOIN Contacts c ON c.QSO_ID = p.QSO_ID
WHERE c.QSO_ID IS NULL;
