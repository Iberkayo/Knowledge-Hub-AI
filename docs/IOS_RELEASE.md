# iOS Uygulaması & TestFlight / App Store Rehberi (`mobile/`)

`mobile/` klasörü, Knowledge Hub FastAPI arka ucuna bağlanan native **Expo (React Native, TypeScript)** iOS uygulamasını içerir. Windows bilgisayardan Mac gerekmeden **Expo Go** ile anında test edilebilir ve **EAS Build** ile bulutta imzalanıp doğrudan **TestFlight / App Store Connect**'e yüklenebilir.

---

## 1. Anında iPhone'da Deneme (Expo Go — 2 Dakika)
1. iPhone'a App Store'dan **Expo Go** uygulamasını indir.
2. Windows PC'de:
   ```powershell
   cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI\mobile"
   npx expo start --tunnel
   ```
3. iPhone kamerasıyla QR kodu okut — uygulama doğrudan açılır.
4. Uygulamada **Ayarlar** sekmesine girip:
   - **Sunucu Adresi:** Tailscale HTTPS adresini (`https://<pc>.<tailnet>.ts.net`, bkz. [MOBILE_ACCESS.md](MOBILE_ACCESS.md))
   - **Erişim Belirteci:** `KH_API_TOKEN` değerini gir ve **Kaydet ve Bağlantıyı Test Et**'e dokun.

---

## 2. TestFlight & App Store Connect Dağıtımı (Apple Developer Hesabı ile)
1. EAS CLI kur ve Expo hesabına giriş yap:
   ```powershell
   npm install -g eas-cli
   eas login
   cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI\mobile"
   eas build:configure
   ```
2. `mobile/app.json` içindeki `ios.bundleIdentifier` değerini (`com.iberkayo.knowledgehub`) Apple Developer portalında istediğin Bundle ID ile eşleştir.
3. Bulutta imzalı iOS TestFlight derlemesi al (Mac gerekmez):
   ```powershell
   eas build --platform ios --profile production
   ```
4. Doğrudan App Store Connect / TestFlight'a gönder:
   ```powershell
   eas submit --platform ios --latest
   ```

---

## 3. Uygulamada Hazır Olan Native Özellikler
- **Editoryal Kağıt / Koyu Tema:** Web uygulamasıyla birebir tutarlı sıcak kağıt (`#F8F5EF`) ve koyu grafit (`#141311`) tasarım, Georgia Serif / SF Pro okuyucu, sıfır emoji.
- **Arka Plan & Kilit Ekranı Ses Oynatıcı (`expo-audio`):** `UIBackgroundModes: ["audio"]`, kilit ekranı + AirPods ileri/geri sarma, 0.75×–2.0× hız, otomatik konum senkronizasyonu.
- **Gerçek Dosya Sistemi Çevrimdışı İndirme (`expo-file-system`):** Makale metni + MP3 sesi doğrudan telefon belleğine indirip uçakta/metroda sıfır internetle dinleme.
- **iOS Keychain Güvenliği (`expo-secure-store`):** Sunucu adresi ve `KH_API_TOKEN` şifreli iOS Keychain'de tutulur.
- **YouTube & 2 Kişilik Türkçe Podcast:** Tek ekrandan makale/YouTube linki ekleme ve Emel & Ahmet 2 konuşmacılı Türkçe podcast üretme.

## 4. App Store Yayını Öncesi Sonraki Adımlar (v1.0)
- **iOS Share Extension:** Safari/X/YouTube'dan tek tıkla "Knowledge Hub'a Kaydet" native eklentisi (EAS custom dev build ile).
- **Çok Kullanıcılı Bulut Backend (Genel Yayın İçin):** PostgreSQL + Cloudflare R2/S3 + Sign in with Apple + uygulama içi Hesabımı Sil + StoreKit 2 (veya BYOK).
- **Geliştirilebilir TTS Katmanı:** Edge Neural TTS üstüne OpenAI `gpt-4o-mini-tts` / Gemini Chirp 3 HD / ElevenLabs Multilingual v2 yükseltmesi.
