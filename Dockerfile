# ---------- build stage: собираем client + server ----------
FROM node:20-slim AS build

WORKDIR /app

# сначала зависимости — кэшируется слой за слоем
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --prefix server && npm install --prefix client

COPY . .
RUN npm run build --prefix client && npm run build --prefix server

# ---------- runtime stage: Node + Chromium ----------
FROM node:20-slim

# системные библиотеки для headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/var/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# зависимости рантайма
COPY package.json ./
COPY server/package.json ./server/
RUN npm install --omit=dev --prefix server

# артефакты сборки
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# сам Chromium (кэшируется в слой образа)
RUN npx --prefix server playwright install chromium

RUN mkdir -p /var/data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
