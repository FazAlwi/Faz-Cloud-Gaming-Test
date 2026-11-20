# Stage 1: Build the React + Vite + TypeScript frontend
FROM node:22-alpine AS client-builder
WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# Stage 2: Lightweight Cloud Run control plane (serves client/dist + proxies /api/* + wakes GPU VM)
FROM node:22-alpine AS runner
WORKDIR /app/control-plane

ENV NODE_ENV=production
ENV PORT=8080

COPY control-plane/package.json control-plane/package-lock.json* ./
RUN npm install --omit=dev

COPY control-plane/src/ ./src/
COPY server/src/data/games.js /app/server/src/data/games.js
COPY --from=client-builder /app/client/dist /app/client/dist

EXPOSE 8080
CMD ["node", "src/index.js"]
