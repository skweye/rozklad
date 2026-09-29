# Запуск через GitHub + Cloudflare без Netlify

Код подготовлен для Cloudflare Workers + D1. Аккаунты, база, секреты, GitHub-репозиторий и DNS автоматически не создавались. Старый опубликованный сайт пока не изменён.

## 1. Подготовка

1. Создайте аккаунты GitHub и Cloudflare, если их ещё нет.
2. Установите Node.js **24 LTS** с npm и Git (либо GitHub Desktop).
3. Откройте терминал в папке проекта, где находятся `package.json` и `wrangler.jsonc`.
4. Пока не удаляйте старый сайт, переменные и Netlify Blobs. Если он связан с тем же GitHub-репозиторием, сначала остановите его автоматическую публикацию, чтобы отправка новой конфигурации не запустила неподходящую сборку Netlify.
5. Выполните:

```sh
npm ci
npm test
npm run check:worker
npm run test:worker
npx wrangler login
```

`check:worker` — локальная пробная сборка без публикации. `test:worker` запускает изолированный локальный runtime. `login` откроет браузер для входа в ваш Cloudflare.

## 2. Создайте базу

```sh
npx wrangler d1 create newrozklad
```

Команда выдаст `database_id`. В `wrangler.jsonc` замените **только** `00000000-0000-0000-0000-000000000000` на полученный UUID; `binding` должен остаться `DB`. Это идентификатор базы, не пароль.

```sh
npm run db:remote
```

Подтвердите применение миграции. Она создаёт таблицу `site_records`; существующие данные не удаляет. Миграции запускаются отдельно от автоматического deploy, чтобы изменения базы были осознанными. Для будущей версии с новыми миграциями сначала делайте резервную копию D1, затем применяйте миграции и публикуйте совместимый код.

## 3. Настройки и первый deploy

В `wrangler.jsonc` уже указаны:

| Настройка | Значение |
| --- | --- |
| `name` | `newrozklad` |
| `AUTH_SITE_ORIGIN` | `https://newrozklad.pp.ua` |
| `MAIN_ADMIN_EMAIL` | `ym_hryzhenko_081205@dtsepaton.ukr.education` |

Origin — точный адрес без пути; `www` и адрес без `www` считаются разными. Главный администратор — один подтверждённый Google email. Эти два открытых параметра меняйте в файле и публикуйте заново, а не только в Dashboard: конфигурация из Git является источником настроек.

```sh
npm run deploy
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put AUTH_SESSION_SECRET
```

Каждая команда `secret put` попросит значение отдельно. Client ID возьмите из существующего Google OAuth Web client. Client Secret Google не требуется. До ввода секретов авторизация будет выключена; это ожидаемо.

**Для переноса используйте прежний `AUTH_SESSION_SECRET` из Netlify**, не присылая его в чат: тогда при том же домене можно сохранить совместимость cookie и служебных идентификаторов авторов замен. При утечке старого секрета используйте новый, даже если потребуется повторный вход. Новый секрет для чистого запуска можно создать локально:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Не вставляйте секреты в `wrangler.jsonc`, исходники или GitHub. В Cloudflare они доступны в Worker → Settings → Variables and Secrets как Secret; входящие HTTP-запросы не должны логироваться с cookie/токенами.

Команда deploy выдаст адрес `https://newrozklad.<ваш-subdomain>.workers.dev`. На нём можно проверить внешний вид, отчёты и общедоступные данные. **Вход там намеренно отклоняется**, пока `AUTH_SITE_ORIGIN` указывает на основной домен. Не снимайте проверку origin ради предпросмотра. Для полноценной проверки до переключения используйте отдельный тестовый Worker/D1 с origin тестового домена и отдельными секретами.

## 4. Перенесите данные до переключения

Если есть действующие замены или выданные права, выполните [MIGRATION_FROM_NETLIFY.md](MIGRATION_FROM_NETLIFY.md). Без импорта база пустая: основное расписание сохранится из `schedule.json`, но старые замены и делегированные права не появятся сами.

Локальные отчёты и темы не лежат на сервере. Они сохранятся при том же **точном origin** `https://newrozklad.pp.ua` в том же браузере. Перед переездом всё равно экспортируйте важные черновики. Данные с `newrozklad.netlify.app` автоматически не переходят на другой адрес — экспортируйте/импортируйте их через редактор.

## 5. Подключите домен newrozklad.pp.ua

