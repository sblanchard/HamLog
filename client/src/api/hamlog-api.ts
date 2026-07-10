import axios from 'axios';
import config from '../config';
import type { Contact, ContactInfo, MapData } from '../types/qso';

const client = axios.create({
  baseURL: config.ApiBaseUrl,
});

client.interceptors.request.use(cfg => {
  const token = localStorage.getItem('hamlog_token');
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

client.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !err.config.url?.includes('/auth/')) {
      localStorage.removeItem('hamlog_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/**
 * Server-provided error message from a failed request, or null if the failure
 * carried none (network error, crash). Backend errors are sanitized messages
 * safe to show the user (e.g. the ADIF import record-cap rejection).
 */
export function apiErrorMessage(err: unknown): string | null {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.error;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return null;
}

interface AuthResponse {
  token: string;
  user: { id: number; username: string; callsign: string };
}

interface UserProfile {
  userId: number;
  username: string;
  callsign: string;
}

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  const res = await client.post('/auth/login', { username, password });
  return res.data;
}

export async function registerUser(username: string, password: string, callsign: string): Promise<AuthResponse> {
  const res = await client.post('/auth/register', { username, password, callsign });
  return res.data;
}

export async function getMe(token?: string): Promise<UserProfile> {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await client.get('/auth/me', { headers });
  return res.data;
}

interface CreateQsoData {
  date: string;
  time: string;
  callsign: string;
  frequency: string;
  notes: string;
  received: string;
  sent: string;
  mode?: string;
  band?: string;
}

interface CreateContactInfoData {
  callsign: string;
  name: string;
  street: string;
  city: string;
  state: string;
  addressCountry: string;
  latitude: string;
  longitude: string;
  itu: string;
  grid: string;
  qth: string;
  country: string;
}

export async function getQsos(): Promise<Contact[]> {
  const res = await client.get('/qsos');
  return res.data;
}

export async function getQsosByCallsign(callsign: string): Promise<Contact[]> {
  const res = await client.get('/qsos', { params: { callsign } });
  return res.data.Contacts;
}

export async function getQsosByPark(park: string): Promise<Contact[]> {
  const res = await client.get('/qsos', { params: { park } });
  return res.data.Contacts;
}

export async function createQso(data: CreateQsoData): Promise<{ id: number }> {
  const res = await client.post('/qsos', data);
  return res.data;
}

export async function createPotaQso(qsoId: number, parkId: string, qsoType: string): Promise<{ id: number }> {
  const res = await client.post(`/qsos/${qsoId}/pota`, { parkId, qsoType });
  return res.data;
}

export async function createContestQso(qsoId: number, contestId: string, qsoNumber: string, exchangeData: string): Promise<{ id: number }> {
  const res = await client.post(`/qsos/${qsoId}/contest`, { contestId, qsoNumber, exchangeData });
  return res.data;
}

export async function deleteQso(id: number): Promise<{ deleted: boolean }> {
  const res = await client.delete(`/qsos/${id}`);
  return res.data;
}

export async function getContactInfo(callsign: string): Promise<ContactInfo[]> {
  const res = await client.get(`/contact-info/${callsign}`);
  return res.data.Contacts;
}

export async function contactInfoExists(callsign: string): Promise<boolean> {
  const res = await client.get(`/contact-info/${callsign}/exists`);
  return res.data.exists;
}

export async function createContactInfo(data: CreateContactInfoData): Promise<{ id?: number; skipped?: boolean }> {
  const res = await client.post('/contact-info', data);
  return res.data;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportAdif(park?: string): Promise<void> {
  const params = park ? { park } : {};
  const res = await client.get('/qsos/export', { params, responseType: 'blob' });
  triggerDownload(res.data, 'hamlog-export.adi');
}

function formatDateForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function downloadJsonBackup(): Promise<void> {
  const res = await client.get('/backup/json', { responseType: 'blob' });
  triggerDownload(res.data, `hamlog-backup-${formatDateForFilename()}.json`);
}

export async function downloadAdifBackup(): Promise<void> {
  const res = await client.get('/backup/adif', { responseType: 'blob' });
  triggerDownload(res.data, `hamlog-backup-${formatDateForFilename()}.adi`);
}

export async function getMapData(from?: string, to?: string): Promise<MapData> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const res = await client.get('/qsos/map', { params });
  return { markers: res.data.markers, total: res.data.total };
}

export async function triggerCallsignLookup(callsign: string): Promise<void> {
  await client.post('/contact-info/lookup', { callsign });
}

export async function backfillCallsignData(): Promise<{ total: number; updated: number; failed: number }> {
  const res = await client.post('/contact-info/backfill');
  return res.data;
}

export async function importAdif(file: File): Promise<{
  imported: number;
  ids: number[];
  skipped: number;
  skippedRecords: Array<{ callsign: string; reason: string }>;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await client.post('/qsos/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}
