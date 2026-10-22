FROM python:3.12-slim AS base

# Install rclone
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl https://rclone.org/install.sh | bash \
    && apt-get purge -y curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Non-root user
RUN useradd -r -u 1001 -m syncdeck
USER syncdeck

# Data directory (DB lives here when mounted)
VOLUME ["/data"]
ENV DB_PATH=/data/syncdeck.db

EXPOSE 8768

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8768"]
