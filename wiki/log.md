# Хронология операций

## [2026-09-19] docs | scaffold базы знаний и утверждение дизайна

Проведён brainstorming, утверждён дизайн-документ `docs/superpowers/specs/2026-09-19-html2design-design.md`.

Принятые решения: аудитория — внутренняя команда без публикации; два драйвера размеров (CDP-эмуляция как основной, offscreen-iframe как fallback); транспорт файлом `.h2d`, не relay; компоненты через эвристику повторов DOM, интроспекция fiber — изолированный экспериментальный проход по умолчанию выключен.

Созданы страницы: [[architecture]], [[breakpoint-capture]], [[ir-bundle]], [[component-detection]], [[correctness-strategy]], [[support-boundaries]], [[why-not-rest-api]].
