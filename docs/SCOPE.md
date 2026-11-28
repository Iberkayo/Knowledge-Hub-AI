# Ürün Kapsamı ve Yol Haritası (Kilitli Scope)

**Durum:** Kilitli (2026-11-27) · **Hedef Platform:** Masaüstü Web (v0.5) → Kişisel Mobil Erişim (v0.6) → **iOS App Store Native Uygulama (v1.0)**

---

## 1. Ürün Tezi
**Knowledge Hub AI**, yabancı dildeki (ağırlıklı İngilizce) teknik makaleleri, araştırma yazılarını, belgeleri ve podcast'leri **doğal, terim bütünlüğü bozulmamış Türkçeye** çeviren; bunları hem **üst düzey bir editoryal okuyucu** hem de **kesintisiz bir sesli dinleme (podcast) deneyimi** ile sunan **Türkçe-öncelikli bilgi merkezidir**.

Önce geliştiricinin kendi günlük okuma/dinleme aracı olarak sahada kanıtlanır; ardından **iOS App Store** üzerinden herkesin kullanabileceği yüksek zanaat kalitesinde bir ürüne dönüştürülür.

---

## 2. Kilitli 3 Aşamalı Yol Haritası

### Aşama 1 — v0.5: Çekirdek Kalite & Editoryal UX (Şu An)
*Amaç: Çeviri, seslendirme, transkripsiyon ve okuma deneyiminin gerçekten her gün kullanılacak kaliteye ulaşması.*
- **İçerik Alma:** SSRF korumalı HTTPS makale çekimi, RSS/Atom keşif beslemeleri, belge (`.pdf`, `.epub`, `.html`, `.txt`, `.srt`, `.vtt`) ve ses dosyası yükleme.
- **Çeviri Motoru:** Paragraf/kod/denklem/sayı bütünlüğünü koruyan, terim sözlüğü destekli, üç ayrı modlu (`faithful` birebir çeviri, `explained` açıklamalı okuma, `summary` özet) çeviri + otomatik QA kontrolleri.
- **Ses & Transkripsiyon:** Doğal Türkçe **Edge Neural TTS** (`AhmetNeural` / `EmelNeural`, ücretsiz & sınırsız MP3 — kabul edilebilir MVP seviyesi; ileride **OpenAI `gpt-4o-mini-tts`**, **Google Gemini / Chirp 3 HD TTS**, **ElevenLabs Multilingual v2** veya yerel RTX 6 GB GPU TTS [**Chatterbox Multilingual / XTTS-v2**] ile yükseltilecek şekilde sağlayıcı katmanı soyutlanmıştır), çevrimdışı **Supertonic 3 ONNX**, yerel **Faster-Whisper** GPU transkripsiyonu. Kod blokları, tablolar ve çıplak URL'ler ne çevrilir ne de seslendirilir.
- **Editoryal UX Yenilemesi:** "AI slop" estetiğinden uzak; sıcak kağıt/mürekkep renk sistemi, yüksek okunabilirlikli tipografi, tutarlı SVG ikonografi, sade bilgi hiyerarşisi ve dokunsal (tactile) ses oynatıcı.
- **Çıkış Kriteri:** Gerçek makalelerde doğal Türkçe çeviri + doğal Türkçe seslendirme + Whisper GPU testi + 54+ birim test + masaüstü & 390px mobil görsel doğrulama.

### Aşama 2 — v0.6: Kişisel Mobil Erişim, Video/YouTube & Podcast Modu
*Amaç: Ev PC / kişisel sunucudaki arka ucu telefonda günlük hayatta (yürüyüş, ulaşım, çevrimdışı) kullanıp ürün ihtiyaçlarını canlı doğrulamak ve içerik kaynaklarını video + podcast üretimine genişletmek.*
- **YouTube / Video → Türkçe Podcast (NotebookLM Tarzı):** İzinli video linkinden transkript alma (`youtube-transcript-api` + gerekirse yerel Faster-Whisper CUDA), Türkçeye çevirme ve herhangi bir makale/videodan **2 konuşmacılı (Erkek + Kadın) doğal Türkçe sohbet podcast'i ("Audio Overview")** üretme.
- **Opsiyonel Çeviri Sağlayıcıları:** OpenRouter yüksek kaliteli Türkçe modellerine (`Gemini 2.5 Flash`, `Claude Sonnet 4`, `GPT-4.1 Mini`) ek olarak isteğe bağlı **DeepL API** adaptörü.
- **Güvenli Uzak Erişim:** FastAPI arka ucuna opsiyonel Bearer Token kimlik doğrulama katmanı + **Tailscale HTTPS** ile kişisel erişim (varsayılan yine `127.0.0.1`).
- **Mobil API Sözleşmesi:** `/api/v1/` uyumluluk hazırlığı, sayfalı kütüphane listesi, ses akışı için HTTP `Range` (byte-seek) desteği, senkron okuma/dinleme konumu.
- **PWA İyileştirmeleri:** iOS Safari "Ana Ekrana Ekle" uyumu, çevrimdışı paketleme (metin + ses) ve saha gözlemiyle native eksiklerin netleştirilmesi.