1. Добавьте `newrozklad.pp.ua` в Cloudflare как зону. Сравните импортированные DNS-записи с текущими: сохраните MX, TXT, записи почты и Google verification. Экспортируйте старую DNS-зону для отката.
2. У регистратора NIC.UA укажите **ровно те два nameserver, которые выдаст ваш Cloudflare**. Не используйте примерные NS из чужой инструкции. При включённом DNSSEC следуйте шагам Cloudflare/регистратора для корректной смены DS-записи.
3. Дождитесь статуса зоны **Active**. Смена DNS-провайдера сама по себе не переносит сайт: на этом этапе прежние записи сайта должны ещё указывать на старый хостинг.
4. Когда данные перенесены и вы готовы переключиться, откройте Cloudflare → **Workers & Pages → newrozklad → Settings → Domains & Routes → Add → Custom domain**, укажите `newrozklad.pp.ua`.
5. Если Cloudflare сообщает о конфликтующей A/AAAA/CNAME, сохраните её значение для отката и замените **только записи этого имени**, ведущие на прежний хостинг. Почтовые и проверочные TXT не удаляйте. Custom Domain управляет нужной DNS-записью и сертификатом; не направляйте просто CNAME на `workers.dev`.
6. Дождитесь активации сертификата и откройте `https://newrozklad.pp.ua` в приватном окне.

Основной адрес без `www`. Если нужен `www`, настройте отдельный HTTPS-редирект на основной адрес; не добавляйте второй авторизационный origin без необходимости.

## 6. Google и финальная проверка

В Google Cloud → Google Auth Platform → Clients → ваш Web client проверьте **Authorized JavaScript origins**: `https://newrozklad.pp.ua`. Для локальной разработки добавьте `http://localhost:8787` в отдельный тестовый клиент. Убедитесь, что Classroom API включён. Подробности: [GOOGLE_AUTH_SETUP.md](GOOGLE_AUTH_SETUP.md).

Проверьте вручную:

- Расписание, отчёты, переключение тем и скачивание DOCX.
- Вход Google, загрузку Classroom, выход и повторный вход.
- Главного администратора, список прав и онлайн-пользователей.
- Создание замены/окна на будущую дату, видимость в другом браузере и отмену.
- Отказ в изменении замен у пользователя без прав и редирект из админ-панели.
- Отсутствие собственной нотификации у автора замены.

Только после этого отключайте старый хостинг и отзывайте временный токен экспорта. Не удаляйте резервную копию до уверенной проверки. При откате на старый сервер новые записи D1 автоматически туда не попадут — остановите изменения и сначала согласуйте данные, чтобы не потерять правки.

## 7. Загрузите проект в GitHub

Создайте **пустой private-репозиторий** `newrozklad` без автоматически созданного README. В терминале проекта (если Git ещё не инициализирован):

```sh
git init -b main
git status --short --untracked-files=all
git add .
git diff --cached --name-only
```

Проверьте список: там не должно быть `.env`, `.env.migration`, `.dev.vars`, резервных копий, личных документов, `node_modules`, `dist` и `.wrangler`. Файлы-примеры с `replace-...` публиковать можно. Если секрет уже попал в Git, `.gitignore` его не удалит из истории: остановитесь, отзовите секрет и очистите историю до публикации.

Затем замените `<ВАШ_ЛОГИН>` настоящим именем аккаунта:

```sh
git commit -m "Migrate site to Cloudflare Workers and D1"
git remote add origin https://github.com/<ВАШ_ЛОГИН>/newrozklad.git
git push -u origin main
```

Если это уже Git-репозиторий, не создавайте повторно remote/ветку — используйте его настройки. Папка `.github` и `wrangler.jsonc` должны попасть в репозиторий. GitHub Pages не включайте.

## 8. Автоматическая публикация из GitHub

В существующем Worker `newrozklad` откройте **Settings → Builds**, подключите GitHub-репозиторий и ветку `main`. Название Worker должно совпадать с `name` в `wrangler.jsonc`.

- Root directory: корень репозитория.
- Build command: `npm test && npm run check:worker && npm run test:worker`.
- Deploy command: `npx wrangler deploy`.
- Node.js: 24 (при необходимости задайте `NODE_VERSION=24` в настройках сборки).
- Не включайте автоматические preview-deploy для других веток с production-базой. Для preview используйте отдельный Worker, D1, origin и секреты.

После push в `main` Cloudflare проверит код и опубликует сайт вместе с API. Секреты остаются на Cloudflare; GitHub Actions в этом проекте только выполняет проверки и не требует Cloudflare API token. Не настраивайте одновременно второй автодеплой через Actions.

## Диагностика

- `configured: false` в `/api/auth/session`: не заполнены секреты Google/сеанса или неверен origin.
- `wrong_origin`: адрес в браузере не совпадает с `AUTH_SITE_ORIGIN`. Не обходите эту защиту.
- `replacements_unavailable`, `permissions_unavailable`, `presence_unavailable`: проверьте привязку `DB`, UUID базы и применение миграции.
- Сборка не находит `wrangler`: устанавливайте devDependencies (`npm ci` без `--omit=dev`).
- Старые цвета/файлы: обычное обновление страницы; не очищайте всё хранилище браузера без экспорта черновиков.
- Серверные файлы и секреты не должны открываться по URL; опубликован только allowlist из `dist`.

## Документация провайдеров

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers Builds из Git](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

Перед запуском проверьте текущие лимиты своего тарифа Workers/D1: они зависят от числа запросов, чтений и записей. Онлайн-статус и опрос замен тоже расходуют лимиты. Платные услуги эта подготовка автоматически не подключает.
