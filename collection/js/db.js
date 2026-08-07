// Thin IndexedDB wrapper. Stores: items (keyPath id), meta (keyPath key).

const DB_NAME = 'hypercube-collection';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getAllItems() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('items').objectStore('items').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putItem(item) {
  const db = await open();
  return tx(db, 'items', 'readwrite', s => s.put(item));
}

export async function putItems(items) {
  const db = await open();
  return tx(db, 'items', 'readwrite', s => { for (const it of items) s.put(it); });
}

export async function deleteItem(id) {
  const db = await open();
  return tx(db, 'items', 'readwrite', s => s.delete(id));
}

export async function deleteItems(ids) {
  const db = await open();
  return tx(db, 'items', 'readwrite', s => { for (const id of ids) s.delete(id); });
}

export async function clearItems() {
  const db = await open();
  return tx(db, 'items', 'readwrite', s => s.clear());
}

export async function getMeta(key, fallback = null) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('meta').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  const db = await open();
  return tx(db, 'meta', 'readwrite', s => s.put({ key, value }));
}
