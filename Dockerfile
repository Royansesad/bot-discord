# Node 22 slim — @discordjs/voice (engine native) butuh Node >= 22.12
FROM node:22-slim

# OpenSSL untuk Prisma + ca-certificates untuk fetch HTTPS
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files dulu (layer cache)
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install deps + generate Prisma dalam 1 layer
RUN npm ci --omit=dev && npx prisma generate

# Copy source code
COPY . .

ENV NODE_ENV=production

# Sync DB lalu start bot
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/index.js"]
