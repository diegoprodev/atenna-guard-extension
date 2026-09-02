FROM python:3.12-slim

WORKDIR /app

# System dependencies: Tesseract OCR (PT-BR + EN) + poppler (backup) + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Upgrade pip first (fixes CVE-2025-8869, CVE-2026-1703, CVE-2026-3219, CVE-2026-6357)
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Download spaCy NLP models
RUN python -m spacy download pt_core_news_sm && \
    python -m spacy download en_core_web_sm

COPY . .

# Roda como usuário sem privilégio (não-root)
RUN useradd --system --uid 10001 --home-dir /app --no-create-home atenna \
    && mkdir -p /app/data \
    && chown -R atenna:atenna /app
USER atenna

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
