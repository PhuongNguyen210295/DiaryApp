// Tiny IndexedDB wrapper. All entries live only on this device.
const DB = (() => {
  const NAME = 'diary';
  const VERSION = 1;
  const STORE = 'entries';
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('date', 'date');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const reqP = req => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  return {
    all: () => tx('readonly', s => reqP(s.getAll())),
    get: id => tx('readonly', s => reqP(s.get(id))),
    put: entry => tx('readwrite', s => reqP(s.put(entry))),
    remove: id => tx('readwrite', s => reqP(s.delete(id))),
    clear: () => tx('readwrite', s => reqP(s.clear())),
    bulkPut: entries => tx('readwrite', s => { entries.forEach(e => s.put(e)); }),
  };
})();
