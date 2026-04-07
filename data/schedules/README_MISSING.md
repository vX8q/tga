# Чемпионаты без расписания

Расписание хранится в `data/schedules/{series_id}.json` или в статическом виде в `web/data/static-schedules.js`. Все чемпионаты из конфига имеют расписание (JSON или статическое).

**Расписание есть (JSON в data/schedules/):** все серии, в том числе `arca`, `dtm`, `elms`, `f1`, `f2`, `f3`, `f4_it`, `frec`, `gtwce_end`, `gtwce_sprint`, `imsa`, `indycar`, `nascar_cup`, `nascar_modified`, `nascar_truck`, `noaps`, `psc`, `smp_f4_ru`, `supercars`, `super_gt`, `wec`.

**Резерв (если JSON отсутствует):** в `web/data/static-schedules.js` остаётся статическое расписание для F1, F2, F3 и IndyCar — фронтенд подставляет его, только когда API не возвращает события.
