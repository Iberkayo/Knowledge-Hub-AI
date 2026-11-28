"""Domain-specific technical glossary (English -> Turkish) with versioning."""
from __future__ import annotations

DEFAULT_GLOSSARY: list[dict[str, object]] = [
    {"term_en": "Statistical inference", "term_tr": "İstatistiksel çıkarım", "context_note": "Anakütle parametreleri hakkında veriden sonuç çıkarma.", "keep_english_parens": True},
    {"term_en": "Model inference", "term_tr": "Modelin tahmin üretmesi", "context_note": "Eğitilmiş modelin yeni girdiler üzerinde çıktı üretmesi; istatistiksel çıkarım ile karıştırılmamalıdır.", "keep_english_parens": True},
    {"term_en": "Confidence interval", "term_tr": "Güven aralığı", "context_note": "Frekansçı aralık tahmini.", "keep_english_parens": False},
    {"term_en": "Hypothesis testing", "term_tr": "Hipotez testi", "context_note": "İstatistiksel anlamlılık sınaması.", "keep_english_parens": False},
    {"term_en": "Reinforcement learning", "term_tr": "Pekiştirmeli öğrenme", "context_note": "Ödül sinyaliyle politika öğrenimi.", "keep_english_parens": True},
    {"term_en": "Overfitting", "term_tr": "Aşırı uyum", "context_note": "Eğitim verisini ezberleyip genelleme kaybetme.", "keep_english_parens": True},
    {"term_en": "Feature engineering", "term_tr": "Öznitelik mühendisliği", "context_note": "Model girdileri için değişken tasarlama.", "keep_english_parens": True},
    {"term_en": "Data leakage", "term_tr": "Veri sızıntısı", "context_note": "Eğitim sırasında hedef veya test bilgisinin sızması.", "keep_english_parens": True},
    {"term_en": "Ground truth", "term_tr": "Gerçek referans değer", "context_note": "Doğrulama için kabul edilen referans etiket/değer.", "keep_english_parens": True},
    {"term_en": "Calibration", "term_tr": "Kalibrasyon", "context_note": "Tahmin olasılıklarının gerçek gözlem frekanslarıyla uyumu.", "keep_english_parens": False},
    {"term_en": "Precision", "term_tr": "Kesinlik", "context_note": "Pozitif tahminlerin doğruluk oranı (TP / (TP + FP)).", "keep_english_parens": True},
    {"term_en": "Recall", "term_tr": "Duyarlılık", "context_note": "Gerçek pozitiflerin yakalanma oranı (TP / (TP + FN)).", "keep_english_parens": True},
    {"term_en": "Loss function", "term_tr": "Kayıp fonksiyonu", "context_note": "Optimizasyon sırasında minimize edilen hata ölçütü.", "keep_english_parens": True},
    {"term_en": "Generalization", "term_tr": "Genelleme", "context_note": "Görülmemiş verideki başarım.", "keep_english_parens": False},
    {"term_en": "Prompt injection", "term_tr": "İstem enjeksiyonu", "context_note": "Kaynak metin içinden model talimatlarını yönlendirme saldırısı.", "keep_english_parens": True},
    {"term_en": "Evaluation", "term_tr": "Değerlendirme (Eval)", "context_note": "LLM veya ML sistem performansının sistematik ölçümü.", "keep_english_parens": True},
]


def match_terms(text: str, entries: list[dict[str, object]], max_terms: int = 20) -> list[dict[str, object]]:
    """Select glossary entries relevant to the current segment to keep prompts focused."""
    lower = text.lower()
    matched = [e for e in entries if str(e.get("term_en", "")).lower() in lower]
    return matched[:max_terms]


def format_glossary_prompt(entries: list[dict[str, object]]) -> str:
    """Format matched glossary entries as concise guidance for the translator."""
    if not entries:
        return ""
    lines = ["Terminoloji rehberi (bağlama göre uygula, yerleşik terimleri gerektiğinde parantez içinde koru):"]
    for item in entries:
        en = item["term_en"]
        tr = item["term_tr"]
        note = item.get("context_note") or ""
        parens = " [ilk geçişte İngilizcesini parantezde koru]" if item.get("keep_english_parens") else ""
        lines.append(f"- {en} -> {tr}{parens}" + (f" ({note})" if note else ""))
    return "\n".join(lines)
