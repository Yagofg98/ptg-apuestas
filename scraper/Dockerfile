# Scraper PTG para desplegar en Railway/Render (servicio always-on).
# Sesión: pásala como variable SESSION_JSON (contenido de .ptg-session.json).
FROM node:22-bookworm-slim
WORKDIR /app/scraper

COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . ./

# npm start = bucle de sondeo (cada POLL_INTERVAL_SECONDS). Sin .env: usa variables del entorno.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
