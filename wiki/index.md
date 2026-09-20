---
title: Индекс базы знаний
type: concept
tags: [index]
created: 2026-09-19
updated: 2026-09-20
sources: []
---

# html2design — база знаний

Инструмент, снимающий страницу из браузера пользователя (с авторизацией и текущим состоянием интерфейса) в макет Figma: пять экранов под разные дисплеи плюс библиотека компонентов.

Утверждённый дизайн-документ: `docs/superpowers/specs/2026-09-19-html2design-design.md`.

## Concepts

- [[architecture]] — две половины, транспорт через файл, почему иначе нельзя
- [[correctness-strategy]] — четыре уровня защиты от неверного результата
- [[support-boundaries]] — что переносим, что объявляем неподдерживаемым
- [[breakpoint-capture]] — как получаются пять размеров из одной открытой вкладки
- [[paint-order]] — почему перенос z-порядка труднее всего остального

## Entities

- [[ir-bundle]] — формат обмена между extension и плагином Figma
- [[component-detection]] — слои B и C, как рождаются компоненты Figma
- [[fixture-suite]] — 11 фикстур и 55 снапшотов IR в настоящем Chrome

## Sources

Пока нет.

## Analyses

- [[why-not-rest-api]] — почему Figma REST API не годится и система обязана быть плагином
- [[font-availability-detection]] — почему `document.fonts.check` не отвечает на свой же вопрос
