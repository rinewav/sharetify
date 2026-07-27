# 中央サーバー。
#
# ここを流れるのは識別子・メタデータ・再生位置だけで、音声は通らない。
# だから小さくてよく、置き場所も選ばない。

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# まず依存の一覧だけ写して取り込む。中身が変わらない限り使い回せる。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/hub/package.json packages/hub/
RUN pnpm install --frozen-lockfile --filter @sharetify/hub... --prod=false

# 中身を写して組み上げる
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/hub packages/hub
RUN pnpm --filter @sharetify/shared build \
 && pnpm --filter @sharetify/hub exec tsc -p tsconfig.build.json

# 走らせるのに要るものだけ残す
RUN pnpm install --frozen-lockfile --filter @sharetify/hub... --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# 管理者のまま走らせない。入り込まれたときに動ける範囲を狭くしておく。
RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=app:app /app/packages/hub/dist ./packages/hub/dist
COPY --from=build --chown=app:app /app/packages/hub/package.json ./packages/hub/
COPY --from=build --chown=app:app /app/packages/hub/node_modules ./packages/hub/node_modules

# 覚えておくものはここに置く。入れ物を作り直しても残るよう外から繋ぐ。
RUN mkdir -p /app/data && chown app:app /app/data
VOLUME ["/app/data"]

USER app
EXPOSE 47820
ENV PORT=47820

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:47820/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/hub/dist/index.js"]
