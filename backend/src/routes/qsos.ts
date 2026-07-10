import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validate.js';
import { createQsoSchema, createPotaQsoSchema, createContestQsoSchema } from '../schemas/qso.schema.js';
import { mapQuerySchema } from '../schemas/map.schema.js';
import {
  createContact, createPotaQso, createContestQso,
  deleteContact, getAllQsosWithPota,
  getQsosByCallsign, getQsosByPark, getQsosForExport,
  getQsosForMap, getQsoCountForRange, verifyContactOwnership,
  importAdif, ImportLimitError, DuplicateQsoError,
} from '../services/qso-service.js';
import { parseAdif } from '../services/adif-parser.js';
import { exportAdif } from '../services/adif-exporter.js';

const router = Router();
// No byte cap on uploads (operator decision, 2026-07): full-log ADIF imports exceed
// any guessed size. MAX_IMPORT_RECORDS in qso-service is the input bound.
const upload = multer({ storage: multer.memoryStorage() });

router.get('/export', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const park = typeof req.query.park === 'string' ? req.query.park : undefined;
    const rows = await getQsosForExport(req.user!.userId, park);
    const adif = exportAdif(rows, park);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="hamlog-export.adi"`);
    res.send(adif);
  } catch (err) {
    next(err);
  }
});

router.post('/import', requireAuth, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const userId = req.user!.userId;
    const content = req.file.buffer.toString('utf-8');
    const records = parseAdif(content);

    const { importedIds, skipped } = await importAdif(records, userId);

    res.status(201).json({
      imported: importedIds.length,
      ids: importedIds,
      skipped: skipped.length,
      skippedRecords: skipped,
    });
  } catch (err) {
    if (err instanceof ImportLimitError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/map', requireAuth, validateQuery(mapQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const [rows, total] = await Promise.all([
      getQsosForMap(req.user!.userId, from, to),
      getQsoCountForRange(req.user!.userId, from, to),
    ]);

    const markers = rows.map(r => ({
      qsoId: r.QSO_ID,
      callsign: r.QSO_Callsign,
      date: r.QSO_Date,
      time: r.QSO_MTZTime,
      frequency: r.QSO_Frequency,
      mode: r.mode || null,
      band: r.band || null,
      lat: parseFloat(r.ContactInfo_Latitude),
      lng: parseFloat(r.ContactInfo_Longitude),
      name: r.ContactInfo_Name || '',
      city: r.ContactInfo_City || '',
      country: r.ContactInfo_Country || '',
    })).filter(m => !isNaN(m.lat) && !isNaN(m.lng));

    res.json({ markers, total });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { callsign, park } = req.query;

    if (typeof callsign === 'string') {
      const rows = await getQsosByCallsign(callsign, userId);
      return res.json({ Contacts: rows });
    }

    if (typeof park === 'string') {
      const rows = await getQsosByPark(park, userId);
      return res.json({ Contacts: rows });
    }

    const result = await getAllQsosWithPota(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, validate(createQsoSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await createContact(req.body, req.user!.userId);
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof DuplicateQsoError) {
      res.status(409).json({ error: 'Duplicate QSO: this contact is already logged' });
      return;
    }
    next(err);
  }
});

router.post('/:id/pota', requireAuth, validate(createPotaQsoSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owns = await verifyContactOwnership(req.params.id as string, req.user!.userId);
    if (!owns) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const potaId = await createPotaQso(req.params.id as string, req.body.parkId, req.body.qsoType);
    res.status(201).json({ id: potaId });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/contest', requireAuth, validate(createContestQsoSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owns = await verifyContactOwnership(req.params.id as string, req.user!.userId);
    if (!owns) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    const contestQsoId = await createContestQso(req.params.id as string, req.body.contestId, req.body.qsoNumber, req.body.exchangeData);
    res.status(201).json({ id: contestQsoId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await deleteContact(req.params.id as string, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
