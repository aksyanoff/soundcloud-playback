// ==UserScript==
// @name         SoundCloud Playback
// @name:ru      SoundCloud Playback
// @namespace    https://github.com/aksyanoff
// @version      1.1
// @description  Saves playback progress and restores context (likes, playlists) with visual highlight.
// @description:ru Сохраняет прогресс воспроизведения и автоматически восстанавливает контекст (лайки, плейлисты) с визуальной подсветкой.
// @author       aksyanoff
// @license      MIT
// @icon         https://raw.githubusercontent.com/aksyanoff/soundcloud-playback/main/images/icon64.png
// @homepageURL  https://github.com/aksyanoff/soundcloud-playback
// @source       https://github.com/aksyanoff/soundcloud-playback.git
// @supportURL   https://github.com/aksyanoff/soundcloud-playback/issues
// @downloadURL  https://raw.githubusercontent.com/aksyanoff/soundcloud-playback/main/PlaybackFix.user.js
// @updateURL    https://raw.githubusercontent.com/aksyanoff/soundcloud-playback/main/PlaybackFix.user.js
// @match        https://soundcloud.com/*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self) return;

    const IGNORE_LAST_SEC = 5;
    const LONG_TRACK_SEC = 600;

    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes sc-playback-card-anim {
            0% { transform: translateY(0); }
            15% { transform: translateY(-4px); }
            85% { transform: translateY(-4px); }
            100% { transform: translateY(0); }
        }

        @keyframes sc-playback-halo-anim {
            0% { opacity: 0; transform: scale(0.95); }
            15% { opacity: 1; transform: scale(1); }
            85% { opacity: 1; transform: scale(1); }
            100% { opacity: 0; transform: scale(1.05); }
        }

        .sc-playback-target-highlight {
            position: relative !important;
            z-index: 999 !important;
            animation: sc-playback-card-anim 2.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards !important;
        }

        .sc-playback-target-highlight::after {
            content: '';
            position: absolute;
            pointer-events: none;
            z-index: 1000;
            top: -8px; left: -8px; right: -8px; bottom: -8px;
            border-radius: 12px;
            box-shadow: 
                0 0 10px 4px rgba(255, 85, 0, 0.9),
                0 0 30px 10px rgba(255, 85, 0, 0.4),
                inset 0 0 15px 4px rgba(255, 85, 0, 0.6);
            animation: sc-playback-halo-anim 2.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }

        .trackList__item.sc-playback-target-highlight::after,
        .soundList__item.sc-playback-target-highlight::after {
            top: 0; left: 0; right: 0; bottom: 0;
            border-radius: 4px;
        }
    `;
    document.head.appendChild(style);

    let stickyContextUrl = null;
    let pendingScrollTarget = null;
    let pendingScrollPage = null;
    let scrollAttempts = 0;
    let pendingTrackPlay = false;
    let transitionTimer = null;

    const cancelScroll = () => {
        clearTimeout(transitionTimer);
        if (pendingScrollTarget || pendingScrollPage) {
            pendingScrollTarget = null;
            pendingScrollPage = null;
            scrollAttempts = 0;
        }
    };

    function startScrollWithDelay(target, page) {
        pendingScrollPage = page;
        scrollAttempts = 0;
        clearTimeout(transitionTimer);
        transitionTimer = setTimeout(() => {
            pendingScrollTarget = target;
        }, 1500); // 1.5s delay to allow SPA routing and DOM updates
    }

    document.addEventListener('mousedown', (e) => {
        const isManualPlay = e.target.closest('.sc-button-play, .playButton, .soundTitle__title, .soundBadge__titleLink, .trackItem__trackTitle');
        if (isManualPlay) {
            stickyContextUrl = null;
            cancelScroll();
        }
    }, true);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancelScroll();
    }, { passive: true });

    const decodeUrl = (url) => {
        try { return decodeURIComponent(url); } catch (e) { return url; }
    };

    const getTrackKey = (player) => {
        const link = player.querySelector('.playbackSoundBadge__titleLink');
        if (!link) return null;
        const href = link.getAttribute('href').split(/[?#]/)[0].replace('https://soundcloud.com', '').replace(/\/$/, '');
        return decodeUrl(href);
    };

    const getPlaylistUrl = (player) => {
        const link = player.querySelector('.playbackSoundBadge__titleLink');
        if (link) {
            try {
                const u = new URL(link.getAttribute('href'), window.location.origin);
                const inParam = u.searchParams.get('in');
                if (inParam) {
                    let parsed = '/' + inParam;
                    if (inParam.startsWith('system-playlist:likes')) parsed = '/you/likes';
                    else if (inParam.startsWith('system-playlist:history')) parsed = '/you/history';

                    stickyContextUrl = parsed;
                    return parsed;
                }
            } catch (e) { }
        }

        const ctxLink = player.querySelector('.playbackSoundBadge__context');
        if (ctxLink) {
            const href = ctxLink.getAttribute('href');
            if (href) {
                const parsed = href.split(/[?#]/)[0].replace('https://soundcloud.com', '');
                stickyContextUrl = parsed;
                return parsed;
            }
        }

        const path = window.location.pathname;
        if (path === '/you/likes' || path.includes('/sets/')) {
            stickyContextUrl = path;
            return path;
        }

        if (stickyContextUrl) return stickyContextUrl;

        return null;
    };

    const getTimeline = (player) => player.querySelector('.playbackTimeline__progressWrapper');

    function clickTimeline(timeline, factor) {
        const rect = timeline.getBoundingClientRect();
        if (rect.width === 0) return;
        const args = {
            view: typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
            bubbles: true,
            cancelable: true,
            clientX: rect.x + Math.floor(rect.width * factor),
            clientY: rect.y + (Math.floor(rect.height / 2) || 10),
        };
        timeline.dispatchEvent(new MouseEvent('mousedown', args));
        timeline.dispatchEvent(new MouseEvent('mouseup', args));
    }

    let currentKey = null;
    let lastSavedPosition = -1;
    let isRestoringTime = false;

    function jumpToUrlAndScroll(pageUrl, trackKey) {
        // Wait 2 seconds before simulating the click.
        // This gives the current page (e.g. /home) time to finish its initial load and React hydration
        // before we aggressively tell the SPA to navigate elsewhere.
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = pageUrl;
            document.body.appendChild(a);
            a.click();
            a.remove();

            startScrollWithDelay(trackKey, pageUrl);
        }, 2000);
    }

    function jumpToUrlAndPlayTrackPage(trackKey) {
        pendingTrackPlay = true;
        scrollAttempts = 0;

        const a = document.createElement('a');
        a.href = trackKey;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function findAndClickTrackInDOM(trackKey) {
        if (!trackKey) return false;

        const links = document.querySelectorAll('a');

        for (let i = 0; i < links.length; i++) {
            const link = links[i];

            // Ignore links inside the bottom playback controls, queues, and sidebars
            if (link.closest('.playControls, .queueItemView, .playbackSoundBadge__queue, .queue, .l-sidebar, .sidebarModule')) continue;

            const rawHref = link.getAttribute('href');
            if (!rawHref) continue;

            const cleanHref = decodeUrl(rawHref.replace('https://soundcloud.com', '').split(/[?#]/)[0].replace(/\/$/, ''));

            if (cleanHref === trackKey) {
                let item = link.closest('.trackList__item, .soundList__item, .soundBadgeList__item, .soundBadge, .searchItem, .userStreamItem, li');

                if (!item) {
                    let parent = link.parentElement;
                    for (let j = 0; j < 5; j++) {
                        if (parent && parent.querySelector('.sc-button-play, .playButton, [title="Play"], [title="Воспроизвести"]')) {
                            item = parent;
                            break;
                        }
                        if (parent) parent = parent.parentElement;
                    }
                }

                if (item) {
                    // Ensure the item is actually visible and not a hidden accessibility link
                    const rect = item.getBoundingClientRect();
                    if (rect.width < 10 || rect.height < 10) continue;

                    const playBtn = item.querySelector('.sc-button-play, .playButton, [title="Play"], [title="Воспроизвести"]');
                    if (playBtn) {
                        // Multi-snap scrolling to forcefully lock the track in the center despite lazy-loaded DOM shifts
                        const snap = () => item.scrollIntoView({ behavior: 'auto', block: 'center' });
                        snap();
                        setTimeout(snap, 150);
                        setTimeout(snap, 400);
                        setTimeout(snap, 800);

                        item.classList.add('sc-playback-target-highlight');

                        setTimeout(() => {
                            item.classList.remove('sc-playback-target-highlight');
                        }, 2600);

                        setTimeout(() => {
                            if (!playBtn.classList.contains('sc-button-pause') && !playBtn.classList.contains('playing')) {
                                isRestoringTime = true;
                                currentKey = null; // Force a full state restore cycle on the next tick
                                playBtn.click();
                            }
                        }, 300);

                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Initialize script ONLY upon fresh page loads
    const initializeStartup = () => {
        const path = window.location.pathname;
        const globalState = GM_getValue('sc_global_state');

        if (globalState && globalState.trackKey) {
            const playlistUrl = globalState.playlistUrl;

            // Restore sticky context to avoid losing it on refresh
            if (playlistUrl) {
                stickyContextUrl = playlistUrl;
            }

            if (playlistUrl) {
                if (path === globalState.trackKey) {
                    // User explicitly navigated to the standalone track page of the playing track. Don't force them out.
                    startScrollWithDelay(globalState.trackKey, path);
                } else if (playlistUrl !== path) {
                    jumpToUrlAndScroll(playlistUrl, globalState.trackKey);
                } else {
                    startScrollWithDelay(globalState.trackKey, playlistUrl);
                }
                return;
            } else {
                // track is standalone. Do not jump.
                startScrollWithDelay(globalState.trackKey, path);
                return;
            }
        }

        // Fallback for standalone pages if no global state exists
        const state = GM_getValue('sc_context_' + path);
        if (state && state.trackKey) {
            startScrollWithDelay(state.trackKey, path);
        }
    };

    setTimeout(initializeStartup, 500);

    let lastUrl = window.location.pathname;

    setInterval(() => {
        const currentUrl = window.location.pathname;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            const globalState = GM_getValue('sc_global_state');
            if (globalState && globalState.trackKey) {
                if (currentUrl === globalState.playlistUrl || currentUrl === globalState.trackKey) {
                    // User navigated via SPA to the context page, trigger scroll!
                    startScrollWithDelay(globalState.trackKey, currentUrl);
                }
            }
        }

        if (pendingScrollTarget) {
            const currentPath = window.location.pathname.replace(/\/$/, '');
            const targetPath = pendingScrollPage.replace(/\/$/, '');

            if (currentPath !== targetPath) {
                scrollAttempts++;
                if (scrollAttempts > 120) {
                    pendingScrollTarget = null;
                    pendingScrollPage = null;
                }
            } else if (findAndClickTrackInDOM(pendingScrollTarget)) {
                pendingScrollTarget = null;
                pendingScrollPage = null;
            } else {
                scrollAttempts++;
                if (scrollAttempts > 120) {
                    pendingScrollTarget = null;
                    pendingScrollPage = null;
                } else {
                    window.scrollTo(0, document.body.scrollHeight);
                }
            }
        }

        if (pendingTrackPlay) {
            scrollAttempts++;
            if (scrollAttempts > 20) {
                pendingTrackPlay = false;
            } else {
                const playBtn = document.querySelector('.soundTitle__playButton')
                    || document.querySelector('.listenHero .sc-button-play')
                    || document.querySelector('.fullHero__foreground .sc-button-play');
                if (playBtn) {
                    if (!playBtn.classList.contains('sc-button-pause')) {
                        playBtn.click();
                    }
                    pendingTrackPlay = false;
                }
            }
        }

        const player = document.querySelector('#app .playControls');
        if (!player) return;

        const timeline = getTimeline(player);
        if (!timeline) return;

        const key = getTrackKey(player);
        const playlistUrl = getPlaylistUrl(player);
        const position = Number(timeline.getAttribute('aria-valuenow'));
        const duration = Number(timeline.getAttribute('aria-valuemax'));

        if (!key || isNaN(position) || isNaN(duration) || duration < 5) return;

        const contextKey = playlistUrl || 'standalone';
        const isLongTrack = duration > LONG_TRACK_SEC;

        if (key !== currentKey) {
            currentKey = key;
            lastSavedPosition = -1;

            let targetTime = 0;
            const mem = GM_getValue('sc_context_' + contextKey);

            if (mem && mem.trackKey === key) {
                targetTime = mem.time;
            } else {
                if (isLongTrack) {
                    const perTrackTime = GM_getValue('sc_per_track_' + key);
                    if (perTrackTime) {
                        targetTime = perTrackTime;
                    }
                }
            }

            if (targetTime > 0 && targetTime < duration - IGNORE_LAST_SEC) {
                isRestoringTime = true;
                setTimeout(() => {
                    const newTimeline = getTimeline(document.querySelector('#app .playControls'));
                    if (newTimeline) clickTimeline(newTimeline, targetTime / duration);
                    setTimeout(() => { isRestoringTime = false; }, 1500);
                }, 300);
            } else {
                isRestoringTime = false;
            }
        } else {
            if (!isRestoringTime && position > 0 && position !== lastSavedPosition) {
                const posInt = Math.floor(position);
                const lastPosInt = Math.floor(lastSavedPosition);

                if (posInt !== lastPosInt || Math.abs(position - lastSavedPosition) > 2) {
                    if (position < duration - IGNORE_LAST_SEC) {
                        const state = { trackKey: key, time: position, playlistUrl: playlistUrl };
                        GM_setValue('sc_context_' + contextKey, state);
                        GM_setValue('sc_global_state', state);

                        if (isLongTrack) {
                            GM_setValue('sc_per_track_' + key, position);
                        }
                    } else {
                        GM_deleteValue('sc_per_track_' + key);
                    }
                    lastSavedPosition = position;
                }
            }
        }
    }, 500);

    window.addEventListener('beforeunload', () => {
        const player = document.querySelector('#app .playControls');
        if (!player) return;
        const timeline = getTimeline(player);
        const key = getTrackKey(player);
        if (timeline && key) {
            const position = Number(timeline.getAttribute('aria-valuenow'));
            if (!isNaN(position) && position > 0) {
                const playlistUrl = getPlaylistUrl(player);
                const contextKey = playlistUrl || 'standalone';
                const state = { trackKey: key, time: position, playlistUrl: playlistUrl };

                GM_setValue('sc_context_' + contextKey, state);
                GM_setValue('sc_global_state', state);

                const isLongTrack = Number(timeline.getAttribute('aria-valuemax')) > LONG_TRACK_SEC;
                if (isLongTrack) GM_setValue('sc_per_track_' + key, position);
            }
        }
    });

})();