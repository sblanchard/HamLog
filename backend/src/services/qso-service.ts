import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { db } from '../db/pool.js';
import type { CreateQsoInput } from '../schemas/qso.schema.js';
import { isValidCallsign, isValidFrequency, normalizeCallsign } from '../schemas/field-formats.js';
import { adifRecordToQso, type AdifRecord } from './adif-parser.js';
import { lookupAndCreateContactInfo } from './contact-info-service.js';
import logger from '../logger.js';

export class DuplicateQsoError extends Error {
  constructor() {
    super('A QSO with the same callsign, time, band, and mode is already in the log');
    this.name = 'DuplicateQsoError';
  }
}

/**
 * Returns the QSO_ID of an existing contact that duplicates this one, or null.
 * A duplicate is the same user + callsign (case-insensitive) + UTC date/time to the
 * minute + band + mode. Band/mode are compared null-safe (`<=>`) so empty values
 * (stored as NULL by createContact) match each other.
 */
async function findDuplicateContactId(
  userId: number, callsign: string, utcDatetime: string,
  band: string | null, mode: string | null,
): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT QSO_ID FROM Contacts
      WHERE user_id = ?
        AND UPPER(QSO_Callsign) = UPPER(?)
        AND DATE_FORMAT(qso_datetime_utc, '%Y-%m-%d %H:%i')
          = DATE_FORMAT(?, '%Y-%m-%d %H:%i')
        AND band <=> ?
        AND mode <=> ?
      LIMIT 1`,
    [userId, callsign, utcDatetime, band, mode],
  );
  return Array.isArray(rows) && rows.length > 0 ? Number(rows[0].QSO_ID) : null;
}

export async function createContact(input: CreateQsoInput, userId: number): Promise<number> {
  const formatted = formatDate(input.date) + ' 00:00:00';
  const timeStr = input.time || '00:00';
  const utcDatetime = toUtcDatetime(input.date, timeStr);
  const freqDecimal = parseFrequency(input.frequency);

  const dup = await findDuplicateContactId(
    userId, input.callsign, utcDatetime, input.band || null, input.mode || null);
  if (dup !== null) throw new DuplicateQsoError();

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO Contacts
      (user_id, QSO_Date, QSO_MTZTime, QSO_Callsign, QSO_Frequency, QSO_Notes, QSO_Received, QSO_Sent,
       qso_datetime_utc, frequency_mhz, mode, band)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, formatted, timeStr, input.callsign, input.frequency, input.notes, input.received, input.sent,
     utcDatetime, freqDecimal, input.mode || null, input.band || null]
  );

  lookupAndCreateContactInfo(input.callsign).catch(err =>
    logger.warn({ err, callsign: input.callsign }, 'Background callsign lookup failed')
  );

  return result.insertId;
}

export interface ImportSkip {
  callsign: string;
  reason: string;
}

export interface ImportResult {
  importedIds: number[];
  skipped: ImportSkip[];
}

// Whole-file cap on the number of records per ADIF import (Data-quality F10). Tunable;
// overridable via MAX_IMPORT_RECORDS for tests/ops. This is the only input bound —
// the multer byte cap was removed (it rejected legitimate full-log imports) — so it
// gives an early, clear rejection instead of a confusing slow failure on a huge file.
export const MAX_IMPORT_RECORDS = 50000;

export class ImportLimitError extends Error {
  constructor(public readonly count: number, public readonly limit: number) {
    super(
      `ADIF file has ${count} records, exceeding the import limit of ${limit}. ` +
        `Split it into smaller files and import them separately.`,
    );
    this.name = 'ImportLimitError';
  }
}

/**
 * Import a batch of parsed ADIF records (Data-quality F9). Each record is validated
 * independently and a single bad record is SKIPPED-AND-REPORTED, never aborting the
 * whole batch — important when re-importing large or third-party logs. Lean-permissive:
 * empty frequency is allowed (band-only QSOs); only present-but-garbage is rejected.
 *
 * F10: an over-cap file is rejected up front (before any insert) rather than truncated.
 */
export async function importAdif(records: AdifRecord[], userId: number): Promise<ImportResult> {
  const limit = Number(process.env.MAX_IMPORT_RECORDS) || MAX_IMPORT_RECORDS;
  if (records.length > limit) {
    throw new ImportLimitError(records.length, limit);
  }

  const importedIds: number[] = [];
  const skipped: ImportSkip[] = [];

  for (const record of records) {
    const qso = adifRecordToQso(record);
    const rawCall = qso.callsign;

    if (!rawCall || !qso.date) {
      skipped.push({ callsign: rawCall || '(none)', reason: !rawCall ? 'missing callsign' : 'missing date' });
      continue;
    }
    if (!isValidCallsign(rawCall)) {
      skipped.push({ callsign: rawCall, reason: 'invalid callsign format' });
      continue;
    }
    if (qso.frequency && !isValidFrequency(qso.frequency)) {
      skipped.push({ callsign: rawCall, reason: 'invalid frequency' });
      continue;
    }

    try {
      const id = await createContact({
        date: qso.date,
        time: qso.time,
        callsign: normalizeCallsign(rawCall),
        frequency: qso.frequency,
        notes: qso.notes,
        received: qso.received,
        sent: qso.sent,
        mode: qso.mode,
        band: qso.band,
      }, userId);

      if (qso.potaParkId) {
        await createPotaQso(String(id), qso.potaParkId, qso.potaQsoType || '1');
      }
      importedIds.push(id);
    } catch (err) {
      if (err instanceof DuplicateQsoError) {
        skipped.push({ callsign: rawCall, reason: 'duplicate' });
      } else {
        logger.warn({ err, callsign: rawCall }, 'ADIF import: record failed, skipping');
        skipped.push({ callsign: rawCall, reason: 'insert failed' });
      }
    }
  }

  return { importedIds, skipped };
}

export async function verifyContactOwnership(qsoId: string, userId: number): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT QSO_ID FROM Contacts WHERE QSO_ID = ? AND user_id = ?',
    [qsoId, userId]
  );
  return rows.length > 0;
}

export async function createPotaQso(qsoId: string, parkId: string, qsoType: string): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    'INSERT INTO POTA_QSOs (QSO_ID, POTAPark_ID, QSO_Type) VALUES (?, ?, ?)',
    [qsoId, parkId, qsoType]
  );
  return result.insertId;
}

export async function createContestQso(qsoId: string, contestId: string, qsoNumber: string, exchangeData: string): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    'INSERT INTO Contest_QSOs (QSO_ID, CONTEST_ID, CONTEST_QSO_NUMBER, CONTEST_QSO_EXCHANGE_DATA) VALUES (?, ?, ?, ?)',
    [qsoId, contestId, qsoNumber, exchangeData]
  );
  return result.insertId;
}

export async function deleteContact(qsoId: string, userId: number): Promise<boolean> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [check] = await conn.execute<RowDataPacket[]>(
      'SELECT QSO_ID FROM Contacts WHERE QSO_ID = ? AND user_id = ?',
      [qsoId, userId]
    );
    if (check.length === 0) {
      await conn.rollback();
      return false;
    }

    await conn.execute('DELETE FROM POTA_QSOs WHERE QSO_ID = ?', [qsoId]);
    await conn.execute('DELETE FROM Contest_QSOs WHERE QSO_ID = ?', [qsoId]);
    await conn.execute('DELETE FROM Contacts WHERE QSO_ID = ? AND user_id = ?', [qsoId, userId]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getAllQsosWithPota(userId: number): Promise<RowDataPacket[]> {
  const [contacts] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM Contacts WHERE user_id = ? ORDER BY QSO_Date DESC, QSO_MTZTime DESC',
    [userId]
  );
  const [potaRows] = await db.execute<RowDataPacket[]>(
    `SELECT Contacts.*, POTA_QSOs.* FROM Contacts
     LEFT JOIN POTA_QSOs ON Contacts.QSO_ID = POTA_QSOs.QSO_ID
     WHERE Contacts.user_id = ?`,
    [userId]
  );

  return contacts.map(contact => {
    const relatedPota = potaRows
      .filter(row => row.QSO_ID === contact.QSO_ID)
      .map(({ POTA_QSO_ID, QSO_ID, POTAPark_ID, QSO_Type }) => ({
        POTA_QSO_ID, QSO_ID, POTAPark_ID, QSO_Type,
      }));
    return { ...contact, POTA_QSOs: relatedPota };
  });
}

export async function getQsosByCallsign(callsign: string, userId: number): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM Contacts WHERE QSO_Callsign = ? AND user_id = ? ORDER BY QSO_ID DESC',
    [callsign, userId]
  );
  return rows;
}

export async function getQsosByPark(parkId: string, userId: number): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT POTA_QSOs.*, Contacts.* FROM POTA_QSOs
     INNER JOIN Contacts ON POTA_QSOs.QSO_ID = Contacts.QSO_ID
     WHERE POTA_QSOs.POTAPark_ID = ? AND Contacts.user_id = ?
     ORDER BY POTA_QSOs.POTA_QSO_ID DESC`,
    [parkId, userId]
  );
  return rows;
}

