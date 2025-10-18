# Multi-stage Dockerfile: build Vite frontend, run Node server

# 1) Build stage
FROM node:18-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies for build
COPY package.json package-lock.json* ./
RUN npm ci --silent

# Copy source and build
COPY . .
RUN npm run build --silent

# 2) Production image
FROM node:18-alpine
WORKDIR /app

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm ci --production --silent

# Copy built frontend and server code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/package.json ./package.json

EXPOSE 3001
ENV NODE_ENV=production

# Default port (Render uses $PORT env var automatically)
ENV PORT=3001

CMD ["node", "server.js"]
