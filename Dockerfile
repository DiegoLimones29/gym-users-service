FROM node:24-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ && npm install -g pnpm@12

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ && npm install -g pnpm@12

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY scripts ./scripts

EXPOSE 3001
CMD ["node", "dist/main"]
