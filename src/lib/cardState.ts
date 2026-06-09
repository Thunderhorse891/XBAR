/**
 * Persistent card/accordion state management.
 * Stores expansion states per entity in localStorage with 30-day TTL.
 */

const STORAGE_KEY = 'xbar_card_state_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CardStatus = 'collapsed' | 'expanded' | 'detailed' | 'focus';

type EntityPrefs = {
  status: CardStatus;
  expandedSections: string[];
  timestamp: number;
};

type CardStateStorage = {
  entities: Record<string, EntityPrefs>;
  layout: {
    pinnedCardIds: string[];
  };
};

function readStorage(): CardStateStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entities: {}, layout: { pinnedCardIds: [] } };
    const parsed = JSON.parse(raw) as CardStateStorage;
    return {
      entities: parsed.entities ?? {},
      layout: parsed.layout ?? { pinnedCardIds: [] },
    };
  } catch {
    return { entities: {}, layout: { pinnedCardIds: [] } };
  }
}

function writeStorage(data: CardStateStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded – silently swallow
  }
}

function pruneExpired(data: CardStateStorage): CardStateStorage {
  const now = Date.now();
  const entities: Record<string, EntityPrefs> = {};
  for (const [id, prefs] of Object.entries(data.entities)) {
    if (now - prefs.timestamp < TTL_MS) entities[id] = prefs;
  }
  return { ...data, entities };
}

export function getEntityPrefs(entityId: string): EntityPrefs {
  const storage = readStorage();
  return storage.entities[entityId] ?? {
    status: 'collapsed',
    expandedSections: [],
    timestamp: Date.now(),
  };
}

export function setEntityStatus(entityId: string, status: CardStatus): void {
  const storage = pruneExpired(readStorage());
  const existing = storage.entities[entityId] ?? { expandedSections: [] };
  storage.entities[entityId] = {
    ...existing,
    status,
    timestamp: Date.now(),
  };
  writeStorage(storage);
}

export function setEntityExpandedSections(entityId: string, sections: string[]): void {
  const storage = pruneExpired(readStorage());
  const existing = storage.entities[entityId] ?? { status: 'collapsed' as CardStatus };
  storage.entities[entityId] = {
    ...existing,
    expandedSections: sections,
    timestamp: Date.now(),
  };
  writeStorage(storage);
}

export function toggleEntitySection(entityId: string, sectionId: string): string[] {
  const storage = pruneExpired(readStorage());
  const existing = storage.entities[entityId] ?? { status: 'collapsed' as CardStatus, expandedSections: [] };
  const sections = existing.expandedSections ?? [];
  const next = sections.includes(sectionId)
    ? sections.filter((s) => s !== sectionId)
    : [sectionId]; // single-active accordion: replace, not append
  storage.entities[entityId] = {
    ...existing,
    expandedSections: next,
    timestamp: Date.now(),
  };
  writeStorage(storage);
  return next;
}

export function getPinnedCards(): string[] {
  return readStorage().layout.pinnedCardIds;
}

export function pinCard(cardId: string): void {
  const storage = readStorage();
  if (!storage.layout.pinnedCardIds.includes(cardId)) {
    storage.layout.pinnedCardIds = [cardId, ...storage.layout.pinnedCardIds];
    writeStorage(storage);
  }
}

export function unpinCard(cardId: string): void {
  const storage = readStorage();
  storage.layout.pinnedCardIds = storage.layout.pinnedCardIds.filter((id) => id !== cardId);
  writeStorage(storage);
}
