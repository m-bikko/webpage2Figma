---
title: Архитектура
type: concept
tags: [architecture, extension, figma-plugin]
created: 2026-09-19
updated: 2026-09-19
sources: [docs/superpowers/specs/2026-09-19-html2design-design.md]
---

# Архитектура

Система состоит из двух исполняемых артефактов и файла между ними. Это не выбор, а следствие ограничения платформы — см. [[why-not-rest-api]].

## Половина первая: Chrome Extension (MV3)

- **popup UI** — выбор размеров, режима захвата, опций
- **service worker** — оркестратор: управляет CDP-эмуляцией, собирает результаты, формирует бандл
- **page probe** — обход DOM в MAIN world, опционально с проходом интроспекции фреймворка
- **serializer** — `DOM → IR`, чистая функция, покрыта тестами
- **resource fetcher** — картинки и шрифты, запросы идут с cookies пользователя, поэтому авторизованные ресурсы доступны
- **normalizer** — приводит ассеты к тому, что примет Figma: PNG/JPG/GIF, не больше 4096px по стороне

## Половина вторая: Figma Plugin

- **UI (iframe)** — приём файла, выбор экранов, прогресс, просмотр отчёта
- **validator** — строгая проверка схемы IR; при несовпадении внятная ошибка вместо половинчатого импорта
- **font preloader** — `loadFontAsync` до создания текстовых узлов; нарушение этого порядка — главная причина падений плагинов Figma
- **layout inferrer** — решает, становится ли фрейм auto-layout или остаётся с абсолютным позиционированием; чистая функция
- **node builder** — IR в Frame/Text/Rectangle/Vector
- **component synth** — см. [[component-detection]]
- **page organizer** — раскладка по страницам Figma

## Транспорт

Файл `.h2d` (ZIP: `ir.json` + `assets/` + `screenshots/`), см. [[ir-bundle]].

Localhost-relay отклонён: «один клик вместо двух» не окупает фоновый процесс на машине каждого коллеги, `allowedDomains` в манифесте плагина и класс сетевых сбоев. Файл детерминирован, воспроизводится, прикладывается к багрепорту и переживает перезапуск Figma.

## Результат в Figma

Четыре страницы: `Screens` (пять фреймов), `Components` (библиотека), `Tokens` (Variables, Text Styles, Paint Styles), `Report` (см. [[correctness-strategy]]).

## См. также

- [[breakpoint-capture]] — как получаются пять размеров
- [[support-boundaries]] — границы переносимого
