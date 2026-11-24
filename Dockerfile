# syntax=docker/dockerfile:1

# Executor: HTTP-сервис каталога и исполнения.
#
# Сборка в несколько этапов: полные зависимости и проверки остаются в
# промежуточных слоях, в итоговый образ попадают только production-зависимости и
# исходники. Компиляции в dist нет — TypeScript снимается на лету через tsx,
# поэтому tsx лежит в dependencies, а не в devDependencies. Нативное снятие
# типов (`node src/main.ts`) не подходит: в src/errors.ts есть parameter
# properties, а strip-only режим их не поддерживает.

ARG NODE_VERSION=26-alpine
ARG YARN_VERSION=1.22.22

# В образах node начиная с 25 нет ни yarn, ни corepack — ставим тот yarn,
# которым собран yarn.lock.
FROM node:${NODE_VERSION} AS base
ARG YARN_VERSION
RUN npm install --global yarn@${YARN_VERSION}
WORKDIR /app
COPY package.json yarn.lock ./

FROM base AS deps
RUN yarn install --frozen-lockfile

# Проверки. В образ этот слой не попадает, но ломает сборку: tsc в рантайме нет,
# и ошибку типов там обнаружить уже некому. Тесты сети не требуют.
FROM deps AS check
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN yarn typecheck && yarn test

FROM base AS prod-deps
RUN yarn install --frozen-lockfile --production && yarn cache clean

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
# Исходники берутся из проверенного слоя: иначе BuildKit выбросил бы check из
# графа сборки и проверки молча не выполнялись бы.
COPY --from=check /app/tsconfig.json ./tsconfig.json
COPY --from=check /app/src ./src

# База лежит в томе, а не в слое образа: контейнер одноразовый, каталог записей
# нет. Путь перекрывает значение из .env, рассчитанное на локальный запуск.
ENV DB_PATH=/data/executor.sqlite
RUN mkdir -p /data && chown node:node /data

ENV PORT=8787
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# node первым процессом, а не yarn: SIGTERM должен доходить до приложения —
# main.ts на нём закрывает наблюдателя, сервер и базу.
CMD ["node", "--import", "tsx", "--no-warnings=ExperimentalWarning", "src/main.ts"]
