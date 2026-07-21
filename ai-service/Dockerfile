FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_DIR=/app/models

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ffmpeg libglib2.0-0 libgl1 tesseract-ocr tesseract-ocr-ben tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scripts/download_models.sh /tmp/download_models.sh
RUN chmod +x /tmp/download_models.sh && /tmp/download_models.sh

COPY app ./app
COPY tests ./tests

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
