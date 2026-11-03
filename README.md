# UniGen

Генератор видео и фото через облачные провайдеры:

| Модель         | Провайдер               | Тип   |
|----------------|-------------------------|-------|
| MiniMax h3     | https://h3-max.me/      | Видео |
| Kling 2.1      | https://polyfaced.com/  | Видео |
| GPT Image 2    | h3-max / polyface       | Фото |
| Nano Banana    | h3-max / polyface       | Фото |

Пользователь вводит промт и параметры на веб-сайте → бэкенд через headless Chromium
(Playwright) заходит на сайт провайдера, при необходимости регистрирует аккаунт через
временную почту (temp-mail.io напрямую через браузер), заполняет форму генерации, поллит статус, скачивает
результат и отдаёт его обратно в UI (плеер для видео, превью для фото).

---

## Структура репозитория

```
unigen/
├── README.md
├── render.yaml            # Render Blueprint
├── Dockerfile             # образ Node + Chromium
├── .dockerignore
├── .gitignore
├── package.json           # корневые скрипты (build/dev/start)
├── server/                # Express + Playwright + SQLite + очередь
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts       # точка входа, раздача статики, /health
│       ├── config.ts      # env
│       ├── logger.ts      # логи с уровнем
│       ├── db.ts          # better-sqlite3 (аккаунты, генерации)
│       ├── queue.ts       # in-process очередь, лимит параллельности
│       ├── tempmail.ts    # temp-mail.io: адрес с сайта, письмо, код/ссылка активации
│       ├── api.ts         # REST API
│       ├── generator.ts   # оркестрация: аккаунт → форма → поллинг → скачивание
│       └── providers/
│           ├── types.ts   # интерфейс адаптера + типы параметров
│           ├── pw.ts      # хелперы Playwright (первый видимый селектор и т.п.)
│           ├── h3max.ts   # адаптер h3-max.me
│           ├── polyface.ts# адаптер polyfaced.com
│           └── index.ts   # реестр адаптеров
└── client/                # React + Vite + TypeScript SPA
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── types.ts
        ├── api.ts
        ├── styles.css
        └── components/
            ├── ModelCard.tsx
            ├── GenerateForm.tsx
            ├── ProgressTrack.tsx
            ├── ResultView.tsx
            └── History.tsx
```

---

## Локальный запуск

Требования: Node.js 20+, npm.

```bash
# 1. зависимости
npm install
npm run install:all

# 2. Playwright + Chromium
npx playwright install --with-deps chromium

# 3. дев-режим (сервер :3000, Vite :5173 с прокси на :3000)
npm run dev
```

Прод-сборка:

```bash
npm run build      # client → client/dist, server → server/dist
npm start          # один порт, статика из client/dist
```

Открыть: http://localhost:3000

---

## Деплой на Render

### Вариант A — Docker (рекомендуется)

1. Залейте репозиторий на GitHub.
2. Render → **New** → **Blueprint** → выберите репозиторий.
3. `render.yaml` поднимет Web Service (runtime: docker) сам.
4. Health check: `/health`.

### Вариант B — обычный Web Service (без Docker)

- **Build Command**
  ```bash
  npm ci && npm run install:all && npx playwright install --with-deps chromium && npm run build
  ```
- **Start Command:** `npm start`
- **Runtime:** Node
- **Disk:** подключите диск на `DATA_DIR` (иначе аккаунты и результаты потеряются при редеплое).

### Env-переменные

| Переменная   | Обязательна | Описание                                    |
|--------------|-------------|---------------------------------------------|
| `PORT`       | нет         | по умолчанию 3000                           |
| `DATA_DIR`   | нет         | каталог SQLite + скачанных файлов (default `./data`) |
| `BASE_URL`   | нет         | публичный адрес сервиса для ссылок на файлы |
| `CONCURRENCY`| нет         | параллельных генераций: `1` на 512 МБ (default), `2` если памяти 2 ГБ |
| `LOG_LEVEL`  | нет         | `debug` / `info` / `warn`                   |

Ключи и креды хранятся только в env / в локальной SQLite; пароли временных ящиков
никогда не пишутся в логи в открытом виде.

---

## Как это работает внутри

```
POST /api/generate
   └─► создаётся запись generation (status: queued)
         └─► очередь (лимит CONCURRENCY)
               ├─ 1. account   — берём аккаунт провайдера из БД,
               │                 если нет → регистрация через temp-mail
               ├─ 2. auth      — восстановление session/storage state
               ├─ 3. submit    — заполнение формы провайдера (Playwright)
               ├─ 4. processing— поллинг статуса (с ретраями и таймаутом)
               └─ 5. done      — скачивание mp4/png в DATA_DIR/results
GET /api/generations/:id  ──► UI опрашивает и рисует прогресс
GET  /api/results/:id     ──► отдаёт файл (видео/фото)
```

- **Аккаунты:** таблица `accounts` (provider, email, storage state, куки) — повторно
  используется, повторная регистрация не нужна.
- **Очередь:** in-process, `CONCURRENCY` слотов (default 1 — влезает в 512 МБ),
  автоматические ретраи (2 попытки) с экспоненциальной задержкой.
- **Память:** браузер поднимается на каждую генерацию и закрывается вместе с ней,
  шрифты/медиа в табе блокируются, результат качается потоком на диск — пик RSS
  держится в районе 350–450 МБ.
- **Сбои вёрстки:** каждый адаптер ищет селекторы по списку-фоллбэку; если ничего
  не найдено — в лог пишется понятное сообщение с текущим URL и структурой формы,
  генерация падает со статусом `error` и понятной причиной.

---

## Если провайдер поменял вёрстку

1. Включите `LOG_LEVEL=debug`.
2. Посмотрите лог: адаптер напишет, какой селектор не сработал и что видит на странице.
3. Поправьте массив селекторов в `server/src/providers/h3max.ts` или `polyface.ts`.
4. Задеплойте — фронтенд трогать не нужно.