export async function getQsosForExport(userId: number, parkFilter?: string): Promise<RowDataPacket[]> {
  if (parkFilter) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*, p.POTAPark_ID, p.QSO_Type AS POTA_QSO_Type
       FROM Contacts c
       LEFT JOIN POTA_QSOs p ON c.QSO_ID = p.QSO_ID
       WHERE p.POTAPark_ID = ? AND c.user_id = ?
       ORDER BY c.qso_datetime_utc DESC, c.QSO_Date DESC`,
      [parkFilter, userId]
    );
    return rows;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*, p.POTAPark_ID, p.QSO_Type AS POTA_QSO_Type
     FROM Contacts c
     LEFT JOIN POTA_QSOs p ON c.QSO_ID = p.QSO_ID
     WHERE c.user_id = ?
     ORDER BY c.qso_datetime_utc DESC, c.QSO_Date DESC`,
    [userId]
  );
  return rows;
}

export async function getQsosForMap(userId: number, from?: string, to?: string): Promise<RowDataPacket[]> {
  let query = `
    SELECT c.QSO_ID, c.QSO_Date, c.QSO_MTZTime, c.QSO_Callsign, c.QSO_Frequency,
           c.mode, c.band, ci.ContactInfo_Latitude, ci.ContactInfo_Longitude,
           ci.ContactInfo_Name, ci.ContactInfo_City, ci.ContactInfo_Country
    FROM Contacts c
    INNER JOIN ContactInfo ci ON c.QSO_Callsign = ci.ContactInfo_Callsign
    WHERE c.user_id = ?
      AND ci.ContactInfo_Latitude != ''
      AND ci.ContactInfo_Longitude != ''
      AND ci.ContactInfo_Latitude IS NOT NULL
      AND ci.ContactInfo_Longitude IS NOT NULL`;

  const params: (string | number)[] = [userId];

  if (from) {
    query += ' AND c.QSO_Date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND c.QSO_Date <= ?';
    params.push(to);
  }

  query += ' ORDER BY c.QSO_Date DESC, c.QSO_MTZTime DESC';

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return rows;
}

export async function getQsoCountForRange(userId: number, from?: string, to?: string): Promise<number> {
  let query = 'SELECT COUNT(*) AS count FROM Contacts WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (from) {
    query += ' AND QSO_Date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND QSO_Date <= ?';
    params.push(to);
  }

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  const row = rows[0] as RowDataPacket | undefined;
  return row != null ? Number(row.count) : 0;
}

function formatDate(inputString: string): string {
  const inputDate = new Date(inputString);
  if (isNaN(inputDate.getTime())) {
    throw new Error(`Invalid QSO date: ${inputString}`);
  }
  const year = inputDate.getFullYear();
  const month = String(inputDate.getMonth() + 1).padStart(2, '0');
  const day = String(inputDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toUtcDatetime(dateStr: string, timeStr: string): string {
  const date = formatDate(dateStr);
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return `${date} ${time}`;
}

function parseFrequency(freq: string): number | null {
  if (!freq) return null;
  const dotCount = (freq.match(/\./g) || []).length;
  const cleaned = dotCount >= 2
    ? freq.substring(0, freq.indexOf('.', freq.indexOf('.') + 1))
    : freq;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}
