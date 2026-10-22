FROM python:3.12-slim AS base

# Copy official rclone binary (fast, multi-arch, no unzip dependency required)
COPY --from=rclone/rclone:latest /usr/local/bin/rclone /usr/local/bin/rclone

# Install system certificates
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create non-root user and prepare directories with correct ownership
RUN useradd -r -u 1001 -m syncdeck \
    && mkdir -p /data \
    && chown -R syncdeck:syncdeck /data /app

USER syncdeck

# Data directory (DB lives here when mounted)
VOLUME ["/data"]
ENV DB_PATH=/data/syncdeck.db

EXPOSE 8768

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8768"]
