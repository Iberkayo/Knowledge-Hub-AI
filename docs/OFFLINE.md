# Çevrimdışı Çalışma ve Offline PWA Mimarisi (v0.5.0)

Knowledge Hub AI, harici API anahtarı olmadan geliştirme/test yapabilmeyi ve seçili içerikleri internet bağlantısı yokken okuyup dinleyebilmeyi destekler.

## 1. İki Katmanlı Offline PWA Mimarisi

1. **Service Worker Uygulama Kabuğu (`knowledge_hub/static/sw.js`):**
   - `kh-shell-v1` önbelleğinde yalnızca statik uygulama kabuğunu (`/`, `/manifest.webmanifest`, `/icon.svg`) saklar.
   - Önce ağdan (network-first) yüklemeyi dener, ağ erişilemezse önbellekten sunar.
   - Özel kütüphane API yanıtlarını (`/api/*`) Service Worker önbelleğine **yazmaz**; böylece hassas/kişisel veriler genel HTTP önbelleğine sızmaz.
2. **IndexedDB Yerel İçerik Deposu (`knowledge_hub/static/offline.js`):**
   - Tarayıcı içinde `kh-offline-v1` veritabanını iki store ile yönetir:
     - `items`: Kullanıcının çevrimdışı saklamayı seçtiği makale/çeviri kayıtları.
     - `audio`: İlgili içeriklere ait indirilmiş ses dosyaları (`Blob`).
   - Kullanıcı çevrimdışı kaydettiği içerikleri sunucu kapalıyken veya internet bağlantısı yokken okuyup dinleyebilir, dilediğinde tek tıkla çevrimdışı önbelleği temizleyebilir.

## 2. API'siz Yerel Çalışma ve Test Modu

Harici ücretli API'lere bağlanmadan tüm temel akışları çalıştırabilirsiniz:
- **Kurulum:** `python -m pip install -e ".[test]"` (veya Windows'ta `.\setup.ps1`)
- **Başlatma:** `python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000` (veya `start.bat`)
- **Depolama:** Yerel SQLite veritabanı `outputs/library.sqlite3` altında tutulur.
- **Çeviri (`mock` / demo):** Ücretli sağlayıcı anahtarı girilmeden çeviri akışı, sözlük ve okuyucu arayüzü `mock` çevirmen ile test edilebilir.
- **Seslendirme ve Transkripsiyon:**
  - Tarayıcı içi Web Speech (yüklü OS/tarayıcı seslerini kullanır) API gerektirmez.
  - Faster-Whisper modeli bir kez indirildikten sonra (`--allow-download` veya ilk yerel çalıştırma) tamamen çevrimdışı transkripsiyon yapabilir.

## 3. Canlı API Kullanımına Geçiş

Çevrimdışı geliştirme/doğrulama tamamlandığında canlı sağlayıcıları etkinleştirmek için:
1. **Ayarlar** sekmesinden OpenRouter, OpenAI, özel LLM veya ElevenLabs API anahtarlarını ekleyin (Windows'ta DPAPI ile şifrelenerek `outputs/.secrets.json` içine kaydedilir).
2. Sağlayıcı seçimi ve **Bağlantı Testi** ile erişimi doğrulayın.
3. Ücretli çeviri ve seslendirme işlemlerini yalnızca yetkili içerikler üzerinde başlatın; ayrıntılı kabul adımları için [docs/RELEASE.md](RELEASE.md) dosyasına bakın.
