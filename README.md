# Навчальний простір

Расписание, редактор отчётов, Google Classroom и админ-панель.
Код хранится на GitHub, весь сайт и `/api/auth/*` работают на **Cloudflare Workers**, общие данные — в **Cloudflare D1**. GitHub Pages включать не нужно.

## Начать здесь

Пошаговый запуск, GitHub, домен и перенос с прежнего хостинга: **[CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)**.

- [Google OAuth и Classroom](GOOGLE_AUTH_SETUP.md)
- [Администраторы, замены и онлайн-пользователи](SCHEDULE_REPLACEMENTS.md)
- [Одноразовый перенос данных](MIGRATION_FROM_NETLIFY.md)

## Локальная разработка

Нужен Node.js 24 LTS с npm. В корне проекта:

```sh
npm ci
npm run db:local
```

Скопируйте `.dev.vars.example` в `.dev.vars` и заполните тестовые настройки Google и отдельный секрет. Затем:

```sh
npm run dev
```

Адрес: `http://localhost:8787`. После правок HTML/CSS/клиентского JS выполните `npm run build`; серверные файлы отслеживаются Wrangler. Локальная D1 отделена от облачной. Без Google-настроек расписание и отчёты доступны, вход выключен.

```sh
npm test
npm run check:worker
npm run test:worker
```

Последняя команда проверяет настоящий локальный Workers runtime и D1 с тестовыми данными, не обращается к вашей облачной базе и не требует Google-аккаунта. Реальное окно OAuth нужно проверить вручную после настройки домена.

## Структура

- `index.html`, `reports/`, `admin/` — интерфейс.
- `server/worker.mjs` — точка входа API.
- `server/lib/` — проверка Google, сессии, Classroom, права, замены, присутствие.
- `server/d1-store.mjs`, `migrations/` — хранилище с атомарной проверкой версий.
- `wrangler.jsonc` — параметры хостинга; `database_id` необходимо заполнить.
- `scripts/build.mjs` — копирование только разрешённых публичных файлов в `dist/`.
- `.github/workflows/check.yml` — проверки при push и pull request, без секретов и публикации.
- `tools/netlify-export/` — необязательный одноразовый экспорт старых данных; не входит в сайт, сборку или основные зависимости.

Не публикуйте `.env*`, `.dev.vars*` (кроме файлов-примеров), `.wrangler/`, `private-backups/`, `node_modules/`, личные отчёты и резервные копии. `AUTH_SESSION_SECRET` и токены никогда не должны находиться в репозитории.
