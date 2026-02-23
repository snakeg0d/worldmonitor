import type { NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { dataFreshness } from './data-freshness';
import { inferGeoHubsFromTitle } from './geo-hub-index';
import { classifyByKeyword as classifyThreatByKeyword } from './threat-classifier';

export interface TelegramMessage {
  chatName: string;
  text: string;
  category: string;
  sender: string;
  date: string;
  matchedMarketId?: string;
}

const TELEGRAM_CACHE_TTL_MS = 5 * 60 * 1000;
const TELEGRAM_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TELEGRAM_OSINT_URL = (import.meta.env.VITE_TELEGRAM_OSINT_URL as string | undefined)?.trim() || '';
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  UA: 'Ukraine',
  RU: 'Russia',
  IR: 'Iran',
  IL: 'Israel',
};

let cachedMessages: { items: TelegramMessage[]; timestamp: number } | null = null;
let inFlight: Promise<TelegramMessage[]> | null = null;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let pollUrl = '';

function resolveUrl(url: string): string {
  const explicit = url.trim();
  if (explicit) return explicit;
  return DEFAULT_TELEGRAM_OSINT_URL;
}

function normalizeCountryCodes(text: string): string {
  let normalized = text;
  for (const [code, country] of Object.entries(COUNTRY_CODE_ALIASES)) {
    normalized = normalized.replace(new RegExp(`\\b${code}\\b`, 'gi'), country);
  }
  return normalized;
}

function toTitle(rawText: string): string {
  const normalized = normalizeCountryCodes(rawText).replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Telegram OSINT update';
  return normalized.slice(0, 180);
}

function parseTelegramPayload(payload: unknown): TelegramMessage[] {
  if (!Array.isArray(payload)) return [];
  const messages: TelegramMessage[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const chatName = typeof (item as { chatName?: unknown }).chatName === 'string' ? (item as { chatName: string }).chatName : '';
    const text = typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : '';
    const category = typeof (item as { category?: unknown }).category === 'string' ? (item as { category: string }).category : 'other';
    const sender = typeof (item as { sender?: unknown }).sender === 'string' ? (item as { sender: string }).sender : '';
    const date = typeof (item as { date?: unknown }).date === 'string' ? (item as { date: string }).date : '';
    const matchedMarketId = typeof (item as { matchedMarketId?: unknown }).matchedMarketId === 'string'
      ? (item as { matchedMarketId: string }).matchedMarketId
      : undefined;
    if (!text || !date) continue;
    messages.push({
      chatName,
      text,
      category,
      sender,
      date,
      matchedMarketId,
    });
  }
  return messages;
}

function toNewsItem(message: TelegramMessage, index: number): NewsItem {
  const title = toTitle(message.text);
  const parsedDate = new Date(message.date);
  const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const threat = classifyThreatByKeyword(title, SITE_VARIANT);
  const isAlert = threat.level === 'critical' || threat.level === 'high';
  const topGeo = inferGeoHubsFromTitle(title)[0];
  const syntheticLink = `telegram://${encodeURIComponent(message.chatName || 'osint')}/${encodeURIComponent(message.date)}/${index}`;

  return {
    source: 'Telegram OSINT',
    title,
    link: syntheticLink,
    pubDate,
    isAlert,
    threat,
    ...(topGeo && { lat: topGeo.hub.lat, lon: topGeo.hub.lon, locationName: topGeo.hub.name }),
  };
}

export function classifyByKeyword(messages: TelegramMessage[]): NewsItem[] {
  return messages.map((message, index) => toNewsItem(message, index));
}

async function pullTelegramOsint(url: string): Promise<TelegramMessage[]> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const messages = parseTelegramPayload(payload);
    cachedMessages = { items: messages, timestamp: Date.now() };
    dataFreshness.recordUpdate('rss', messages.length);
    console.log(`[Telegram OSINT] fetched ${messages.length} messages`);
    return messages;
  } catch {
    return cachedMessages?.items || [];
  }
}

function ensurePolling(url: string): void {
  if (!url) return;
  if (pollHandle && pollUrl === url) return;
  if (pollHandle) clearInterval(pollHandle);
  pollUrl = url;
  pollHandle = setInterval(() => {
    void pullTelegramOsint(pollUrl);
  }, TELEGRAM_POLL_INTERVAL_MS);
}

export async function fetchTelegramOsint(url: string): Promise<TelegramMessage[]> {
  const resolvedUrl = resolveUrl(url);
  if (!resolvedUrl) return [];

  ensurePolling(resolvedUrl);

  const cached = cachedMessages;
  if (cached && Date.now() - cached.timestamp < TELEGRAM_CACHE_TTL_MS) {
    return cached.items;
  }

  if (inFlight) return inFlight;
  inFlight = pullTelegramOsint(resolvedUrl).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
