# Sistem Mimarisi ve Editoryal UX Anayasası

Bu belge, **Knowledge Hub AI**'ın masaüstü yerel uygulamasından **iOS App Store** ürününe evrilirken çekirdeği baştan yazmadan büyümesini sağlayacak mimari sınırları ve tasarım kurallarını tanımlar.

---

## 1. Yüksek Düzey Mimari

```text
+-----------------------------------------------------------------------+
|                           İSTEMCİ KATMANI                             |
|  [v0.5–v0.6 Web PWA (Pure-DOM)]     [v1.0 iOS Native (Expo / RN)]     |
|   - Editoryal Okuyucu & Oynatıcı     - Share Extension (1-tık kayıt)  |
|   - IndexedDB Offline Önbellek       - Native Background Audio Player |
|                                      - Dosya Sistemi Offline Paket    |
+----------------------------------+------------------------------------+
                                   | HTTPS / JSON REST + Range Audio Stream
                                   v
+-----------------------------------------------------------------------+
|                       FASTAPI UYGULAMA KATMANI                        |
|  server.py (create_app) · Auth Middleware (v0.6+) · Job Orchestrator  |
+-------------------+---------------------------+-----------------------+
|  ÇEKİRDEK ALAN    |    İŞLEME HATTI           |  ALTYAPI / DEPOLAMA   |
|  - ingest.py      |  - translation.py + qa.py |  - library.py         |
|  - fetch_public   |  - glossary.py            |    (SQLite -> PG)     |
|  - feed/discover  |  - audio_pipeline.py      |  - Blob Store         |
|  - transcript.py  |    (Supertonic3/GPU/11L)  |    (outputs/ -> R2)   |
|  - media.py       |  - Faster-Whisper (CUDA)  |  - secrets.py         |
|                   |  - jobs.py (SQLite->Queue)|    (DPAPI -> Vault)   |
+-------------------+---------------------------+-----------------------+
```

### Temel Mimari İlke: "İnce İstemci, Kalın API Çekirdeği"
- **Tüm iş mantığı Python/FastAPI katmanında kalır:** SSRF korumalı HTML çıkarımı, çeviri parçalama & QA, sözlük uygulama, TTS sentezi ve ses birleştirme istemciye kopyalanmaz.
- **Web ve iOS aynı REST sözleşmesini tüketir:** Yeni özellikler önce API sözleşmesi + test olarak tasarlanır; hem Web PWA hem gelecekteki iOS uygulaması aynı uç noktaları kullanır.

---

## 2. Mevcut API Yüzeyi ve Mobil Evrim Planı

Mevcut `knowledge_hub/server.py` (v0.5.0) 46 uç nokta ile sağlam bir temel sunar:
- **Kütüphane & Okuma:** `/api/items`, `/api/items/{id}`, `/progress`, `/metadata`, `/export`, `/api/import-url`, `/api/upload/document`
- **Çeviri & Sözlük:** `/api/items/{id}/translate`, `/api/glossary`, `/api/providers/translation/test`, `/api/providers/openrouter/models`
- **Ses & Transkripsiyon:** `/api/items/{id}/narrate`, `/narrate/estimate`, `/audio`, `/audio-progress`, `/transcribe`, `/api/upload/audio`, `/api/providers/supertonic/sample`, `/api/providers/whisper/status`
- **Keşfet & İş Kuyruğu:** `/api/sources`, `/api/discover/entries`, `/api/jobs`
- **Ayarlar & Sırlar:** `/api/settings`, `/api/secrets/status`, `/api/secrets`, `/api/usage`, `/api/backup`, `/api/system/info`

### Aşama 2 ve 3'te Eklenecek Mimari Köprüler (Çekirdeği Bozmadan)
1. **Kimlik Doğrulama Katmanı (`auth.py`):**
   - v0.5: Loopback-only (`127.0.0.1`), sıfır sürtünme.
   - v0.6: Opsiyonel `KH_API_TOKEN` Bearer token (Tailscale üzerinden telefondan bağlanırken zorunlu).
   - v1.0: Kullanıcı bazlı JWT + Sign in with Apple (`user_id` izolasyonu tüm tablolara eklenir).
2. **Ses Akışı ve Offline Paketleme:**
   - `/api/items/{id}/audio` için HTTP `206 Partial Content` (`Range`) desteği — iOS `AVPlayer` / `react-native-track-player` kesintisiz ileri/geri sarma için bunu şart koşar.
   - Makale metni + segmentleri + ses dosyasını tek manifestle indiren hafif offline paket uç noktası.
3. **Depolama Soyutlaması (v1.0 Bulut Hazırlığı):**
   - `library.py` içinde veri erişimi saf repository metodları arkasında tutulur (ileride Postgres adaptörü eklenebilir).
   - Ses ve yüklenen dosyalar sabit dosya yolu yerine `StorageBackend` (yerel `outputs/` veya S3/R2 signed URL) üzerinden okunur.
4. **Hızlı Paylaşım (iOS Share Extension):**
   - `POST /api/import-url` + isteğe bağlı `auto_translate` / `auto_narrate` bayraklarıyla iOS Share Extension tek istekte "kaydet + arka planda Türkçe çevir + seslendir" akışını tetikler.

---

