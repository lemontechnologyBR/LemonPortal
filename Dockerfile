FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build:portal

RUN apk del python3 make g++

EXPOSE 3000

CMD ["node", "server.js"]
