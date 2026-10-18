# Установка

[English](install.md) · [К README](../README.ru.md)

## Свой сервер из приложения

Основной путь: приложение для Mac или Windows ([скачать](https://github.com/gomex-inc/gomex/releases/tag/desktop)),
без терминала и своего домена.

1. **VPS-сервер.** Ubuntu или Debian (x86_64 или arm64), 1–2 ГБ ОЗУ, 3 ГБ на диске, доступ root. IP и пароль
   приходят от хостера.
2. **«Свой сервер» в приложении.** IP и пароль root. Адрес — бесплатный `имя.dedyn.io` на [deSEC](https://desec.io)
   (имя и почта, подтверждение письмом) или свой домен с тремя A-записями.
3. **Установка.** Около пяти минут, шаги на экране. Приложение запускает тот же установщик по SSH, затем открывает
   настройку сервера: название, значок, администратор, ссылка-приглашение.

Вход по паролю после установки выключается, у приложения остаётся свой ключ (в связке ключей системы). Если письмо от
deSEC не пришло за 15 минут, приложение предлагает другую почту или свой домен.

## Установка командой

Для своего домена и тех, кто ставит из терминала. Понадобятся:

- VPS на Ubuntu или Debian (x86_64 или arm64), доступ root. Память от 1 ГБ (лучше 2), на диске от 3 ГБ свободно,
  порты 80 и 443 свободны.
- Домен с тремя A-записями на IP сервера: сам домен, `app.` и поддомен для звонков. Его имя установщик
  выберет сам и покажет таблицей. В Cloudflare — серое облако, только DNS: через прокси звонки не пройдут.

На сервере:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh
```

Если GitHub недоступен, тот же релиз лежит в npm как пакет `@gomex.llc/install` (Node на сервере не нужен):

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@gomex.llc/install@latest/install.sh | sh
```

Архив релиза установщик тоже скачает оттуда, если GitHub не отвечает, и сверит ту же SHA-256.

Мастер проверит сервер, спросит домен, покажет итог и поставит всё сам: Docker (get.docker.com), ufw,
вход по SSH-ключу, `.env` с секретами, ночные бэкапы, образы релиза. В конце — ссылка
`https://app.ДОМЕН/?setup=КОД`. Стрелки и Enter — выбор, Esc — шаг назад. Без терминала или без gum те же шаги
идут простыми вопросами.

Без вопросов, для скриптов:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | DOMAIN=chat.example.com GOMEX_YES=1 sh
```

Обновление: повторный запуск, или без вопросов:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s update
```

Ссылка для первой настройки (с кодом установки) ещё раз, пока настройка не закончена:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s link
```

Вернуть данные из ночной копии (удалили канал по ошибке или сервер сломался; на новом сервере сначала положи копии
в `/root/gomex-backups/daily`):

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s restore
```

Установщик покажет копии с датой и размером, спросит, какую вернуть (`GOMEX_YES=1 GOMEX_RESTORE=2026-10-18` — без
вопросов), сохранит нынешние данные копией `pre-restore-<время>` в той же папке, остановит приложение, положит данные
на место, запустит и проверит, что оно отвечает. Ошибочный выбор отменяется тем же `restore` с копией `pre-restore-…`.

Удалённый канал возвращать так не нужно: он неделю лежит в «Сервер → Удалённые каналы», оттуда его возвращает админ.

Снять Gomex с сервера:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s uninstall
```

Установщик спросит подтверждение (`GOMEX_YES=1` — без вопроса), остановит контейнеры и удалит их образы, папку
`/opt/gomex` (`.env`, переписка, файлы), бэкапы в `/root/gomex-backups`, ночной таймер, свой файл и лог в `/root` и
`/var/log`. Вход по SSH вернётся к тому, что было: уберётся файл `00-gomex-key-only.conf` и ключ приложения (строка с
комментарием `gomex-app`). Docker и ufw остаются. Вернуть удалённое нельзя, бэкапы тоже.

`.env` и данные при обновлении не трогаются. Дополнительные переменные установщика описаны в шапке
[`deploy/install.sh`](../deploy/install.sh): `SERVER_NAME`, `TURN_HOST`, `GOMEX_DIR` (по умолчанию `/opt/gomex`),
`GOMEX_NO_GUM=1`, `GOMEX_FIREWALL=0`, `GOMEX_SSH=0`, свой архив релиза или реестр образов.

Обложку на самом домене установщик пишет заново при каждом обновлении. Свой сайт кладётся в
`/opt/gomex/landing/site` вместе с пустым файлом `.custom`: тогда установщик его не трогает. Страницы открываются
без `.html`: `/about` — это `about.html`.

Свои блоки Caddy кладутся файлами `*.caddy` в `/opt/gomex/deploy/sites`, обновления их не трогают. Например,
`www.caddy` для переадресации с `www.` (нужна A-запись `www`):

```caddy
www.{$DOMAIN}, http://www.{$DOMAIN} {
	redir https://{$DOMAIN}{uri} permanent
}
```

Свои маршруты внутри приложения (`app.DOMAIN`) кладутся файлами `*.caddy` в `/opt/gomex/deploy/routes/app`, раньше
маршрутов самого приложения; обновления их не трогают, по умолчанию их нет. Каждая страница приложения загружает
`/owner.js`, в Gomex он пустой; свой скрипт отдаётся маршрутом оттуда же:

```caddy
handle /owner.js {
	root * /etc/caddy/routes/app
	file_server
}
```

CSP приложения разрешает только его собственный адрес, поэтому всё, куда ходит такой скрипт, тоже идёт через маршрут.

После правки, без обрыва звонков:
`cd /opt/gomex/deploy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
