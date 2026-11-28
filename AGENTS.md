# AGENTS.md — Knowledge Hub AI Çalışma Rehberi

Bu dosya, bu depoda çalışan yapay zekâ ajanları ve geliştiriciler için proje yapısını, çalışma prensiplerini, test komutlarını ve güvenlik/git kurallarını tanımlar.

---

## 1. Proje Yapısı

```text
Knowledge-Hub-AI/
├── knowledge_hub/
│   ├── server.py          # FastAPI uygulaması (create_app factory), REST API ve statik sunum
│   ├── library.py         # SQLite kütüphane, ayarlar, beslemeler, sözlük ve iş kayıtları
│   ├── secrets.py         # Windows DPAPI / POSIX 0600 API anahtarı deposu ve maskeleme
│   ├── providers.py       # OpenRouter, OpenAI, Custom LLM, Mock/Demo çeviri sağlayıcıları
│   ├── translation.py     # Parça tabanlı çeviri, sözlük entegrasyonu ve QA entegrasyonu
│   ├── glossary.py        # Teknik terim sözlüğü kuralları
│   ├── qa.py              # Sayısal/format bütünlüğü kontrolleri
│   ├── audio_pipeline.py  # ElevenLabs seslendirme, maliyet tahmini ve ses birleştirme
│   ├── eleven.py          # ElevenLabs istemci yardımcıları
│   ├── media.py           # PDF/EPUB çıkarımı (zip-slip/XXE korumalı) ve Faster-Whisper
│   ├── fetch_public.py    # SSRF korumalı, public-IP pinned HTTPS istemcisi
│   ├── discover.py        # RSS/Atom kaynak yönetimi ve içerik aktarımı
│   ├── feed.py            # RSS/Atom ayrıştırıcı (defusedxml)
│   ├── ingest.py          # HTML/metin çıkarımı
│   ├── transcript.py      # Transkript ayrıştırıcı
│   ├── jobs.py            # Arka plan iş kuyruğu (JobManager)
│   ├── benchmark.py       # Çeviri değerlendirme ve smoke benchmark'ı
│   ├── cli.py             # Komut satırı arayüzü (knowledge-hub)
│   └── static/            # PWA arayüzü (index.html, render.js, player.js, offline.js, sw.js, styles.css)
├── tests/                 # pytest test suite'i (çevrimdışı, ağsız/mocklu)
├── docs/                  # SECURITY.md, RELEASE.md, OFFLINE.md, BENCHMARK.md, ELEVEN_PILOT.md, SCOPE.md
├── benchmarks/            # Sentetik çeviri benchmark verileri
├── setup.ps1              # Windows kurulum scripti
├── start.ps1              # Windows yerel sunucu başlatma scripti
├── start.bat              # Çift tıklama Windows başlatıcı
└── pyproject.toml         # Paket ve opsiyonel bağımlılık tanımları (v0.5.0)
```

---

## 2. Çalışma Prensipleri

- **Yerel ve Gizlilik Odaklı:** Uygulama varsayılan olarak yalnızca `127.0.0.1` üzerinde çalışır; kullanıcı verileri `outputs/` altında yerel kalır.
- **API-Last / Offline-First Test:** Birim ve entegrasyon testleri harici ücretli API çağrısı yapmamalı, mock/sahte sağlayıcılarla deterministik çalışmalıdır.
- **Küçük ve Doğrulanabilir Değişiklikler:** Mevcut mimariye ve modül sınırlarına uy; kapsam dışı dosyalara dokunma.
- **Pure-DOM Arayüz:** `knowledge_hub/static/` altında dış kaynaklı veya kullanıcı kaynaklı metinleri `innerHTML` ile basma; her zaman `createElement` / `textContent` kullan.
- **Türkçe Kullanıcı Arayüzü ve Dokümantasyon:** Son kullanıcıya dönük mesajlar, hata metinleri ve kullanıcı dokümanları açık ve doğal Türkçe olmalıdır.

---

## 3. Test ve Doğrulama Komutları

```bash
# Tüm testleri çalıştır
python -m pytest

# Çevrimdışı benchmark smoke testi
python -m knowledge_hub.benchmark --out outputs/smoke.json

# Yerel sunucuyu başlat
python -m uvicorn knowledge_hub.server:create_app --factory --host 127.0.0.1 --port 8000
```

PowerShell script değişikliği yapıldığında sözdizimi doğrulaması:
```powershell
[System.Management.Automation.Language.Parser]::ParseFile(".\setup.ps1", [ref]$null, [ref]$errors)
```

---

## 4. Güvenlik Kuralları

1. **Sırlar Asla Kodda veya Git'te Olmaz:** API anahtarları yalnızca `SecretStore` (`outputs/.secrets.json`, Windows'ta DPAPI) veya ortam değişkenleri üzerinden okunur. Ham anahtar hiçbir HTTP yanıtına, loga veya SQLite tablosuna yazılmaz.
2. **SSRF ve Ağ Sınırlarını Koruma:** Genel URL/feed/ses indirme işlemleri mutlaka `knowledge_hub/fetch_public.py` üzerinden yapılmalıdır (yalnızca HTTPS/443, `is_global` IP pinning, MIME ve boyut sınırları).
3. **Belge Güvenliği:** EPUB/XML ayrıştırmasında `defusedxml` ve `_safe_zip_member` zip-slip koruması korunmalıdır.
4. **Loopback-Only:** Varsayılan host `127.0.0.1` olarak kalmalıdır; kimlik doğrulama olmadan `0.0.0.0` önerilmez.
5. **Ücretli API Çağrıları:** Otomatik/gizli ücretli API çağrısı ekleme; tüm ücretli işlemler açık kullanıcı tetiklemesiyle (veya CLI'da `--allow-paid` bayrağıyla) çalışmalıdır.

---

## 5. Git ve Branch Kuralları

- **`main` branch'e otomatik merge yapma:** Hiçbir ajan veya otomasyon kullanıcıdan açık onay almadan `main` branch'e merge, rebase veya force-push yapmamalıdır.
- Çalışmaları özellik/düzeltme branch'lerinde veya kullanıcının belirttiği çalışma alanında yürüt; `outputs/`, `.venv/`, `.secrets*` ve yerel veritabanı dosyalarını asla commit etme.