## 3. iOS App Store Hazırlık ve Zero-Knowledge BYOK Güvenlik Modeli (v1.0)
- **Teknoloji Seçimi:** **Expo (React Native, TypeScript)** — tek kod tabanıyla yüksek native kalite, `expo-audio` ile arka plan/kilit ekranı ses kontrolü, native Share Extension eklentisi ve EAS Build ile Windows'tan bulutta iOS build & TestFlight dağıtımı.
- **Kilitli API Anahtarı Güvenlik Modeli (Sıfır-Sunucu Saklama / Zero-Knowledge BYOK):**
  - Kullanıcıların OpenRouter / OpenAI API anahtarları **yalnızca kendi iPhone'larının iOS Keychain'inde (`expo-secure-store`, Apple Secure Enclave)** saklanır.
  - Çeviri istekleri doğrudan **`iPhone → TLS/HTTPS → OpenRouter / OpenAI`** şeklinde cihazdan yapılır; kullanıcının API anahtarı **sunucumuza hiçbir zaman gönderilmez, RAM'den geçmez, veritabanına veya loglara yazılmaz.**
  - Sunucu yalnızca kütüphane/makale/transkript eşitlemesi için çevrilmiş çıktıyı (`PUT /api/items/{id}/translation`) kabul eder.
- **App Store Review Gereksinimleri:**
  - Çok kullanıcılı hesap sistemi varsa **Sign in with Apple** ve uygulama içi **Hesabımı Sil** akışı zorunludur.
  - Yalnızca kullanıcının eklediği kendi kaynakları işlenir; telifli içerikler kullanıcılar arasında paylaşılmaz.
  - Saf BYOK modeli Apple App Store kurallarıyla uyumludur; ileride uygulama içi kredi/abonelik satılırsa **StoreKit 2 (IAP)** kullanılır.

---

## 4. Editoryal UX & Tasarım Anayasası (Anti-AI-Slop)

Knowledge Hub AI bir **okuma ve dinleme enstrümanıdır**; gösterişli bir "AI dashboard" değildir. Referans estetik: **Readwise Reader, Matter, Apple Books, Castro ve iA Writer**.

### Yapılmayacaklar (AI Slop Yasakları)
- ❌ Varsayılan Tailwind koyu lacivert (`#0b0f17`) + parlak camgöbeği (`#38bdf8`) renk paleti.
- ❌ Navigasyon ve butonlarda emoji ikonlar (`📚`, `🧭`, `🎧`, `⚙️`, `☀️`).
- ❌ Her şeyi ağır kenarlıklı ve gölgeli kutuların (card-in-card) içine hapsetmek.
- ❌ Aynı ekranda rekabet eden 5+ birincil buton, gereksiz rozet/pill enflasyonu, sahte parlama/gradyanlar.
- ❌ Okuyucuyu boğan teknik metrikleri (cache hit, token sayısı, ham job ID) okuma alanının ortasına yığmak.

### Yapılacaklar (Tasarım İlkeleri)
1. **Sıcak Kağıt ve Mürekkep Renk Sistemi:**
   - **Açık Tema (Varsayılan Okuma Konforu veya Eşit Değerli):** Sıcak kırık beyaz/kağıt (`#F7F5F0`), yükseltilmiş yüzey (`#FFFFFF`), derin mürekkep metin (`#1A1917`), ikincil taş grisi (`#5E5B55`), ince saç teli çizgiler (`#E6E1D8`).
   - **Koyu Tema:** Mavi-gri değil, sıcak kömür/grafit (`#141312`), yüzey (`#1C1B19`), yumuşak fildişi metin (`#EDE9E1`), soluk kum ikincil metin (`#9A948A`), ince sınır (`#2C2A27`).
   - **Tek ve Ölçülü Vurgu Rengi:** Sıcak pişmiş toprak / editoryal kehribar-bakır (`#B85D2E` açıkta, `#D97A4A` koyuda) — yalnızca aktif durum, birincil aksiyon ve okuma ilerleme çizgisinde kullanılır.
2. **Tipografi Hiyerarşisi:**
   - **Okuma Gövdesi:** Zarif editoryal serif (`Newsreader`, `Source Serif 4`, fallback `Iowan Old Style`, `Georgia`, `serif`), `62ch–68ch` satır uzunluğu, `1.72` satır yüksekliği, net paragraf ritmi.
   - **Arayüz (UI):** Temiz geometrik/humanist sans (`Inter` / `-apple-system` / `Segoe UI`), net ağırlık ve boyut farkları (`tabular-nums` süre ve sayı göstergelerinde).
   - **Kod & Teknik Terimler:** Okuma akışını kırmayan hafif zeminli monospace (`JetBrains Mono` / `Cascadia Code` / `ui-monospace`).
3. **Tutarlı Vektör İkonografi:**
   - Tüm arayüz ikonları tek bir `1.6px` çizgi kalınlığında, yuvarlak uçlu saf inline SVG setinden gelir (sıfır emoji).
4. **Sakin Bilgi Mimarisi & Okuma Odaklılığı:**
   - Kütüphane görünümü: Gösterişli kutu ızgarası yerine taranabilir **editoryal liste** (başlık, kaynak + okuma/dinleme süresi + çeviri/ses durumu tek sakin satırda).
   - Okuyucu görünümü: Üstte ince bir ilerleme çubuğu ve sade araç çubuğu (`Türkçe | İki Dilli | Orijinal`, `Dinle`, tipografi menüsü); ikincil araçlar (sözlük, dışa aktarma, ham metadata) gizli çekmece/menüde.
   - Oynatıcı çubuğu: Dikkat dağıtmayan, dokunsal seek çubuklu, net `15sn / Oynat / 30sn` ve hız (`1x`) kontrolü; mobilde parmak dostu (≥44px dokunma alanı) alt mini-bar.
5. **Pure-DOM Güvenliği Korunur:**
   - Tasarım yenilemesi sırasında harici/kullanıcı metinleri için `innerHTML` kesinlikle kullanılmaz; SVG ikonlar yalnızca sabit dahili şablonlardan üretilir.
