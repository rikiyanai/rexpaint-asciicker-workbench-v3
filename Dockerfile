FROM python:3.11-slim

WORKDIR /app

# Install system deps for Pillow (JPEG, PNG, freetype support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo-dev zlib1g-dev libfreetype6-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package metadata first (layer caching: deps reinstall only when these change)
COPY pyproject.toml README.md ./

# Non-editable install — editable installs need the full source tree at install time
RUN pip install --no-cache-dir ".[deploy]"

# Copy application code and assets
COPY src/ src/
COPY web/ web/
COPY config/ config/
COPY sprites/ sprites/
COPY runtime/ runtime/
# scripts/glyph_assignment is imported at startup by service.py (commit 07c778a:
# "promote Upload PNG to rich CP437 glyph matcher") — must be present in image.
COPY scripts/glyph_assignment/ scripts/glyph_assignment/
# glyph_assignment/font_atlas.py imports BdfFont + CP437_TO_UNI from png2xp2png.py.
COPY scripts/png2xp2png.py scripts/png2xp2png.py
COPY wsgi.py .

# Create data directories (ephemeral on Cloud Run)
RUN python3 -c "import sys; sys.path.insert(0,'src'); from pipeline_v2.config import ensure_dirs; ensure_dirs()"

# Cloud Run sets PORT at runtime (default 8080)
ENV PORT=8080
ENV PIPELINE_HOST=0.0.0.0
ENV PIPELINE_BASE_PATH=/xpedit

EXPOSE ${PORT}

# Single worker: Cloud Run single-instance MVP, no need for multi-worker
CMD exec gunicorn wsgi:app \
    --bind 0.0.0.0:${PORT} \
    --workers 1 \
    --threads 4 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
