FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 4173
CMD ["node", "server/index.js"]
