# iPhone ve Uzak Mobil Erişim Rehberi (Tailscale HTTPS)

Bu rehber, ev bilgisayarında çalışan **Knowledge Hub** sunucusuna iPhone'undan (yürüyüşte, yolda veya ev içinde) güvenli, şifreli HTTPS üzerinden nasıl bağlanacağını anlatır.

---

## 1. Neden Tailscale?
- Modem port yönlendirmesi veya herkese açık IP gerektirmez; ev PC'si internete açık kalmaz.
- Yalnızca senin cihazların (ev PC + iPhone) arasında WireGuard şifreli özel tünel kurar.
- `tailscale serve` komutu otomatik geçerli **HTTPS sertifikası** sağlar — iOS Safari'de PWA, Service Worker ve çevrimdışı IndexedDB yalnızca HTTPS'te tam çalışır.

---

## 2. Kurulum (5 Dakika)

### Adım 1 — Tailscale Kur
- **Windows PC:** [tailscale.com/download](https://tailscale.com/download) üzerinden kur ve giriş yap.
- **iPhone:** App Store'dan **Tailscale** uygulamasını indir ve aynı hesapla giriş yap.

### Adım 2 — Güçlü Bir Erişim Anahtarı ile Sunucuyu Başlat
PowerShell'de rastgele bir `KH_API_TOKEN` belirleyip yerel sunucuyu başlat:

```powershell
cd "C:\Users\iberk\OneDrive\Masaüstü\Knowledge-Hub-AI"
$env:KH_API_TOKEN = "buraya-uzun-guclu-bir-anahtar-yaz"
.\.venv\Scripts\python.exe -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000
```

> **Güvenlik:** Sunucu yine yalnızca `127.0.0.1:8000` üzerinde dinler; `KH_API_TOKEN` ayarlandığında `/api/health` dışındaki tüm `/api/*` uç noktaları Bearer token doğrulaması ister.

### Adım 3 — Tailscale Serve ile HTTPS Olarak Yayınla
Yeni bir PowerShell penceresinde:

```powershell
tailscale serve https / http://127.0.0.1:8000
```

Tailscale sana `https://<bilgisayar-adi>.<tailnet>.ts.net` gibi özel bir HTTPS adresi verecektir.

### Adım 4 — iPhone'a Kur (PWA)
1. iPhone'da **Safari** ile bu `https://...ts.net` adresini aç.
2. Ekrana gelen **Erişim Belirteci** penceresine belirlediğin `KH_API_TOKEN` değerini gir (bir kez kaydedilir).
3. Safari'de **Paylaş → Ana Ekrana Ekle** ile Knowledge Hub'ı uygulama gibi ana ekranına yerleştir.
4. Wi-Fi'dayken okumak/dinlemek istediğin makalelerin `··· → Çevrimdışı Kaydet` seçeneğiyle çevrimdışı önbelleğe al.

---

## 3. Aşama 3 (Native iOS App Store) ile Uyumluluk
Bu aşamada eklenen:
- `Authorization: Bearer <token>` kimlik doğrulaması,
- `/api/health` sağlık kontrolü,
- `/api/items/{id}/audio` üzerinde **HTTP `206 Partial Content` (`Range`)** desteği

doğrudan Aşama 3'teki **Expo (React Native)** iOS uygulaması ve `react-native-track-player` tarafından da kullanılacaktır.
