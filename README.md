# Knowledge Hub AI (v0.5.0)

Yabancı dildeki teknik makaleleri, belgeleri ve sesli içerikleri (podcast/ders) **Türkçe okumak, dinlemek ve kişisel kütüphanenizde arşivlemek** için geliştirilmiş yerel, gizlilik odaklı web uygulaması (PWA).

> **Yerel-öncelikli mimari:** Tüm kütüphane verileriniz `outputs/library.sqlite3` dosyasında, API anahtarlarınız ise Windows DPAPI ile şifrelenmiş olarak yerel diskinizde tutulur. Sunucu yalnızca `127.0.0.1` (loopback) üzerinde çalışır.

---

## Özellikler (v0.5.0)

- **Kütüphanem:** İçerikleri arama, kategori/favori/okundu filtresi, not alma, metin vurgulama (highlight) ve dışa aktarma.
- **Okuyucu:** İki dilli (Kaynak + Türkçe) veya tek sütun okuma deneyimi, sayısal/terim tutarlılığı kontrolleri, temiz DOM tabanlı render.
- **Keşfet (Discover):** RSS/Atom beslemelerini ekleme, yenileme ve seçili yazıları tek tıkla kütüphaneye aktarma; ayrıca URL, ham metin, HTML, PDF, EPUB veya transkript içe aktarma.
- **Dinle (Audio & TTS):**
  - **ElevenLabs** entegrasyonu ile Türkçe seslendirme, maliyet tahmini, ses/model seçimi ve abonelik kotası görüntüleme.
  - **Faster-Whisper** ile yerel ses dosyalarından (MP3/WAV/M4A vb.) transkripsiyon (CUDA/CPU destekli).
  - Yerleşik ses oynatıcı ve tarayıcı içi sesli okuma (Web Speech) desteği.
- **Çeviri Sağlayıcıları:** **OpenRouter**, **OpenAI** ve yerel/özel OpenAI-uyumlu uç noktalar (örn. Ollama / LM Studio), ayrıca API gerektirmeyen çevrimdışı `mock` / demo modu.
- **Glossary (Terim Sözlüğü):** Teknik terimlerin çeviri boyunca tutarlı kalması için kişisel sözlük yönetimi.
- **Job Queue (Arka Plan İş Kuyruğu):** Uzun süren çeviri, transkripsiyon ve seslendirme işlemlerinin durumunu takip etme.
- **Offline PWA:** Service Worker uygulama kabuğu (`kh-shell-v1`) ve **IndexedDB** (`kh-offline-v1`) ile seçili makaleleri ve ses dosyalarını tarayıcıda çevrimdışı okuma/dinleme.
- **Ayarlar:** Sağlayıcı, model, ses, sözlük ve API anahtarlarının merkezi yönetimi ile bağlantı testleri.

---

## Hızlı Kurulum (Windows)

Gereksinimler: **Python 3.11+**. Yerel ses işleme (Faster-Whisper) için **FFmpeg** önerilir.

1. Depo klasöründe bir PowerShell penceresi açın ve kurulum scriptini çalıştırın:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```
   `setup.ps1` şunları otomatik yapar:
   - Python 3.11+ sürümünü doğrular.
   - `.venv` sanal ortamını oluşturur ve aktive eder.
   - `pip install -e ".[test,media,ai]"` paketlerini kurar (medya/AI kurulumunda sorun çıkarsa temel `.[test]` kurulumu ile güvenli biçimde devam eder).
   - FFmpeg varlığını kontrol eder (yoksa `winget install Gyan.FFmpeg` önerisini gösterir, kurulumu durdurmaz).
   - `outputs/` klasörünü hazırlar.

2. Uygulamayı başlatmak için:
   - **`start.bat`** dosyasına çift tıklayın, **veya**
   - PowerShell'de `.\start.ps1` komutunu çalıştırın.

   Sunucu `http://127.0.0.1:8000` adresinde başlar ve varsayılan tarayıcınız otomatik olarak açılır.

---

## Manuel Kurulum (Windows / macOS / Linux)

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -e ".[test,media,ai]"
# Yalnızca temel/API'siz çalışma için:
# python -m pip install -e ".[test]"
```

Sunucuyu başlatma:

```bash
python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000
```

Ardından tarayıcıda `http://127.0.0.1:8000` adresini açın.

---

## API Anahtarları ve Gizlilik

API anahtarlarını **uygulama içindeki Ayarlar sekmesinden** doğrudan girebilirsiniz:
- **OpenRouter API Key** (`OPENROUTER_API_KEY`)
- **OpenAI API Key** (`OPENAI_API_KEY`)
- **ElevenLabs API Key** (`ELEVENLABS_API_KEY`)
- **Özel LLM API Key** (`KH_CUSTOM_LLM_API_KEY`)

Güvenlik mimarisi:
- Windows'ta anahtarlar **Windows DPAPI** (`CryptProtectData`) ile yalnızca mevcut Windows kullanıcısına özel olarak şifrelenir ve `outputs/.secrets.json` dosyasında saklanır.
- SQLite veritabanına ham anahtar yazılmaz; arayüze (frontend) yalnızca maskelenmiş önizleme (örn. `sk-o••••9f1a`) döner.
- `outputs/`, `.env`, `.secrets*` ve `*.dpapi` dosyaları `.gitignore` içindedir — **Git'e eklenmez**.
- İsterseniz anahtarları ortam değişkeni olarak da tanımlayabilirsiniz (ortam değişkenleri yerel depo kaydı yoksa yedek olarak okunur).

Ayrıntılı güvenlik mimarisi için [docs/SECURITY.md](docs/SECURITY.md) dosyasına bakın.

---

## Test ve Benchmark Komutları

### Test Suite
```bash
python -m pytest
```

### Çeviri Benchmark'ı
Çevrimdışı duman (smoke) testi (ücretli API çağrısı yapmaz):
```bash
python -m knowledge_hub.benchmark --out outputs/smoke.json
```

Canlı model karşılaştırması (isteğe bağlı, ücretli API çağrısı yapar):
```bash
python -m knowledge_hub.benchmark --model MODEL_A --model MODEL_B --allow-paid --out outputs/live.json
```

### Komut Satırı (CLI) ve Medya Araçları
```bash
# Yerel PDF/EPUB metin çıkarımı
python -m knowledge_hub.media document book.epub outputs/book.txt

# Yerel ses transkripsiyonu (Faster-Whisper)
python -m knowledge_hub.media audio episode.mp3 outputs/episode.json --allow-download

# Klasik CLI çeviri akışı (isteğe bağlı)
knowledge-hub source.txt --out outputs/demo --model YOUR_MODEL --allow-paid
```

---

## Ek Dokümantasyon

- [Güvenlik Mimarisi (docs/SECURITY.md)](docs/SECURITY.md)
- [Sürüm Durumu ve Kabul Testleri (docs/RELEASE.md)](docs/RELEASE.md)
- [Çevrimdışı Çalışma ve PWA (docs/OFFLINE.md)](docs/OFFLINE.md)
- [Çeviri Benchmark Rehberi (docs/BENCHMARK.md)](docs/BENCHMARK.md)
- [ElevenLabs Pilot Notları (docs/ELEVEN_PILOT.md)](docs/ELEVEN_PILOT.md)
- [Kapsam (docs/SCOPE.md)](docs/SCOPE.md)
