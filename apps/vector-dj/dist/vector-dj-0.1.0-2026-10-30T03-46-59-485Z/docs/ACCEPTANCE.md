# Цел и приемателни критерии

Цел: отделно наше работещо DJ приложение с функционален ориентир Rekordbox. 0.1 е стартов билд; няма твърдение за 100% покритие или готовност за сценична употреба.

Метод: официално описание и наблюдаемо поведение → собствена реализация → изолирани автоматизирани проверки → браузърно аудио/UI → реални файлове и хардуер. В тази итерация не е извършвана декомпилация. ILSpy/BAM/GRASSMARLIN/Emissary от общия проект не участват в аудио двигателя или build процеса.

| Област | Реализация в 0.1 | Условие за приемане |
|---|---|---|
| Transport, 4 decks, mixer, FX, sampler | Копирани от собствения ORBIT двигател | Нов browser audio run, UI сесия, реална музика и дълъг запис |
| XML collection и playlists | Преглед, проверка, импорт, отделно свързване на аудио | Parser тестове плюс реален export и reload на библиотека |
| Cue/grid | 8 hot cues, един 4/4 anchor | Реален XML/audio fixture и измерена позиция |
| Dynamic grids, memory/loop cues | Само запазени source метаданни | Изпълнение и round-trip тестове |
| Sync | Еднократно подравняване | Непрекъснат sync lock и дълга runtime сесия |
| MIDI/controller | Generic Learn от ORBIT | Физически устройства, jog/scratch, reconnect и feedback |
| Windows пакет | Portable web/Node | Самостоятелен инсталатор, чиста Windows машина |
| Audio devices | Browser stereo/split | Отделен master/cue, ASIO/native backend и латентност |
| USB/CDJ, DVS, stems, streaming, cloud | Нереализирани | Отделен дизайн, интеграция и реална проверка за всяка функция |
| XML export / native Rekordbox DB | Нереализирани | Документиран round trip и съвместимост |

Пълен обхват за конкретната версия на Rekordbox, поддържаните контролери и Windows устройства предстои да се фиксира. Процент на завършеност не се изчислява от броя преминали тестове.

Източници, проверени 2026-10-30:
- https://rekordbox.com/en/support/developer/?lang=en
- https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf
- https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf

Browser UI автоматизацията върна „Local browser use is disabled in Work settings“. Няма нов визуален/audio browser PASS за този билд; настройки и разрешения не са променяни.
