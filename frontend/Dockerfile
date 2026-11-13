FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

EXPOSE 3000

ENV PORT=3000

CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
