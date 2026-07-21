# BlockQuest 서버 — Railway/Fly.io/자체 서버 등 어디서나 동일하게 실행
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
