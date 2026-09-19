---
title: Границы поддержки
type: concept
tags: [css, limitations, figma]
created: 2026-09-19
updated: 2026-09-19
sources: [docs/superpowers/specs/2026-09-19-html2design-design.md]
---

# Границы поддержки

## Переносим уверенно

Геометрия; заливки — solid, linear/radial/conic-градиенты, image-fill с `cover`/`contain`/`repeat`; обводки, включая разную толщину по сторонам; радиусы по углам; тени внешние и внутренние; `opacity`; `mix-blend-mode`; `overflow: hidden` в `clipsContent`; `transform` translate/rotate/scale; `filter: blur` в Layer Blur; `backdrop-filter: blur` в Background Blur; типографика целиком, включая `text-transform` (применяется к самой строке) и `text-shadow`; `display: flex`/`grid` в auto-layout; псевдоэлементы `::before`/`::after`; открытый shadow DOM; same-origin iframe рекурсивно; inline SVG в Vector.

## Неподдерживаемое: заглушка плюс Diagnostic

`<canvas>` и WebGL; cross-origin iframe; closed shadow DOM; `clip-path` и CSS-маски; SVG-фильтры; `filter` кроме blur; skew и 3D-трансформы (в Figma их нет физически); `repeating-*` градиенты; кастомные скроллбары; состояния `:hover`/`:focus`/`:active`; анимации и переходы — жанр инструмента это один кадр.

## Осознанные компромиссы

**Скролл-контейнеры** приезжают с полным содержимым внутри и включённым клипом — дизайнер видит всё, сняв клип.

**Шрифты.** Плагин не может установить шрифт в Figma. При отсутствии семейства подбирается ближайший вес, при полном промахе подставляется Inter, в отчёт идёт запись уровня error. Не установленные локально веб-шрифты — главный убийца точности, и отчёт про это должен кричать.

**`position: sticky`/`fixed`** снимаются в текущем скролл-положении и укладываются на место, с пометкой в отчёте.

**Нормализация ассетов.** `figma.createImage` принимает PNG/JPG/GIF и ограничен 4096px по стороне. AVIF и WebP конвертируются через `OffscreenCanvas`, крупные изображения масштабируются, факт масштабирования пишется в отчёт.

## См. также

- [[correctness-strategy]] — почему перечень неподдерживаемого важнее перечня поддерживаемого
- [[ir-bundle]]
