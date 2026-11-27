# Sürüm Durumu — v0.5.0

## Kurulum ve Başlatma
- **Windows hızlı kurulum:** `powershell -ExecutionPolicy Bypass -File .\setup.ps1`
- **Windows başlatma:** `start.bat` dosyasına çift tıklayın veya `.\start.ps1` çalıştırın.
- **Manuel kurulum:** `python -m pip install -e ".[test,media,ai]"` (yalnızca temel kurulum için `.[test]`)
- **Manuel başlatma:** `python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000`

## v0.5.0 Kapsamı (Tamamlananlar)
- **Kütüphane ve Okuyucu:** Yerel SQLite kütüphanesi (`outputs/library.sqlite3`), arama, kategori/favori/okundu filtresi, notlar, vurgulamalar (highlights), iki dilli/tek sütun pure-DOM okuyucu ve metin dışa aktarma.
- **Keşfet (Discover) ve İçe Aktarma:** RSS/Atom besleme kaynakları ekleme/yenileme/içe aktarma; genel HTTPS URL (SSRF korumalı, IP pinning, hop-validated redirect), ham metin, HTML, PDF, EPUB ve transkript içe aktarma.
- **Çeviri ve Terim Sözlüğü:** OpenRouter, OpenAI, yerel/özel OpenAI-uyumlu uç noktalar ve çevrimdışı `mock`/demo modu; terim sözlüğü (Glossary) ve sayısal tutarlılık kontrolleri.
- **Dinle (TTS & Transkripsiyon):** ElevenLabs Türkçe seslendirme (maliyet tahmini, ses/model listeleme, abonelik bilgisi), Faster-Whisper yerel ses transkripsiyonu (FFmpeg + CPU/CUDA algılama), yerleşik ses oynatıcı ve tarayıcı içi sesli okuma.
- **Arka Plan İş Kuyruğu (Job Queue):** Çeviri, transkripsiyon ve seslendirme işlerinin durum takibi.
- **Offline PWA:** Service Worker uygulama kabuğu (`kh-shell-v1`) ve **IndexedDB** (`kh-offline-v1`) ile seçili makale ve seslerin tarayıcıda çevrimdışı önbelleklenmesi.
- **Güvenli Yerel Yapılandırma:** Windows DPAPI (`CryptProtectData`) şifreli `outputs/.secrets.json`, POSIX `0o600` yedeği, maskelenmiş API anahtarı önizlemesi ve loopback-only sunucu.

## Canlı API Kabul Testine Geçiş Adımları
Çevrimdışı birim ve entegrasyon testleri (`python -m pytest`) tamamlandıktan sonra canlı sağlayıcı doğrulaması için şu adımları izleyin:
1. **Ortam Hazırlığı:** `.\setup.ps1` ve `python -m pytest` komutlarının hatasız geçtiğini doğrulayın.
2. **Anahtar Yapılandırması:** `start.bat` ile uygulamayı açın; **Ayarlar** sekmesinden OpenRouter (veya OpenAI) ve ElevenLabs API anahtarlarını kaydedin, **Bağlantı Testi** butonlarıyla doğrulayın.
3. **Çeviri Kabul Testi:** İzinli tek bir İngilizce teknik makaleyi URL veya HTML ile içe aktarın, sözlüğe 2-3 terim ekleyin, canlı modelle çevirin ve sayısal/kod/terim bütünlüğünü kontrol edin.
4. **Benchmark Doğrulaması:** Önce `python -m knowledge_hub.benchmark --out outputs/smoke.json`, ardından isteğe bağlı olarak `--allow-paid` ile canlı model karşılaştırması çalıştırın.
5. **ElevenLabs ve Ses Kabul Testi:** Kısa bir Türkçe metinde maliyet tahminini kontrol edin, tek bir seslendirme işi çalıştırıp oynatıcıda dinleyin; gerekirse yerel kısa bir ses dosyasında Faster-Whisper transkripsiyonunu doğrulayın.
6. **Offline PWA Doğrulaması:** Bir içeriği çevrimdışı kaydet (IndexedDB) ile saklayın, sunucuyu durdurup tarayıcıda çevrimdışı açıldığını ve sesin çaldığını doğrulayın.

## Bilinen Sınırlar ve Açık Maddeler
- Yalnızca tek kullanıcılı yerel loopback (`127.0.0.1`) kullanım içindir; halka açık dağıtım, çoklu kullanıcı kimlik doğrulaması ve uzaktan erişim desteklenmez.
- Taranmış (metin katmanı olmayan) PDF'ler için OCR henüz yoktur.
- Konuşmacı ayrıştırma (diarization), otomatik arka plan RSS zamanlayıcısı ve canlı harcama üst limiti (hard cost cap) henüz bulunmamaktadır.
- Yerel veriler ve gizli anahtarlar asla Git deposuna eklenmemelidir (bkz. [docs/SECURITY.md](SECURITY.md)).
