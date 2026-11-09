# SnapPrints backend — Railway (or any Docker host).
# LibreOffice converts Word files to PDF so they are priced by their real page
# count; Noto fonts cover Hindi / Marathi (Devanagari) text in documents.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-dejavu-core fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 5000
CMD ["node", "src/server.js"]
