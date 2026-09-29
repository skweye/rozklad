# Google OAuth и Classroom на Cloudflare Workers

Развёртывание: [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). Google-проверка выполняется в `server/worker.mjs`, сессии — в `server/lib/auth.mjs`. Браузер использует API на том же домене `/api/auth/*`.

## Существующий Google-проект можно оставить

Если адрес остаётся `https://newrozklad.pp.ua`, переезд хостинга не требует нового Google OAuth client. Не удаляйте действующую настройку OAuth и подтверждение домена.

В Google Cloud / Google Auth Platform:

1. **Clients → Web application**: Authorized JavaScript origins — `https://newrozklad.pp.ua` без пути. Для локальной разработки желательно отдельный клиент с `http://localhost:8787`.
2. **Branding**: название «Навчальний простір», контакт `skweye.su@gmail.com`, ссылки:

| Поле | Адрес |
| --- | --- |
| Application home page | `https://newrozklad.pp.ua/` |
| Application privacy policy link | `https://newrozklad.pp.ua/privacy.html` |
| Application terms of service link | `https://newrozklad.pp.ua/terms.html` |

3. Подтвердите владение собственным доменом, если Google требует этого. При смене nameserver сохраните проверочную DNS TXT-запись. Не пытайтесь подтвердить владение общими доменами `workers.dev` или `netlify.app`.
4. В **APIs & Services → Library** включите **Google Classroom API** в том же проекте.
5. В **Data Access** добавьте `openid`, `email`, `profile` и read-only scope:
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.coursework.me.readonly`
6. В **Audience**: пока приложение в Testing, добавьте нужные тестовые аккаунты. Для общего доступа выполните требования публикации/верификации Google. Учебная организация может отдельно ограничивать сторонние приложения.

Используется popup Google Identity Services OAuth token client. Redirect URI для этого потока не нужен; **Google Client Secret не требуется**.

## Настройки Worker

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put AUTH_SESSION_SECRET
```

Client ID заканчивается на `.apps.googleusercontent.com`. Секрет сессии — случайная строка не короче 32 символов. Используйте прежний секрет для совместимого переноса; если он скомпрометирован, замените его. Не публикуйте его в GitHub или клиентском JS.

В `wrangler.jsonc`: `AUTH_SITE_ORIGIN=https://newrozklad.pp.ua`, `MAIN_ADMIN_EMAIL` — подтверждённая почта владельца. Публикуйте после изменения этих параметров. Для прав нужна привязанная D1 `DB` с применённой миграцией.

Локально скопируйте `.dev.vars.example` в `.dev.vars`, заполните отдельные тестовые значения, выполните `npm run db:local` и `npm run dev`. Статический `server.ps1` не запускает API; используйте Wrangler.

## Безопасность и поведение

«Продовжити з Google» запрашивает профиль и чтение Classroom одной кнопкой. Worker проверяет token info официальной библиотекой Google: audience, идентификатор, срок, scope. Профиль читается сервером через UserInfo, `sub` сверяется с токеном, email должен быть подтверждён. Совместимый ID-token endpoint проверяет подпись, audience, issuer, nonce и срок.

Сессия — подписанная HttpOnly-cookie на 24 часа. Токен Classroom — зашифрованная HttpOnly-cookie максимум на час/до окончания токена. В production используются Secure, SameSite=Lax, __Host-, точная проверка origin и CSRF. Токены не записываются в localStorage, GitHub или D1.

Отказ в Classroom-доступе не запрещает обычный вход. Кнопка повторного подключения запрашивает недостающие scope. Истечение кратковременного токена требует повторного подключения; вечного фонового доступа нет.

## Проверка

1. На основном домене `/api/auth/session` возвращает `configured: true`.
2. Вход, оба Classroom-разрешения, предметы и задания правильного аккаунта.
3. Выход, повторный вход, владелец и обычный пользователь.
4. В другом браузере нет персональных данных предыдущего пользователя.

Соответствия разделов общего курса предметам: `server/lib/classroom-subjects.mjs`. API: `server/lib/classroom.mjs`. Сайт не создаёт, не сдаёт и не меняет задания.

## Ошибки

- **wrong_origin**: открыт workers.dev, www или другой адрес, не совпадающий с настройкой. Не отключайте защиту.
- **Вход не настроен**: проверьте GOOGLE_CLIENT_ID, AUTH_SESSION_SECRET и AUTH_SITE_ORIGIN.
- **Classroom API disabled**: включите API в проекте этого Client ID.
- **Недостаточно разрешений**: подтвердите оба scope. Альтернативное имя Google `classroom.student-submissions.me.readonly` тоже распознаётся.
- **Список пуст**: проверьте аккаунт, активные курсы и незавершённые работы. Школьные ограничения меняет администратор организации.
- **Popup/COOP**: само предупреждение не доказывает ошибку входа; смотрите ответ API. Заголовок same-origin-allow-popups уже настроен.
- **Сервер недоступен**: проверьте Cloudflare и Google; не публикуйте токены, cookie, профили или необработанные ошибки провайдеров.

Политика обновлена под Cloudflare. Владелец должен проверить её соответствие реальной обработке данных. Это техническая подготовка, не гарантия одобрения Google.

[Google production requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) · [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) · [Classroom scopes](https://developers.google.com/workspace/classroom/guides/auth)