### Aşama 3 — v1.0: iOS App Store Native Uygulama & Çok Kullanıcılı Hazırlık
*Amaç: Apple Developer hesabı üzerinden App Store'da yayınlanacak, Readwise Reader / Matter / Castro kalitesinde native iOS deneyimi.*
- **iOS İstemcisi (Expo / React Native):**
  - **iOS Share Extension:** Safari, X, Substack, RSS uygulamalarından tek tıkla "Knowledge Hub'a Kaydet" -> arka planda çevir & seslendir.
  - **Kaya Gibi Arka Plan Ses Oynatıcı:** Kilit ekranı, AirPods/Bluetooth, CarPlay, 0.75x–2.0x hız, 15/30 sn atlama, paragraf/zaman senkronu (`react-native-track-player`).
  - **Gerçek Offline İndirme:** Dosya sistemi tabanlı çevrimdışı makale + ses arşivi.
  - **Apple HIG & Editoryal Tasarım:** Dinamik Tip, Dark/Light/Sepia okuma temaları, dokunsal geri bildirim (haptics).
- **Bulut / Çok Kullanıcılı Backend Geçişi:**
  - Aynı FastAPI çekirdeği; depolama soyutlamasıyla SQLite → PostgreSQL, yerel ses dosyaları → S3/R2, iş kuyruğu → arka plan worker.
  - Sign in with Apple + hesap silme + gizlilik bildirimi (App Store Review zorunlulukları).
  - Maliyet/iş modeli: BYOK (kendi anahtarın) veya StoreKit 2 abonelik/kredi katmanı (Aşama 3 başında kesinleştirilir).

---

## 3. Kapsam Dışı / Kırmızı Çizgiler (Non-Goals)
1. **Erişim Engeli / Paywall Atlatma Yok:** Yalnızca herkese açık veya kullanıcının yetkili olduğu içerikler işlenir.
2. **Telifli İçerik Yeniden Dağıtımı Yok:** Çevrilen/seslendirilen makaleler yalnızca ilgili kullanıcının özel kütüphanesinde kalır; herkese açık katalog olarak paylaşılmaz.
3. **Ses Klonlama (Voice Cloning) Yok:** Üçüncü kişilerin seslerini izinsiz klonlayan özellikler kapsam dışıdır.
4. **Gizli Ücretli API Çağrısı Yok:** Ücretli LLM/TTS çağrıları her zaman açık kullanıcı tetiklemesi ve görünür maliyet/sağlayıcı bilgisiyle çalışır.
5. **AI Slop Arayüz Yok:** Genel geçer koyu-lacivert + neon mavi kart yığını, emoji navigasyon, gereksiz parlama/gradyan ve yoğun kontrol kalabalığı kabul edilmez.
6. **Cihaz İçi Ağır LLM Yok:** Telefon pilini ve belleğini tüketen cihaz içi dev LLM'ler kapsam dışıdır; işlem her zaman backend/API katmanında yapılır.

---

## 4. Kalite Kapıları (Quality Gates)
- **Çeviri Sadakati:** Atlanan paragraf yok; denklemler, sayılar, kod blokları ve teknik terimler korunur. Otomatik kontroller tek başına yeterli sayılmaz; gerçek teknik makalelerle insan gözden geçirmesi yapılır.
- **Ses Kalitesi:** Uzun teknik makalede telaffuz, noktalama duraklaması ve dinleme konforu kabul edilebilir düzeyde olmalıdır.
- **Test & Güvenlik:** Tüm çekirdek değişiklikler çevrimdışı/mocklu `pytest` ile doğrulanır; sırlar asla Git'e veya istemciye ham olarak sızmaz.
- **Süreklilik:** Her kilometre taşında (checkpoint) `HANDOFF.md` güncellenir ve `feat/mvp-foundation` dalına push edilir; kullanıcı onayı olmadan `main`'e merge yapılmaz.
