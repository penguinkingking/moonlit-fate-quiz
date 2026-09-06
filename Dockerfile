FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:offline

RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/offline-build ./offline-build
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.mjs"]
