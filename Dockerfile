FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV KANBAN_DATA_DIR=/data

COPY package.json ./
COPY server.mjs ./
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 3001

CMD ["node", "server.mjs"]
