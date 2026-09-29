# Диагностика Google-входа

Исправлен воспроизведённый сбой `profile/runtime`: workerd отклоняет режим `redirect: 'error'`. Запрос профиля теперь использует `manual` и явно отклоняет любой неуспешный ответ, включая перенаправления. Bearer-токен не пересылается по `Location`. Регрессионная проверка использует нативный `Request` среды Cloudflare, а не только Node.js.

После публикации при ошибке проверки Google-доступа окно входа показывает код `google-…`, этап и категорию сбоя. Те же сведения доступны в DevTools → Network → `google-connect` (или `classroom-connect`) → Response → `diagnostic`.

- `token` — проверка Google access token.
- `profile` — получение профиля Google.
- `http` — Google вернул HTTP-статус, указанный в `upstreamStatus`.
- `timeout` / `network` — тайм-аут или известная сетевая ошибка.
- `invalid_response` — ошибка разбора ответа.
- `runtime` — TypeError; сама категория не доказывает несовместимость Cloudflare.
- `unknown` — ошибка без распознанной безопасной категории.

В Cloudflare откройте **Workers & Pages → Worker → Observability → Logs**. Найдите событие `google_auth_failure` с тем же `id`. В конфигурации включены Workers Logs, обычные invocation logs выключены.

Наши записи содержат только случайный ID, этап, категорию, разрешённый сетевой код и числовой HTTP-статус. Исходные исключения, стеки, URL запросов, токены, cookie, имена и почты в них не записываются. Не включайте подробное логирование Google-библиотеки и не отправляйте Request Payload или Headers из DevTools.

Изменения нужно отправить в GitHub и опубликовать через Cloudflare. Новые секреты не требуются; действующие настройки Google, домена и ID базы D1 сохраняются. После публикации повторите вход; если он всё ещё не проходит, передайте новый текст ошибки с кодом.

[Документация Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
