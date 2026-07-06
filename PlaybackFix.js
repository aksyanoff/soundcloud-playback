// ==UserScript==
// @name         SoundCloud Playback Restore
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Saves playback progress and restores context (likes, playlists) with a premium visual highlight.
// @author       aksyanoff
// @match        https://soundcloud.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

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

        /* Neon halo overlay */
        .sc-playback-target-highlight::after {
            content: '';
            position: absolute;
            pointer-events: none;
            z-index: 1000;
            
            /* Base coordinates ensure the halo expands outward by 8px, creating breathing room */
            top: -8px; left: -8px; right: -8px; bottom: -8px;
            border-radius: 12px;
            
            /* Pure light effect without hard borders */
            box-shadow: 
                0 0 10px 4px rgba(255, 85, 0, 0.9),       /* Core light ring */
                0 0 30px 10px rgba(255, 85, 0, 0.4),      /* Outer ambient glow */
                inset 0 0 15px 4px rgba(255, 85, 0, 0.6); /* Inner ambient glow */
                
            animation: sc-playback-halo-anim 2.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }

        /* Exception for List View (Playlists) where internal padding already exists */
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

    const cancelScroll = () => {
        if (pendingScrollTarget) {
            pendingScrollTarget = null;
            pendingScrollPage = null;
            scrollAttempts = 0;
        }
    };

    document.addEventListener('mousedown', (e) => {
        const isManualPlay = e.target.closest('.sc-button-play, .playButton, .soundTitle__title, .soundBadge__titleLink, .trackItem__trackTitle');
        if (isManualPlay) stickyContextUrl = null;
        cancelScroll();
    }, true);

    window.addEventListener('wheel', cancelScroll, { passive: true });
    window.addEventListener('touchstart', cancelScroll, { passive: true });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cancelScroll();
    }, { passive: true });

    const decodeUrl = (url) => {
        try { return decodeURIComponent(url); } catch(e) { return url; }
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
                    const parsed = inParam.startsWith('system-playlists') ? '/you/likes' : '/' + inParam;
                    stickyContextUrl = parsed;
                    return parsed;
                }
            } catch(e) {}
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

    function jumpToUrlAndScroll(pageUrl, trackKey) {
        pendingScrollTarget = trackKey;
        pendingScrollPage = pageUrl;
        scrollAttempts = 0;
        
        const a = document.createElement('a');
        a.href = pageUrl;
        document.body.appendChild(a);
        a.click();
        a.remove();
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
            
            // Ignore links inside the bottom playback controls
            if (link.closest('.playControls')) continue;

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
        const GENERIC_PAGES = ['/', '/discover', '/stream', '/feed', '/popular'];

        if (GENERIC_PAGES.includes(path)) {
            const hasJumped = sessionStorage.getItem('sc_startup_jumped');
            if (!hasJumped) {
                sessionStorage.setItem('sc_startup_jumped', 'true');
                
                const globalState = GM_getValue('sc_global_state');
                if (globalState && globalState.trackKey) {
                    if (globalState.playlistUrl) {
                        jumpToUrlAndScroll(globalState.playlistUrl, globalState.trackKey);
                    } else {
                        jumpToUrlAndPlayTrackPage(globalState.trackKey);
                    }
                }
            }
        } else {
            const state = GM_getValue('sc_context_' + path);
            if (state && state.trackKey) {
                pendingScrollTarget = state.trackKey;
                pendingScrollPage = path;
                scrollAttempts = 0;
            }
        }
    };

    setTimeout(initializeStartup, 500);

    setInterval(() => {
        if (pendingScrollTarget) {
            if (window.location.pathname !== pendingScrollPage) {
                pendingScrollTarget = null;
                pendingScrollPage = null;
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
                setTimeout(() => {
                    const newTimeline = getTimeline(document.querySelector('#app .playControls'));
                    if (newTimeline) clickTimeline(newTimeline, targetTime / duration);
                }, 300);
            }
        } else {
            if (position > 0 && position !== lastSavedPosition) {
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
