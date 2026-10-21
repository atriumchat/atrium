# Разработка

[English](development.md) · [К README](../README.ru.md)

## Локальная разработка

Нужны Python 3.13, Node 22 и [LiveKit](https://docs.livekit.io/home/self-hosting/local/). Три процесса в трёх
терминалах.

LiveKit в dev-режиме: его ключи `devkey` / `secret` совпадают с настройками сервера по умолчанию.

```bash
brew install livekit
livekit-server --dev
```

Сервер на порту 8010 (туда проксирует Vite), данные в `server/data`:

```bash
cd server
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8010 --reload
```

Клиент на http://localhost:5190, `/api` и `/socket.io` уходят на сервер:

```bash
npm ci              # из корня репозитория: web, mobile и packages/* — npm-воркспейсы
npm run dev -w web
```

На пустой базе откроется мастер первого запуска. Код по умолчанию — `friends`.

Общий код лежит в `packages/` (`@gomex/ui-common`, `@gomex/ui-web`, `@gomex/ui-native`, `@gomex/setup`; см.
[ADR-001](adr/001-client-architecture.md)). Нужны Node 24.3+ и npm 11: npm 10.8 падает на этом дереве. После добавления
пакета — `npm install` в корне и перезапуск dev-серверов, Metro с `--clear`: новую ссылку воркспейса на ходу они не видят.

Десктоп против локального клиента. Скрипт `npm run dev` смотрит на старый порт 5180, поэтому адрес задаётся явно:

```bash
cd desktop
npm ci
GOMEX_URL=http://localhost:5190 npm start
```

Окна приложения, сделанные на React (`desktop/ui`, пока «Свой сервер»), собираются в `desktop/ui-dist` перед `npm start`
и сборками `dist:*` (`npm run ui`); `npm run desktop-ui` в корне отдаёт их для работы над дизайном, на выдуманных
ответах и без главного процесса (`onboarding.html#step=install`).

`GOMEX_LANG=ru` или `GOMEX_LANG=en` задаёт язык десктопа; по умолчанию — язык системы.

Проверки перед коммитом (CI гоняет то же, .github/workflows/checks.yml):

```bash
npm run check              # ESLint (границы пакетов, хуки, никаких цветов руками в Gomex Flow), типы, тесты, сборки
server/.venv/bin/python -m pytest -q server/tests  # изолированный SQLite и фикстуры деплоя
deploy/release.sh lint     # bash -n и shellcheck по всем скриптам deploy/
```

## Релизы

Только для сопровождающего, с Mac, из закоммиченного дерева.

**Сервер.** Тег, образы, архив и закреплённый на них установщик:

```bash
deploy/release.sh 1.2.3
```

Скрипт ставит тег `v1.2.3` и пушит его. GitHub Actions собирает и публикует образы в `ghcr.io/<владелец>`.
Скрипт ждёт сборку, берёт digest образов, собирает архив через `git archive`, вписывает версию, SHA-256 и digest
в `deploy/install.sh`, публикует архив и установщик как GitHub Release `v1.2.3` (SHA-256 и digest — в описании
релиза), проверяет их по публичным ссылкам и коммитит `install.sh`. Установка и обновление берут
`releases/latest/download/install.sh`, а он — архив своего релиза.
Версия с суффиксом (`1.2.3-rc.1`) выходит пре-релизом и `latest` не двигает.
Те же два файла скрипт публикует в npm как `@gomex.llc/install@1.2.3` — зеркало на случай, когда GitHub недоступен. Для этого
npm должен быть залогинен (`npm login`), при публикации он спросит код двухфакторной защиты.
`GOMEX_SKIP_NPM=1` выпускает релиз без зеркала.
После самого первого релиза пакеты `gomex-app` и `gomex-caddy` в GitHub нужно один раз сделать публичными,
иначе серверы не смогут их скачать. Скрипт остановится и даст ссылки.

**Десктоп.** Поднять `version` в `desktop/package.json`, затем:

```bash
deploy/release-desktop.sh            # Mac (Apple Silicon и Intel) и Windows
```

Сборки выходят в GitHub Releases этого репозитория: `desktop-v1.2.3` — файлы версии, `desktop` — всегда последняя
версия под постоянными именами и `update.json`, который проверяют установленные приложения. Оба — пре-релизы,
`latest` остаётся за серверным релизом. Кнопка «Скачать приложение» на любом сервере ведёт в `desktop`.

Сборки подписываются ключом `~/.gomex/seed-update-signing-key.pem`, он создаётся при первом запуске. Его надо сразу
сохранить в бэкап: без него установленные приложения больше не обновятся. Открытая половина,
`desktop/update-key.pem`, коммитится и пушится до выпуска. Адреса сервера в сборке нет, приложение спрашивает его при
первом запуске; `GOMEX_DEFAULT_URL=https://…` встроит адрес.
