<p align="center">
  <img width="100" height="100" alt="icon_old" src="https://github.com/user-attachments/assets/37baa8ee-71f1-4b84-b079-2a35bcad5d39" />

</p>

<h1 align="center">SoundCloud Playback</h1>

<p align="center">
  <a href="#русский"><img src="https://img.shields.io/badge/язык-Русский%20🇷🇺-white" alt="ru"></a>
  <a href="#english"><img src="https://img.shields.io/badge/lang-English%20🇬🇧-white" alt="en"></a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.1-blue.svg">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Tampermonkey-lightgrey.svg">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg">
</p>

> [!NOTE]  
> Все права на оригинальное программное обеспечение принадлежат их правообладателям. Скрипт является независимой разработкой для улучшения пользовательского опыта (UX) и не связан с SoundCloud.

---

<a name="русский"></a>
## 🇷🇺 Русский

Профессиональный userscript для менеджеров скриптов (Tampermonkey, Violentmonkey), добавляющий умное сохранение состояния воспроизведения и восстановление контекста для веб-плеера SoundCloud.

### Зачем нужен этот скрипт?

По умолчанию веб-плеер SoundCloud забывает вашу сессию при обновлении или закрытии вкладки. Он также теряет контекст воспроизведения — например, если вы слушали трек из раздела **Лайков** или определенного **Плейлиста**, сайт просто перекинет вас на страницу самого трека (или куда-то ещё), сломав очередь воспроизведения.

**SoundCloud Playback** полностью решает эту проблему.

> [!IMPORTANT]  
> Скрипт записывает текущую позицию воспроизведения, активный трек и исходный контекст (Лайки, Плейлисты) в локальное хранилище браузера. При повторном открытии сайта он автоматически восстанавливает контекст, возвращая вас в нужную очередь, и плавно прокручивает страницу до вашего трека.

### Ключевые особенности

* **Контекстно-зависимое восстановление:** При возвращении на сайт вы попадаете в исходный плейлист или сетку треков, а не на изолированную страницу трека.
* **Глубокая память таймкодов:** Автоматически сохраняет и восстанавливает таймкоды на основе `aria-valuenow`, что критически важно для длинных DJ-миксов, подкастов и аудиокниг (срабатывает на треках длиннее 10 минут).
* **Визуальный лок-он (Подсветка):** Найденный трек выделяется эффектным неоновым гало. 
  * *Техническая деталь:* Подсветка реализована через аппаратное ускорение и CSS-псевдоэлементы с абсолютным позиционированием. Она полностью независима от структуры макета и не вызывает сдвигов верстки (CLS).
* **Обход ленивой загрузки (Lazy-Load):** Используется алгоритм многопроходного скроллинга (`multi-snap`), который надежно центрирует трек на экране, даже если SoundCloud динамически подгружает картинки и меняет высоту страницы.
* **Безопасность SPA:** Скрипт отличает первичную загрузку вкладки от внутреннего роутинга (SPA). Он никогда не перехватит навигацию, пока вы активно кликаете по разделам сайта.
* **Адаптация под движок React:** Встроенные механизмы асинхронных задержек позволяют сайту полностью "гидратироваться" перед восстановлением сессии. Это гарантирует отсутствие багов с интерфейсом даже на слабых компьютерах.

### Установка

> [!WARNING]  
> Для браузеров на движке Chromium (Chrome, Edge, Brave) при использовании новых версий Tampermonkey (MV3) может потребоваться включить **«Режим разработчика»** на странице расширений.

1. Установите менеджер скриптов: **[Tampermonkey](https://www.tampermonkey.net/)**.
2. **[Установить скрипт](https://raw.githubusercontent.com/aksyanoff/soundcloud-playback/main/PlaybackFix.user.js)**
3. Откройте SoundCloud и наслаждайтесь бесшовным воспроизведением.

---

<a name="english"></a>
## 🇬🇧 English

A professional userscript for Tampermonkey/Violentmonkey that adds intelligent playback memory and context restoration to the SoundCloud web player.

### Why use this script?

By default, the SoundCloud web player forgets your active playback session when you close or refresh the tab. It also loses playback context — for example, if you were listening to a track from your **Likes** grid or a specific **Playlist**, revisiting the site redirects you to an isolated track page (or somewhere else), breaking your playback queue.

**SoundCloud Playback** completely solves this issue.

> [!IMPORTANT]  
> The script records the current playback position, the active track, and its origin context (Likes, Playlists) in the browser's local storage. Upon reopening the site, it automatically navigates back to your previous context, reinstates the queue, and seamlessly scrolls the DOM to your exact track.

### Key Features

* **Context-Aware Restoration:** Reopening the site navigates you to the correct playlist or grid queue instead of a standalone track page.
* **Persistent Timecode Memory:** Automatically stores and restores `aria-valuenow` timestamps. This is crucial for long DJ mixes, podcasts, and audiobooks (triggers on tracks longer than 10 minutes).
* **Visual Lock-on Highlight:** The target track is highlighted using a premium neon halo effect upon restoration.
  * *Technical Detail:* The highlight is implemented using hardware-accelerated CSS pseudo-elements with absolute positioning. It is entirely layout-agnostic and guarantees zero Cumulative Layout Shift (CLS).
* **Lazy-Load Bypass:** Employs a multi-pass scrolling algorithm (`multi-snap`) to forcefully center the track on your screen, effectively counteracting SoundCloud's lazy-loaded DOM shifts.
* **SPA Safety:** Intelligently differentiates between initial page loads and internal Single-Page Application (SPA) routing, ensuring navigation is never hijacked while actively browsing the site.
* **React Engine Adaptation:** Built-in asynchronous delay mechanisms allow the site to fully hydrate its internal scripts before restoring the session. This guarantees stable operation and prevents UI glitches even on slower computers.

### Installation

> [!WARNING]  
> For Chromium-based browsers (Chrome, Edge, Brave) using newer versions of Tampermonkey (MV3), you may need to enable **"Developer mode"** on your extensions page.

1. Install a userscript manager: **[Tampermonkey](https://www.tampermonkey.net/)**.
2. **[Install the script](https://raw.githubusercontent.com/aksyanoff/soundcloud-playback/main/PlaybackFix.user.js)**
3. Open SoundCloud and enjoy seamless playback.
