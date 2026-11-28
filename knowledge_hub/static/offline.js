// IndexedDB offline storage for translated articles and downloaded audio blobs.

const DB_NAME = "kh-offline-v1";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Tarayıcı IndexedDB desteklemiyor."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        db.createObjectStore("items", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveItemOffline(item, audioBlob = null) {
  const db = await openDb();
  const tx = db.transaction(["items", "audio"], "readwrite");
  tx.objectStore("items").put({ ...item, savedAt: new Date().toISOString() });
  if (audioBlob) {
    tx.objectStore("audio").put({ id: item.id, blob: audioBlob, savedAt: new Date().toISOString() });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineItem(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listOfflineItems() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineAudioUrl(id) {
  const db = await openDb();
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction("audio", "readonly");
    const req = tx.objectStore("audio").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  return rec?.blob ? URL.createObjectURL(rec.blob) : null;
}

export async function clearOfflineStore() {
  const db = await openDb();
  const tx = db.transaction(["items", "audio"], "readwrite");
  tx.objectStore("items").clear();
  tx.objectStore("audio").clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
