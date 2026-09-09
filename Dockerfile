FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" bunx --bun prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001

USER bun
CMD ["bun", "run", "start"]

